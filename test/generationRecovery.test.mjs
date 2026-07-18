import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_GENERATION_RECOVERY_TIMEOUT_MS,
    GOOGLE_FLOW_RECOVERY_TIMEOUT_MS,
    getGenerationRecoveryTimeoutMs,
    isGenerationRecoveryExpired
} from '../src/utils/generationRecovery.js';

test('Google Flow 卡死任务使用 18 分钟恢复上限', () => {
    assert.equal(getGenerationRecoveryTimeoutMs('google-flow-omni-flash'), 18 * 60 * 1000);
    assert.equal(GOOGLE_FLOW_RECOVERY_TIMEOUT_MS, 18 * 60 * 1000);
});

test('其他生成任务保留更宽松的 30 分钟恢复上限', () => {
    assert.equal(getGenerationRecoveryTimeoutMs('seedance-2-0'), 30 * 60 * 1000);
    assert.equal(DEFAULT_GENERATION_RECOVERY_TIMEOUT_MS, 30 * 60 * 1000);
});

test('超时生成自动判定为需要恢复，当前任务不会误判', () => {
    const now = 10_000_000;
    assert.equal(isGenerationRecoveryExpired({
        videoModel: 'google-flow-omni-flash',
        generationStartTime: 0
    }, now), false);
    assert.equal(isGenerationRecoveryExpired({
        videoModel: 'google-flow-omni-flash',
        generationStartTime: now - GOOGLE_FLOW_RECOVERY_TIMEOUT_MS + 1
    }, now), false);
    assert.equal(isGenerationRecoveryExpired({
        videoModel: 'google-flow-omni-flash',
        generationStartTime: now - GOOGLE_FLOW_RECOVERY_TIMEOUT_MS
    }, now), true);
});
