import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildJimengWorkflowArgs,
    normalizeJimengResolution,
    JIMENG_DEFAULT_MODEL,
    JIMENG_SUPPORTED_ASPECT_RATIOS,
    JIMENG_SUPPORTED_DURATIONS,
    JIMENG_WORKFLOW_MODEL_ID
} from '../server/services/jimengVideoWorkflow.js';
import { GOOGLE_FLOW_WORKFLOW_MODEL_ID } from '../server/services/googleFlowWorkflow.js';
import { getGenerationRecoveryTimeoutMs, GOOGLE_FLOW_RECOVERY_TIMEOUT_MS } from '../src/utils/generationRecovery.js';

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
    assert.notEqual(getGenerationRecoveryTimeoutMs('seedance-2-0'), GOOGLE_FLOW_RECOVERY_TIMEOUT_MS);
});

test('即梦与 Google Flow 共用同一个 9222 串行队列（不能各自排队）', async () => {
    const queue = await import('../server/services/googleFlowWorkflowQueue.js');
    assert.equal(queue.enqueueBrowserWorkflow, queue.enqueueGoogleFlowWorkflow);
});
