/**
 * Stable concurrency scheduler for browser-authenticated HTTP providers.
 *
 * Policy:
 * - one atomic pre-submit lane per provider/account;
 * - at most two providers may be in that critical section at once;
 * - once the first billable request crosses the submission boundary, the lane
 *   is released while polling/downloading continues;
 * - queued cancellation never starts provider work.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import { operationCancelledError } from '../operationCancelled.js';
import { generationJobJournal } from './jobJournal.js';
import { generationProviderRegistry } from './providerRegistry.js';

class FairSemaphore {
    constructor(limit, { label = 'semaphore' } = {}) {
        const normalized = Number(limit);
        if (!Number.isInteger(normalized) || normalized < 1) throw new Error(`${label} limit must be >= 1`);
        this.limit = normalized;
        this.label = label;
        this.active = 0;
        this.queue = [];
    }

    acquire({ signal, cancelLabel = '生成任务' } = {}) {
        if (signal?.aborted) return Promise.reject(operationCancelledError(cancelLabel));
        if (this.active < this.limit) {
            this.active += 1;
            return Promise.resolve(this.#releaseFactory());
        }
        return new Promise((resolve, reject) => {
            const entry = { resolve, reject, signal, cancelLabel, onAbort: null };
            entry.onAbort = () => {
                const index = this.queue.indexOf(entry);
                if (index >= 0) this.queue.splice(index, 1);
                reject(operationCancelledError(cancelLabel));
            };
            signal?.addEventListener('abort', entry.onAbort, { once: true });
            this.queue.push(entry);
        });
    }

    #releaseFactory() {
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.active = Math.max(0, this.active - 1);
            this.#drain();
        };
    }

    #drain() {
        while (this.active < this.limit && this.queue.length > 0) {
            const entry = this.queue.shift();
            entry.signal?.removeEventListener('abort', entry.onAbort);
            if (entry.signal?.aborted) {
                entry.reject(operationCancelledError(entry.cancelLabel));
                continue;
            }
            this.active += 1;
            entry.resolve(this.#releaseFactory());
        }
    }

    snapshot() {
        return { limit: this.limit, active: this.active, queued: this.queue.length };
    }
}

function errorState(error, context) {
    if (context?.submissionUnknown) return 'submission_unknown';
    if (error?.submitted === true || context?.phase === 'submitted') return 'recovery_required';
    if (error?.cancelled || error?.code === 'OPERATION_CANCELLED') {
        // Cancelling the local wait cannot cancel a task already accepted by
        // the platform. Keep that case recoverable instead of presenting it as
        // a safe, never-submitted cancellation.
        return context?.phase === 'submitted' || error?.submitted === true
            ? 'recovery_required'
            : 'cancelled';
    }
    if (error?.code === 'AUTH_EXPIRED' && error?.submitted !== true) return 'auth_required';
    if (error?.code === 'POLL_TIMEOUT') return 'recovery_required';
    if (context?.phase === 'submitted'
        && ['AUTH_EXPIRED', 'BRIDGE_UNAVAILABLE', 'RATE_LIMIT'].includes(error?.code)) {
        return 'recovery_required';
    }
    return 'failed';
}

export class GenerationScheduler {
    constructor({
        registry = generationProviderRegistry,
        journal = generationJobJournal,
        globalSubmitConcurrency = Number(process.env.EVAN_WEB_GLOBAL_SUBMIT_CONCURRENCY) || 2,
        globalPollConcurrency = Number(process.env.EVAN_WEB_GLOBAL_POLL_CONCURRENCY) || 6,
        globalDownloadConcurrency = Number(process.env.EVAN_WEB_GLOBAL_DOWNLOAD_CONCURRENCY) || 4
    } = {}) {
        this.registry = registry;
        this.journal = journal;
        this.globalSubmitLane = new FairSemaphore(globalSubmitConcurrency, { label: 'global-submit' });
        this.globalPollLane = new FairSemaphore(globalPollConcurrency, { label: 'global-poll' });
        this.globalDownloadLane = new FairSemaphore(globalDownloadConcurrency, { label: 'global-download' });
        this.providerLanes = new Map();
        this.providerPollLanes = new Map();
        this.providerDownloadLanes = new Map();
        this.contextStorage = new AsyncLocalStorage();
        this.activeJobs = new Map();
    }

    #lane(provider) {
        if (!this.providerLanes.has(provider)) {
            const definition = this.registry.require(provider);
            this.providerLanes.set(provider, new FairSemaphore(definition.submitConcurrency, {
                label: `${provider}-submit`
            }));
        }
        return this.providerLanes.get(provider);
    }

    #stageLane(provider, stage) {
        const definition = this.registry.require(provider);
        const lanes = stage === 'poll' ? this.providerPollLanes : this.providerDownloadLanes;
        if (!lanes.has(provider)) {
            const limit = stage === 'poll' ? definition.pollConcurrency : definition.downloadConcurrency;
            lanes.set(provider, new FairSemaphore(limit, { label: `${provider}-${stage}` }));
        }
        return lanes.get(provider);
    }

    async runStage({ provider, stage, label, signal, task }) {
        if (!['poll', 'download'].includes(stage)) throw new Error(`Unknown generation stage: ${stage}`);
        if (typeof task !== 'function') throw new Error(`Generation ${stage} task is required`);
        const context = this.contextStorage.getStore();
        const globalLane = stage === 'poll' ? this.globalPollLane : this.globalDownloadLane;
        const providerLane = this.#stageLane(provider, stage);
        let releaseProvider = null;
        let releaseGlobal = null;
        try {
            releaseProvider = await providerLane.acquire({ signal, cancelLabel: label });
            releaseGlobal = await globalLane.acquire({ signal, cancelLabel: label });
            if (context?.provider === provider) {
                const state = stage === 'poll' ? 'polling' : 'downloading';
                const active = this.activeJobs.get(context.jobId);
                if (active) active.state = state;
                this.journal.transition(context.jobId, state);
            }
            return await task();
        } finally {
            releaseGlobal?.();
            releaseProvider?.();
        }
    }

    async run({ provider, label, metadata, signal, task }) {
        if (typeof task !== 'function') throw new Error('Generation scheduler task is required');
        this.registry.require(provider);
        const job = this.journal.create({ provider, label, metadata });
        const active = {
            id: job.id,
            provider,
            label,
            metadata: metadata && typeof metadata === 'object' ? { ...metadata } : {},
            state: 'queued',
            createdAt: job.createdAt,
            critical: false
        };
        this.activeJobs.set(job.id, active);

        let releaseProvider = null;
        let releaseGlobal = null;
        let context = null;
        try {
            this.journal.transition(job.id, 'waiting');
            active.state = 'waiting';
            releaseProvider = await this.#lane(provider).acquire({ signal, cancelLabel: label });
            releaseGlobal = await this.globalSubmitLane.acquire({ signal, cancelLabel: label });

            const releaseCritical = () => {
                if (context?.criticalReleased) return;
                if (context) context.criticalReleased = true;
                active.critical = false;
                releaseGlobal?.();
                releaseGlobal = null;
                releaseProvider?.();
                releaseProvider = null;
            };
            context = {
                jobId: job.id,
                provider,
                label,
                phase: 'preparing',
                submissionUnknown: false,
                criticalReleased: false,
                releaseCritical
            };
            active.state = 'preparing';
            active.critical = true;
            this.journal.transition(job.id, 'preparing');

            return await this.contextStorage.run(context, async () => {
                try {
                    const result = await task();
                    active.state = 'completed';
                    this.journal.transition(job.id, 'completed');
                    return result;
                } catch (error) {
                    if ((error?.cancelled || error?.code === 'OPERATION_CANCELLED')
                        && context.phase === 'submitted') {
                        error.submitted = true;
                        error.retryable = false;
                    }
                    const state = errorState(error, context);
                    active.state = state;
                    this.journal.transition(job.id, state, {
                        errorCode: error?.code,
                        error: error?.message || String(error),
                        details: error?.details
                    });
                    throw error;
                } finally {
                    releaseCritical();
                }
            });
        } catch (error) {
            if (!context) {
                const state = errorState(error, context);
                active.state = state;
                this.journal.transition(job.id, state, {
                    errorCode: error?.code,
                    error: error?.message || String(error)
                });
            }
            throw error;
        } finally {
            releaseGlobal?.();
            releaseProvider?.();
            this.activeJobs.delete(job.id);
        }
    }

    noteBillableRequestStart(provider) {
        const context = this.contextStorage.getStore();
        if (!context || context.provider !== provider) return null;
        const active = this.activeJobs.get(context.jobId);
        if (context.phase === 'preparing') {
            context.phase = 'submitting';
            if (active) active.state = 'submitting';
            this.journal.transition(context.jobId, 'submitting');
        } else {
            if (active) active.state = 'polling';
            this.journal.transition(context.jobId, 'polling');
        }
        return context.jobId;
    }

    noteBillableRequestSettled(provider, details, { unknown = false } = {}) {
        const context = this.contextStorage.getStore();
        if (!context || context.provider !== provider) return null;
        if (context.phase !== 'submitted') {
            context.submissionUnknown = Boolean(unknown);
            context.phase = 'submitted';
            const active = this.activeJobs.get(context.jobId);
            if (active) active.state = 'submitted';
            this.journal.transition(context.jobId, 'submitted', { details });
            context.releaseCritical();
        } else if (details) {
            this.journal.attachDetails(context.jobId, details);
        }
        return context.jobId;
    }

    attachCurrentDetails(provider, details) {
        const context = this.contextStorage.getStore();
        if (!context || context.provider !== provider) return null;
        this.journal.attachDetails(context.jobId, details);
        return context.jobId;
    }

    currentContext() {
        const context = this.contextStorage.getStore();
        return context ? {
            jobId: context.jobId,
            provider: context.provider,
            label: context.label,
            phase: context.phase,
            criticalReleased: context.criticalReleased
        } : null;
    }

    /**
     * Cancellation arrives through a different HTTP request and therefore a
     * different AsyncLocalStorage context. Match the live scheduler entry by
     * provider and the safe node/workflow metadata instead of looking only at
     * the caller's context.
     */
    hasCrossedSubmissionBoundary(provider, metadata = {}) {
        const expectedWorkflowId = metadata?.workflowId;
        const expectedNodeId = metadata?.nodeId;
        return [...this.activeJobs.values()].some(active => {
            if (active.provider !== provider || active.state !== 'submitted' && active.state !== 'polling' && active.state !== 'downloading') {
                return false;
            }
            if (expectedWorkflowId && active.metadata?.workflowId !== expectedWorkflowId) return false;
            if (expectedNodeId && active.metadata?.nodeId !== expectedNodeId) return false;
            return true;
        });
    }

    busyLabel() {
        return [...this.activeJobs.values()]
            .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))[0]?.label || '';
    }

    snapshot() {
        return {
            policy: {
                sameProviderSubmitConcurrency: 1,
                globalSubmitConcurrency: this.globalSubmitLane.limit,
                releaseAfterSubmission: true
            },
            globalSubmit: this.globalSubmitLane.snapshot(),
            globalPoll: this.globalPollLane.snapshot(),
            globalDownload: this.globalDownloadLane.snapshot(),
            providers: Object.fromEntries(this.registry.list().map(definition => [
                definition.id,
                {
                    submit: this.#lane(definition.id).snapshot(),
                    poll: this.#stageLane(definition.id, 'poll').snapshot(),
                    download: this.#stageLane(definition.id, 'download').snapshot()
                }
            ])),
            activeJobs: [...this.activeJobs.values()].map(job => ({ ...job }))
        };
    }
}

export const generationScheduler = new GenerationScheduler();

export const runScheduledGeneration = options => generationScheduler.run(options);
export const runProviderPoll = (provider, task, options = {}) => generationScheduler.runStage({
    provider,
    stage: 'poll',
    task,
    ...options
});
export const runProviderDownload = (provider, task, options = {}) => generationScheduler.runStage({
    provider,
    stage: 'download',
    task,
    ...options
});
export const noteBillableRequestStart = provider => generationScheduler.noteBillableRequestStart(provider);
export const noteBillableRequestSettled = (provider, details, options) => generationScheduler.noteBillableRequestSettled(provider, details, options);
export const attachCurrentGenerationDetails = (provider, details) => generationScheduler.attachCurrentDetails(provider, details);
export const generationHasCrossedSubmissionBoundary = (provider, metadata) => {
    const context = generationScheduler.currentContext();
    if (context?.provider === provider && context.phase === 'submitted') return true;
    return generationScheduler.hasCrossedSubmissionBoundary(provider, metadata);
};
export const generationRuntimeBusyLabel = () => generationScheduler.busyLabel();
export const generationSchedulerSnapshot = () => generationScheduler.snapshot();
