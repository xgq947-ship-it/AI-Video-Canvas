/**
 * Durable, credential-free generation runtime journal.
 *
 * Project media stays in project folders.  This file stores only operational
 * state needed to explain/recover interrupted provider work.  The storage
 * interface is deliberately small so it can be replaced by SQLite later
 * without changing providers or routes.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { RUNTIME_PATHS } from '../../runtime/paths.js';
import { redactSecrets } from '../webhttp/errors.js';

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled', 'auth_required']);
const ACTIVE_STATES = new Set(['queued', 'waiting', 'preparing', 'submitting', 'submitted', 'polling', 'downloading']);
const MAX_ERROR_LENGTH = 600;

function safeMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') return {};
    const allow = ['kind', 'modelId', 'nodeId', 'workflowId', 'attempt'];
    return Object.fromEntries(allow
        .filter(key => metadata[key] !== undefined && metadata[key] !== null)
        .map(key => [key, String(metadata[key]).slice(0, 200)]));
}

function safeDetails(details) {
    if (!details || typeof details !== 'object') return undefined;
    const allow = ['runId', 'batchId', 'flowWorkflowId', 'submitId', 'taskId', 'conversationId', 'mediaIds', 'projectId'];
    const output = {};
    for (const key of allow) {
        const value = details[key];
        if (value === undefined || value === null || value === '') continue;
        output[key] = Array.isArray(value)
            ? value.map(item => String(item).slice(0, 240)).slice(0, 16)
            : String(value).slice(0, 500);
    }
    return Object.keys(output).length ? output : undefined;
}

function emptyDocument() {
    return { version: 1, jobs: [] };
}

export class GenerationJobJournal {
    constructor({
        filePath = path.join(RUNTIME_PATHS.runtimeDir, 'generation-jobs.json'),
        now = () => new Date().toISOString(),
        idFactory = () => crypto.randomUUID(),
        maxTerminalJobs = 200,
        persistent = true
    } = {}) {
        this.filePath = filePath;
        this.now = now;
        this.idFactory = idFactory;
        this.maxTerminalJobs = maxTerminalJobs;
        this.persistent = persistent;
        this.document = null;
    }

    #ensureLoaded() {
        if (this.document) return;
        if (!this.persistent) {
            this.document = emptyDocument();
            return;
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            this.document = {
                version: 1,
                jobs: Array.isArray(parsed?.jobs) ? parsed.jobs.filter(job => job?.id && job?.provider) : []
            };
        } catch (error) {
            if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
            this.document = emptyDocument();
        }
        this.#recoverInterruptedJobs();
    }

    #recoverInterruptedJobs() {
        let changed = false;
        const recoveredAt = this.now();
        for (const job of this.document.jobs) {
            if (!ACTIVE_STATES.has(job.state)) continue;
            changed = true;
            const crossedSubmitBoundary = Boolean(job.submittedAt)
                || ['submitting', 'submitted', 'polling', 'downloading'].includes(job.state);
            job.state = crossedSubmitBoundary ? 'recovery_required' : 'interrupted';
            job.updatedAt = recoveredAt;
            job.finishedAt = recoveredAt;
            job.error = crossedSubmitBoundary
                ? '应用上次退出时任务可能已经提交，请先核对平台历史记录。'
                : '应用上次退出时任务尚未提交，可以安全重新执行。';
        }
        if (changed) this.#write();
    }

    #prune() {
        const active = [];
        const terminal = [];
        for (const job of this.document.jobs) {
            if (TERMINAL_STATES.has(job.state)
                || ['interrupted', 'recovery_required', 'submission_unknown'].includes(job.state)) {
                terminal.push(job);
            } else {
                active.push(job);
            }
        }
        terminal.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
        this.document.jobs = [...active, ...terminal.slice(0, this.maxTerminalJobs)];
    }

    #write() {
        this.#prune();
        if (!this.persistent) return;
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
        fs.writeFileSync(temporaryPath, `${JSON.stringify(this.document, null, 2)}\n`, 'utf8');
        fs.renameSync(temporaryPath, this.filePath);
    }

    create({ provider, label, metadata } = {}) {
        this.#ensureLoaded();
        const timestamp = this.now();
        const job = {
            id: this.idFactory(),
            provider: String(provider || ''),
            label: String(label || provider || '生成任务').slice(0, 160),
            state: 'queued',
            metadata: safeMetadata(metadata),
            createdAt: timestamp,
            updatedAt: timestamp,
            submittedAt: null,
            finishedAt: null,
            details: undefined,
            errorCode: null,
            error: null
        };
        this.document.jobs.push(job);
        this.#write();
        return { ...job };
    }

    transition(id, state, { details, errorCode, error } = {}) {
        this.#ensureLoaded();
        const job = this.document.jobs.find(item => item.id === id);
        if (!job) return null;
        const normalizedDetails = safeDetails(details);
        if (job.state === String(state) && !normalizedDetails && !errorCode && !error) {
            return { ...job };
        }
        const timestamp = this.now();
        job.state = String(state);
        job.updatedAt = timestamp;
        if (state === 'submitted' && !job.submittedAt) job.submittedAt = timestamp;
        if (TERMINAL_STATES.has(state) || ['interrupted', 'recovery_required', 'submission_unknown'].includes(state)) {
            job.finishedAt = timestamp;
        }
        if (normalizedDetails) job.details = { ...(job.details || {}), ...normalizedDetails };
        if (errorCode) job.errorCode = String(errorCode).slice(0, 100);
        if (error) job.error = redactSecrets(String(error)).slice(0, MAX_ERROR_LENGTH);
        this.#write();
        return { ...job };
    }

    attachDetails(id, details) {
        this.#ensureLoaded();
        const job = this.document.jobs.find(item => item.id === id);
        if (!job) return null;
        const normalized = safeDetails(details);
        if (!normalized) return { ...job };
        job.details = { ...(job.details || {}), ...normalized };
        job.updatedAt = this.now();
        this.#write();
        return { ...job };
    }

    get(id) {
        this.#ensureLoaded();
        const job = this.document.jobs.find(item => item.id === id);
        return job ? structuredClone(job) : null;
    }

    list({ limit = 50, states } = {}) {
        this.#ensureLoaded();
        const allowed = Array.isArray(states) && states.length ? new Set(states.map(String)) : null;
        return this.document.jobs
            .filter(job => !allowed || allowed.has(job.state))
            .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
            .slice(0, Math.max(1, Math.min(Number(limit) || 50, 500)))
            .map(job => structuredClone(job));
    }

    summary() {
        this.#ensureLoaded();
        const counts = {};
        for (const job of this.document.jobs) counts[job.state] = (counts[job.state] || 0) + 1;
        return { counts, total: this.document.jobs.length };
    }
}

// Unit-test workers exercise the real dispatcher extensively. Keep their
// synthetic jobs in memory so `npm test` never pollutes a developer's runtime
// journal; explicit GenerationJobJournal instances still test disk recovery.
export const generationJobJournal = new GenerationJobJournal({
    persistent: !Boolean(process.env.NODE_TEST_CONTEXT)
});
