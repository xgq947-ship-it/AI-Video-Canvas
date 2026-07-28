import assert from 'node:assert/strict';
import test from 'node:test';

import { getGenerationRuntimeHealth } from '../server/services/generationRuntime/health.js';
import { GenerationProviderRegistry } from '../server/services/generationRuntime/providerRegistry.js';

const definitions = [
    { id: 'google-flow', label: 'Google Flow', transport: 'test', submitConcurrency: 1, pollConcurrency: 4, downloadConcurrency: 2 },
    { id: 'gemini-web', label: 'Gemini Web', transport: 'test', submitConcurrency: 1, pollConcurrency: 4, downloadConcurrency: 2 },
    { id: 'jimeng', label: '即梦', transport: 'test', submitConcurrency: 1, pollConcurrency: 4, downloadConcurrency: 2 }
];

const registry = new GenerationProviderRegistry(definitions);

function schedulerSnapshot(activeJobs = []) {
    return {
        policy: { sameProviderSubmitConcurrency: 1, globalSubmitConcurrency: 2, releaseAfterSubmission: true },
        activeJobs,
        providers: Object.fromEntries(definitions.map(provider => [provider.id, {
            submit: { limit: 1, active: 0, queued: 0 },
            poll: { limit: 4, active: 0, queued: 0 },
            download: { limit: 2, active: 0, queued: 0 }
        }]))
    };
}

function sessionStore(states) {
    const values = structuredClone(states);
    return {
        list: () => structuredClone(values),
        transition(provider, state, update) {
            values[provider] = { provider, state, ...update, updatedAt: '2026-07-28T00:00:00.000Z' };
            return values[provider];
        }
    };
}

const journal = { summary: () => ({ total: 3, counts: { completed: 2, recovery_required: 1 } }) };

test('本地健康检查只读持久状态，不触碰平台网络', async () => {
    let probes = 0;
    const health = await getGenerationRuntimeHealth({
        probe: false,
        registry,
        runtimeStatus: () => ({ ready: true, opsReady: true, chromeMajor: 140 }),
        sessionStore: sessionStore({
            'google-flow': { provider: 'google-flow', state: 'authenticated', message: '已验证' },
            'gemini-web': { provider: 'gemini-web', state: 'expired', message: '已过期' },
            jimeng: { provider: 'jimeng', state: 'unknown', message: '未检测' }
        }),
        checkStatuses: async () => { probes += 1; return []; },
        schedulerSnapshot: () => schedulerSnapshot(),
        journal
    });

    assert.equal(probes, 0);
    assert.equal(health.probed, false);
    assert.equal(health.overall, 'attention');
    assert.equal(health.providers.find(item => item.id === 'google-flow').state, 'healthy');
    assert.equal(health.providers.find(item => item.id === 'gemini-web').state, 'auth-required');
    assert.deepEqual(health.jobs, { total: 3, counts: { completed: 2, recovery_required: 1 } });
});

test('深度健康检查只做零额度登录探针，并把结果同步到状态存储', async () => {
    const transitions = [];
    const store = sessionStore(Object.fromEntries(definitions.map(item => [item.id, {
        provider: item.id,
        state: 'unknown'
    }])));
    const originalTransition = store.transition.bind(store);
    store.transition = (...args) => {
        transitions.push(args);
        return originalTransition(...args);
    };
    const seen = [];
    const health = await getGenerationRuntimeHealth({
        probe: true,
        registry,
        runtimeStatus: () => ({ ready: true, opsReady: true }),
        sessionStore: store,
        checkStatuses: async options => {
            seen.push(options);
            return definitions.map(item => ({
                provider: item.id,
                status: 'logged-in',
                checkedAt: Date.UTC(2026, 6, 28)
            }));
        },
        schedulerSnapshot: () => schedulerSnapshot(),
        journal
    });

    assert.equal(seen.length, 1);
    assert.equal(seen[0].force, true);
    assert.deepEqual(seen[0].providers, ['google-flow', 'gemini-web', 'jimeng']);
    assert.equal(transitions.length, 3);
    assert.equal(health.probed, true);
    assert.equal(health.overall, 'healthy');
    assert.ok(health.providers.every(item => item.authenticated));
});

test('有生成任务时跳过深度探针，避免导航页面打断正在执行的 HTTP 链路', async () => {
    let probes = 0;
    const health = await getGenerationRuntimeHealth({
        probe: true,
        registry,
        runtimeStatus: () => ({ ready: true, opsReady: true }),
        sessionStore: sessionStore(Object.fromEntries(definitions.map(item => [item.id, {
            provider: item.id,
            state: 'authenticated',
            message: '已验证'
        }]))),
        checkStatuses: async () => { probes += 1; return []; },
        schedulerSnapshot: () => schedulerSnapshot([{ id: 'job-1', provider: 'jimeng', label: '即梦生图' }]),
        journal
    });

    assert.equal(probes, 0);
    assert.equal(health.probeSkipped, 'generation-active');
    assert.equal(health.probed, false);
    assert.equal(health.overall, 'busy');
});

test('缺少内置运行时或正式版 Chrome 时整体不可用', async () => {
    const health = await getGenerationRuntimeHealth({
        registry,
        runtimeStatus: () => ({ ready: false, opsReady: false, message: '运行时缺失' }),
        sessionStore: sessionStore({}),
        schedulerSnapshot: () => schedulerSnapshot(),
        journal
    });
    assert.equal(health.overall, 'unavailable');
    assert.ok(health.providers.every(item => item.state === 'unavailable'));
});
