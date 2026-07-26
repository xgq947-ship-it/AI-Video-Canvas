import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildJimengWorkflowArgs,
    normalizeJimengResolution,
    JIMENG_DEFAULT_MODEL,
    JIMENG_SUPPORTED_ASPECT_RATIOS,
    JIMENG_SUPPORTED_DURATIONS,
    JIMENG_MINI_WORKFLOW_MODEL_ID,
    JIMENG_WORKFLOW_MODEL_ID,
    JIMENG_FAST_WORKFLOW_MODEL_ID,
    JIMENG_STANDARD_FAST_WORKFLOW_MODEL_ID,
    JIMENG_STANDARD_WORKFLOW_MODEL_ID,
    isJimengWorkflowModelId,
    resolveJimengModelLabel
} from '../server/services/jimengVideoWorkflow.js';
import { GOOGLE_FLOW_WORKFLOW_MODEL_ID } from '../server/services/googleFlowWorkflow.js';
import { getGenerationRecoveryTimeoutMs, GOOGLE_FLOW_RECOVERY_TIMEOUT_MS } from '../src/utils/generationRecovery.js';
import {
    minimumReferenceImages,
    shouldUseReferenceImages,
    usesReferenceMaterialsOnly
} from '../src/utils/videoModelCapabilities.js';

test('即梦 workflow 纯文生视频：不接图也能生成，不传任何 --reference-image', () => {
    const args = buildJimengWorkflowArgs({
        prompt: '  白底棚拍产品展示，柔光  ',
        referenceImages: [],
        duration: 5,
        aspectRatio: '9:16',
        resolution: '720P',
        outputDir: '/tmp/output',
        timeoutMinutes: 15
    });

    assert.deepEqual(args, [
        '--prompt', '白底棚拍产品展示，柔光',
        '--duration', '5',
        '--aspect-ratio', '9:16',
        '--resolution', '720P',
        '--count', '1',
        '--model', JIMENG_DEFAULT_MODEL,
        '--output-dir', '/tmp/output',
        '--timeout-minutes', '15',
        '--execute'
    ]);
    assert.ok(!args.includes('--first-frame'), '即梦没有首帧概念，不该出现 --first-frame');
});

test('即梦 workflow 参考素材按顺序逐个透传', () => {
    const args = buildJimengWorkflowArgs({
        prompt: '参考素材合成',
        referenceImages: ['/tmp/a.png', '/tmp/b.png'],
        duration: 10,
        aspectRatio: '16:9',
        resolution: '1080P',
        outputDir: '/tmp/output',
        timeoutMinutes: 15
    });

    assert.deepEqual(args.slice(0, 6), [
        '--prompt', '参考素材合成',
        '--reference-image', '/tmp/a.png',
        '--reference-image', '/tmp/b.png'
    ]);
});

test('分辨率归一化到页面取值；Auto 回落 720P', () => {
    assert.equal(normalizeJimengResolution('720p'), '720P');
    assert.equal(normalizeJimengResolution('1080P'), '1080P');
    assert.equal(normalizeJimengResolution('4k'), '4K');
    assert.equal(normalizeJimengResolution('Auto'), '720P');
    assert.equal(normalizeJimengResolution(''), '720P');
    assert.throws(() => normalizeJimengResolution('8K'), /分辨率/);
});

test('模型 id 不能撞上 ARK Seedance 的前缀路由', () => {
    // routes/generation.js 用 videoModel.startsWith('seedance-') 判定火山方舟 Seedance，
    // 即梦模型 id 一旦以 seedance- 开头就会被路由到错误的 provider。
    assert.equal(JIMENG_WORKFLOW_MODEL_ID, 'jimeng-seedance-2-0');
    assert.ok(!JIMENG_WORKFLOW_MODEL_ID.startsWith('seedance-'));
    assert.ok(!JIMENG_WORKFLOW_MODEL_ID.startsWith('kling-'));
    assert.ok(!JIMENG_WORKFLOW_MODEL_ID.startsWith('hailuo-'));
    assert.notEqual(JIMENG_WORKFLOW_MODEL_ID, GOOGLE_FLOW_WORKFLOW_MODEL_ID);
});

test('支持的时长/比例与即梦页面一致', () => {
    assert.deepEqual(JIMENG_SUPPORTED_DURATIONS, [4, 5, 6, 8, 10, 15]);
    assert.deepEqual(JIMENG_SUPPORTED_ASPECT_RATIOS, ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
});

test('即梦与 Google Flow 共用本地 workflow 的恢复超时档位', () => {
    assert.equal(getGenerationRecoveryTimeoutMs('jimeng-seedance-2-0'), GOOGLE_FLOW_RECOVERY_TIMEOUT_MS);
    assert.equal(getGenerationRecoveryTimeoutMs('google-flow-omni-flash'), GOOGLE_FLOW_RECOVERY_TIMEOUT_MS);
    assert.equal(getGenerationRecoveryTimeoutMs('google-flow-veo-3-1-lite'), GOOGLE_FLOW_RECOVERY_TIMEOUT_MS);
    assert.notEqual(getGenerationRecoveryTimeoutMs('seedance-2-0'), GOOGLE_FLOW_RECOVERY_TIMEOUT_MS);
});

test('即梦与 Google Flow 共用同一个 Evan 专属 Chrome 串行队列', async () => {
    const queue = await import('../server/services/googleFlowWorkflowQueue.js');
    assert.equal(queue.enqueueBrowserWorkflow, queue.enqueueGoogleFlowWorkflow);
});


test('即梦连任意张数图片都走参考素材，不会被当成首尾帧', () => {
    // 回归：连 3 张图时前端曾把它们当 frame-to-frame（首帧/尾帧 + 丢掉第 3 张），
    // 后端随即报「即梦视频暂不支持尾帧」。
    assert.equal(usesReferenceMaterialsOnly('jimeng-seedance-2-0'), true);
    assert.equal(shouldUseReferenceImages('jimeng-seedance-2-0', 1), true);
    assert.equal(shouldUseReferenceImages('jimeng-seedance-2-0', 3), true);
    assert.equal(minimumReferenceImages('jimeng-seedance-2-0'), 1);
});

test('Google Flow 首帧行为不变：1 张仍是首帧，≥2 张才走 Ingredients', () => {
    assert.equal(usesReferenceMaterialsOnly('google-flow-omni-flash'), false);
    assert.equal(shouldUseReferenceImages('google-flow-omni-flash', 1), false);
    assert.equal(shouldUseReferenceImages('google-flow-omni-flash', 2), true);
    assert.equal(minimumReferenceImages('google-flow-omni-flash'), 2);
});

test('ARK Seedance 不受本地 workflow 参考素材判定影响', () => {
    assert.equal(shouldUseReferenceImages('seedance-2-0', 3), false);
    assert.equal(usesReferenceMaterialsOnly('seedance-2-0'), false);
});


test('参考素材名与图片一一对应地传给 workflow', () => {
    // Python provider 会按同一顺序上传，并把 @素材名改写成「第 N 张参考图」。
    const args = buildJimengWorkflowArgs({
        prompt: '@肯豆 站在 @房间 里',
        referenceImages: ['/tmp/a.png', '/tmp/b.png'],
        referenceLabels: ['肯豆', '房间'],
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720P',
        outputDir: '/tmp/out',
        timeoutMinutes: 15
    });
    assert.deepEqual(args.slice(0, 8), [
        '--prompt', '@肯豆 站在 @房间 里',
        '--reference-image', '/tmp/a.png',
        '--reference-name', '肯豆',
        '--reference-image', '/tmp/b.png'
    ]);
    assert.deepEqual(args.slice(8, 10), ['--reference-name', '房间']);
});

test('没有素材名时不传 --reference-name，由 provider 回落到 图片N', () => {
    const args = buildJimengWorkflowArgs({
        prompt: 'x',
        referenceImages: ['/tmp/a.png'],
        referenceLabels: [],
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720P',
        outputDir: '/tmp/out',
        timeoutMinutes: 15
    });
    assert.ok(!args.includes('--reference-name'));
});

test('Fast VIP 映射到即梦页面模型下拉框的精确文案', () => {
    assert.equal(JIMENG_FAST_WORKFLOW_MODEL_ID, 'jimeng-seedance-2-0-fast');
    assert.equal(resolveJimengModelLabel(JIMENG_FAST_WORKFLOW_MODEL_ID), '即梦 Seedance 2.0 Fast VIP');
    assert.equal(resolveJimengModelLabel(JIMENG_WORKFLOW_MODEL_ID), '即梦 Seedance 2.0 VIP');
    assert.ok(isJimengWorkflowModelId(JIMENG_FAST_WORKFLOW_MODEL_ID));
    assert.ok(isJimengWorkflowModelId(JIMENG_WORKFLOW_MODEL_ID));
    assert.ok(!isJimengWorkflowModelId('seedance-2-0'));
    // Fast VIP 与 Fast 是页面上两个不同选项，provider 按精确文案匹配，不能写成前缀。
    assert.notEqual(resolveJimengModelLabel(JIMENG_FAST_WORKFLOW_MODEL_ID), '即梦 Seedance 2.0 Fast');
});

test('Fast VIP 同样走参考素材语义与本地 workflow 恢复窗口', () => {
    assert.equal(usesReferenceMaterialsOnly('jimeng-seedance-2-0-fast'), true);
    assert.equal(shouldUseReferenceImages('jimeng-seedance-2-0-fast', 1), true);
    assert.equal(getGenerationRecoveryTimeoutMs('jimeng-seedance-2-0-fast'), GOOGLE_FLOW_RECOVERY_TIMEOUT_MS);
});

test('即梦页面五个模型全部映射到精确文案和参考图工作流', () => {
    const models = new Map([
        [JIMENG_MINI_WORKFLOW_MODEL_ID, '即梦 Seedance 2.0 mini'],
        [JIMENG_FAST_WORKFLOW_MODEL_ID, '即梦 Seedance 2.0 Fast VIP'],
        [JIMENG_WORKFLOW_MODEL_ID, '即梦 Seedance 2.0 VIP'],
        [JIMENG_STANDARD_FAST_WORKFLOW_MODEL_ID, '即梦 Seedance 2.0 Fast'],
        [JIMENG_STANDARD_WORKFLOW_MODEL_ID, '即梦 Seedance 2.0']
    ]);

    for (const [modelId, label] of models) {
        assert.equal(resolveJimengModelLabel(modelId), label);
        assert.equal(isJimengWorkflowModelId(modelId), true);
        assert.equal(usesReferenceMaterialsOnly(modelId), true);
        assert.equal(shouldUseReferenceImages(modelId, 1), true);
        assert.equal(getGenerationRecoveryTimeoutMs(modelId), GOOGLE_FLOW_RECOVERY_TIMEOUT_MS);
    }
});
