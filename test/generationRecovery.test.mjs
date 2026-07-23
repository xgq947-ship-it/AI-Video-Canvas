import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_GENERATION_RECOVERY_TIMEOUT_MS,
    GOOGLE_FLOW_RECOVERY_TIMEOUT_MS,
    PRODUCT_SCENE_ANALYSIS_RECOVERY_TIMEOUT_MS,
    PRODUCT_SCENE_GENERATION_RECOVERY_TIMEOUT_MS,
    getGenerationRecoveryTimeoutMs,
    isGenerationRecoveryExpired
} from '../src/utils/generationRecovery.js';

test('Google Flow 卡死任务使用 18 分钟恢复上限', () => {
    assert.equal(getGenerationRecoveryTimeoutMs('google-flow-omni-flash'), 18 * 60 * 1000);
    assert.equal(GOOGLE_FLOW_RECOVERY_TIMEOUT_MS, 18 * 60 * 1000);
});

test('产品场景替换按分析与生成阶段使用不同恢复窗口', () => {
    assert.equal(getGenerationRecoveryTimeoutMs({
        type: 'Product Scene Replace',
        productSceneStage: 'analyzing'
    }), PRODUCT_SCENE_ANALYSIS_RECOVERY_TIMEOUT_MS);
    assert.equal(getGenerationRecoveryTimeoutMs({
        type: 'Product Scene Replace',
        productSceneStage: 'generating'
    }), PRODUCT_SCENE_GENERATION_RECOVERY_TIMEOUT_MS);
    // 兼容修复前没有 stage 的持久化节点：没有分析结果即视为分析阶段。
    assert.equal(getGenerationRecoveryTimeoutMs({
        type: 'Product Scene Replace'
    }), PRODUCT_SCENE_ANALYSIS_RECOVERY_TIMEOUT_MS);
    // 重跑时节点上仍留着上一轮的分析结果，stage 优先，避免分析阶段被放宽到 13 分钟。
    assert.equal(getGenerationRecoveryTimeoutMs({
        type: 'Product Scene Replace',
        productSceneStage: 'analyzing',
        sceneAnalysis: '上一轮场景规格',
        productAnalysis: '上一轮产品规格'
    }), PRODUCT_SCENE_ANALYSIS_RECOVERY_TIMEOUT_MS);
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
