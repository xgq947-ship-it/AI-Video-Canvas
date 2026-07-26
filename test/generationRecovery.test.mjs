import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_GENERATION_RECOVERY_TIMEOUT_MS,
    GOOGLE_FLOW_RECOVERY_TIMEOUT_MS,
    PRODUCT_SCENE_ANALYSIS_RECOVERY_TIMEOUT_MS,
    PRODUCT_SCENE_GENERATION_RECOVERY_TIMEOUT_MS,
    getBackendRestartedGenerationMessage,
    getInterruptedGenerationMessage,
    getGenerationRecoveryTimeoutMs,
    isBrowserWorkflowGeneration,
    isGenerationRecoveryExpired,
    wasGenerationInterruptedByBackendRestart
} from '../src/utils/generationRecovery.js';

test('Google Flow 卡死任务使用 18 分钟恢复上限', () => {
    assert.equal(getGenerationRecoveryTimeoutMs('google-flow-omni-flash'), 18 * 60 * 1000);
    assert.equal(getGenerationRecoveryTimeoutMs({ imageModel: 'google-flow-nano-banana-2' }), 18 * 60 * 1000);
    assert.equal(getGenerationRecoveryTimeoutMs({ imageModel: 'jimeng-image-5-0-pro' }), 18 * 60 * 1000);
    assert.equal(GOOGLE_FLOW_RECOVERY_TIMEOUT_MS, 18 * 60 * 1000);
});

test('浏览器任务中断时先检查平台历史，不能引导用户直接重复生成', () => {
    const flowImage = { imageModel: 'google-flow-nano-banana-2' };
    const jimengVideo = { videoModel: 'jimeng-seedance-2-0' };
    assert.equal(isBrowserWorkflowGeneration(flowImage), true);
    assert.equal(isBrowserWorkflowGeneration(jimengVideo), true);
    assert.match(getInterruptedGenerationMessage(flowImage), /平台历史记录/);
    assert.match(getInterruptedGenerationMessage(flowImage), /避免重复/);
    assert.doesNotMatch(getInterruptedGenerationMessage(flowImage), /^生成任务已中断或超时，请重新生成/);
    assert.equal(
        getInterruptedGenerationMessage({ videoModel: 'seedance-2-0' }),
        '生成任务已中断或超时，请重新生成。'
    );
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

test('后台启动时间晚于任务开始时间时立即判定本地等待已中断', () => {
    const node = {
        imageModel: 'google-flow-nano-banana-2',
        generationStartTime: 1_000
    };
    assert.equal(wasGenerationInterruptedByBackendRestart(node, 999), false);
    assert.equal(wasGenerationInterruptedByBackendRestart(node, 1_000), false);
    assert.equal(wasGenerationInterruptedByBackendRestart(node, 1_001), true);
    assert.equal(wasGenerationInterruptedByBackendRestart(node, undefined), false);
    assert.match(getBackendRestartedGenerationMessage(node), /已停止等待/);
    assert.match(getBackendRestartedGenerationMessage(node), /平台任务可能仍在继续/);
    assert.match(getBackendRestartedGenerationMessage(node), /避免重复/);
});
