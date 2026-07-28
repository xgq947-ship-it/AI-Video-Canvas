/** Read-only health aggregation for the generation runtime. */

import { browserRuntimeStatus } from '../opsCliRunner.js';
import { browserSessionState } from '../browserSessionState.js';
import {
    checkAllWebAuthStatus,
    describeAuthStatus,
    persistAuthStatus
} from '../webhttp/auth.js';
import { generationJobJournal } from './jobJournal.js';
import { generationProviderRegistry } from './providerRegistry.js';
import { generationSchedulerSnapshot } from './scheduler.js';

function providerHealthState(status, runtimeReady) {
    if (!runtimeReady) return 'unavailable';
    const value = status?.status || status?.state || 'unknown';
    if (value === 'logged-in' || value === 'authenticated') return 'healthy';
    if (value === 'logged-out' || value === 'expired') return 'auth-required';
    if (value === 'checking' || value === 'reauthenticating') return 'checking';
    if (value === 'browser_unavailable') return 'unavailable';
    if (value === 'submission_unknown') return 'degraded';
    return 'unknown';
}

export async function getGenerationRuntimeHealth({
    probe = false,
    signal,
    sessionStore = browserSessionState,
    runtimeStatus = browserRuntimeStatus,
    checkStatuses = checkAllWebAuthStatus,
    registry = generationProviderRegistry,
    schedulerSnapshot = generationSchedulerSnapshot,
    journal = generationJobJournal
} = {}) {
    const checkedAt = new Date().toISOString();
    const runtime = runtimeStatus();
    const scheduler = schedulerSnapshot();
    const active = scheduler.activeJobs || [];
    const definitions = registry.list();
    let probeSkipped = null;
    let statuses = null;

    if (probe && active.length > 0) {
        // A forced login probe navigates provider pages. Never let a health
        // button disturb an upload/submit/poll that is already using them.
        probeSkipped = 'generation-active';
    } else if (probe && runtime.ready) {
        statuses = await checkStatuses({
            force: true,
            signal,
            providers: definitions.map(provider => provider.id)
        });
        for (const status of statuses) persistAuthStatus(sessionStore, status);
    }

    const stored = sessionStore.list();
    const byProvider = new Map((statuses || []).map(status => [status.provider, status]));
    const providers = definitions.map(definition => {
        const status = byProvider.get(definition.id) || stored[definition.id] || { state: 'unknown' };
        return {
            id: definition.id,
            label: definition.label,
            transport: definition.transport,
            state: providerHealthState(status, runtime.ready),
            authenticated: ['logged-in', 'authenticated'].includes(status.status || status.state),
            sessionState: status.status || status.state || 'unknown',
            checkedAt: status.checkedAt ? new Date(status.checkedAt).toISOString() : status.updatedAt || null,
            message: status.message || describeAuthStatus(status),
            limits: {
                submitConcurrency: definition.submitConcurrency,
                pollConcurrency: scheduler.providers[definition.id]?.poll?.limit || definition.pollConcurrency,
                downloadConcurrency: scheduler.providers[definition.id]?.download?.limit || definition.downloadConcurrency
            }
        };
    });

    const providerStates = providers.map(provider => provider.state);
    const overall = !runtime.ready ? 'unavailable'
        : active.length > 0 ? 'busy'
            : providerStates.every(state => state === 'healthy') ? 'healthy'
                : providerStates.some(state => state === 'unavailable') ? 'degraded'
                    : 'attention';

    return {
        overall,
        checkedAt,
        probed: Boolean(probe && !probeSkipped && runtime.ready),
        probeSkipped,
        runtime,
        providers,
        scheduler,
        jobs: journal.summary()
    };
}
