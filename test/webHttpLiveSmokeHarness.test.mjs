import assert from 'node:assert/strict';
import test from 'node:test';

import {
    assertLiveExecutionGate,
    buildLiveSmokeMatrix,
    buildSmokePayload
} from '../scripts/web-http-live-smoke.mjs';
import {
    IMAGE_GENERATION_PROVIDERS,
    VIDEO_GENERATION_PROVIDERS
} from '../shared/generationProviders.js';

const WEB = new Set(['google-flow', 'gemini-web', 'jimeng']);

test('真实冒烟矩阵覆盖每个 Web 图片模型的所有已声明能力', () => {
    const matrix = buildLiveSmokeMatrix();
    const models = IMAGE_GENERATION_PROVIDERS.filter(model => WEB.has(model.browserProvider));
    for (const model of models) {
        const modes = new Set(matrix.filter(item => item.modelId === model.id && item.kind === 'image').map(item => item.mode));
        assert.equal(modes.has('text'), true, `${model.id} 缺文生图`);
        assert.equal(modes.has('reference'), model.supportsImageToImage && model.maxReferenceImages >= 1);
        assert.equal(modes.has('multi-reference'), model.supportsMultipleReferenceImages && model.maxReferenceImages >= 2);
        assert.equal(modes.has('multi-output'), model.supportsMultipleOutputs && model.maxOutputCount >= 2);
    }
    const free = matrix.filter(item => item.quotaClass === 'free');
    assert.ok(free.length > 0);
    assert.ok(free.every(item => item.modelId === 'jimeng-image-5-0-lite'));
});

test('真实冒烟矩阵只给支持的 Web 视频模型生成对应模式', () => {
    const matrix = buildLiveSmokeMatrix();
    const models = VIDEO_GENERATION_PROVIDERS.filter(model => WEB.has(model.browserProvider));
    for (const model of models) {
        const modes = new Set(matrix.filter(item => item.modelId === model.id && item.kind === 'video').map(item => item.mode));
        assert.equal(modes.has('text'), model.supportsTextToVideo);
        assert.equal(modes.has('reference'), model.supportsImageToVideo && model.maxReferenceImages >= 1);
        assert.equal(
            modes.has('multi-reference'),
            model.supportsImageToVideo && model.supportsMultipleReferenceImages && model.maxReferenceImages >= 2,
            `${model.id} 多参考图矩阵与 capability 不一致`
        );
    }
    assert.equal(matrix.length, 51, '能力表变化时必须显式审阅并更新冒烟矩阵预期');
});

test('真实生成必须同时通过环境锁和显式范围锁', () => {
    assert.doesNotThrow(() => assertLiveExecutionGate({ execute: false, environment: {}, selectionExplicit: false }));
    assert.throws(() => assertLiveExecutionGate({ execute: true, environment: {}, selectionExplicit: true }), /EVAN_LIVE_SMOKE/);
    assert.throws(() => assertLiveExecutionGate({
        execute: true,
        environment: { EVAN_LIVE_SMOKE: '1' },
        selectionExplicit: false
    }), /显式指定/);
    assert.doesNotThrow(() => assertLiveExecutionGate({
        execute: true,
        environment: { EVAN_LIVE_SMOKE: '1' },
        selectionExplicit: true
    }));
});

test('冒烟请求按模式映射到真实 API 契约，不为不支持模式伪造字段', () => {
    const matrix = buildLiveSmokeMatrix();
    const references = ['data:image/png;base64,AA==', 'data:image/png;base64,AQ=='];
    const multiImage = matrix.find(item => item.id === 'image/jimeng-image-5-0-lite/multi-reference');
    const imageRequest = buildSmokePayload(multiImage, { workflowId: 'workflow-test', references, runId: 1 });
    assert.equal(imageRequest.endpoint, '/api/generate-image');
    assert.deepEqual(imageRequest.body.imageBase64, references);

    const multiVideo = matrix.find(item => item.id === 'video/google-flow-veo-3-1-lite/multi-reference');
    const videoRequest = buildSmokePayload(multiVideo, { workflowId: 'workflow-test', references, runId: 2 });
    assert.equal(videoRequest.endpoint, '/api/generate-video');
    assert.deepEqual(videoRequest.body.referenceImages, references);
    assert.equal('imageBase64' in videoRequest.body, false);

    const gemini = matrix.find(item => item.id === 'video/gemini-web-video/reference');
    const geminiRequest = buildSmokePayload(gemini, { workflowId: 'workflow-test', references, runId: 3 });
    assert.equal(geminiRequest.body.imageBase64, references[0]);
    assert.equal('referenceImages' in geminiRequest.body, false);
});
