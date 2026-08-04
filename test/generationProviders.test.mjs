import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IMAGE_GENERATION_PROVIDERS,
  VIDEO_GENERATION_PROVIDERS,
  applyDiscoveredModelRegistry,
  clampImageOutputCount,
  getImageGenerationProvider,
  getVideoGenerationProvider,
  listImageGenerationProviders,
  listVideoRemixConsistencyImageProviders,
  listVideoGenerationProviders,
  normalizeImageAspectRatio,
  normalizeImageResolution,
  normalizeVideoParameters,
  resolveVideoModelForAspectRatio,
  resetDiscoveredModelRegistry,
  videoModelsForAspectRatio,
  supportedImageOutputCounts,
} from '../shared/generationProviders.js';

test('图片与视频模型注册表使用唯一 ID，并包含 Gemini Web capability', () => {
  assert.equal(new Set(IMAGE_GENERATION_PROVIDERS.map(item => item.id)).size, IMAGE_GENERATION_PROVIDERS.length);
  assert.equal(new Set(VIDEO_GENERATION_PROVIDERS.map(item => item.id)).size, VIDEO_GENERATION_PROVIDERS.length);

  const image = getImageGenerationProvider('gemini-web-image');
  assert.deepEqual(image.supportedAspectRatios, ['16:9', '9:16', '1:1', '3:2', '4:3']);
  assert.equal(image.maxReferenceImages, 5);
  assert.equal(image.supportsMultipleReferenceImages, true);
  assert.equal(image.maxOutputCount, 1);

  const video = getVideoGenerationProvider('gemini-web-video');
  assert.deepEqual(video.supportedAspectRatios, ['16:9', '9:16']);
  assert.deepEqual(video.supportedDurations, [10]);
  assert.equal(video.maxReferenceImages, 1);
  assert.equal(video.supportsMultipleReferenceImages, false);
  assert.equal(video.supportsNativeAudio, true);
  assert.equal(video.supportsExtend, true);
});

test('Video Remix 一致性图片模型包含 Codex CLI 生图', () => {
  const providers = listVideoRemixConsistencyImageProviders();
  const codex = providers.find(item => item.id === 'codex-imagegen');

  assert.ok(codex);
  assert.equal(codex.name, 'Codex CLI · ChatGPT 生图');
  assert.equal(codex.supportsImageToImage, true);
  assert.equal(codex.maxReferenceImages, 14);
});

test('Flow 能力表覆盖文本、首帧、多参考图，且只展示可路由模型', () => {
  const flowImage = getImageGenerationProvider('google-flow-nano-banana-pro');
  assert.deepEqual(flowImage.resolutions, ['1K', '2K']);
  assert.equal(flowImage.defaultResolution, '2K');
  assert.equal(normalizeImageResolution(flowImage.id, undefined), '2K');
  assert.equal(normalizeImageResolution(flowImage.id, 'Auto'), '2K');
  assert.equal(normalizeImageResolution(flowImage.id, '1K'), '1K');

  const omni = getVideoGenerationProvider('google-flow-omni-flash');
  assert.equal(omni.supportsTextToVideo, true);
  assert.equal(omni.supportsImageToVideo, true);
  assert.equal(omni.supportsVideoReference, true);
  assert.equal(omni.maxReferenceImages, 7);
  assert.equal(omni.supportsNativeAudio, true);

  const fast = getVideoGenerationProvider('google-flow-veo-3-1-fast');
  assert.equal(fast.supportsTextToVideo, true);
  assert.equal(fast.supportsImageToVideo, true);
  assert.equal(fast.supportsMultipleReferenceImages, true);
  assert.equal(fast.maxReferenceImages, 3);
  assert.equal(fast.supportsNativeAudio, true);
  assert.equal(fast.supportsVideoReference, undefined);

  const quality = getVideoGenerationProvider('google-flow-veo-3-1-quality');
  assert.equal(quality.supportsImageToVideo, true);
  assert.equal(quality.supportsMultipleReferenceImages, false);
  assert.equal(quality.maxReferenceImages, 1);

  resetDiscoveredModelRegistry();
  applyDiscoveredModelRegistry({
    models: [{
      provider: 'google-flow', id: 'future-unmapped-model', type: 'video',
      displayName: 'Future', inputModes: ['text']
    }]
  });
  assert.equal(listImageGenerationProviders().some(item => item.id === 'future-unmapped-model'), false);
  assert.equal(listVideoGenerationProviders().some(item => item.id === 'future-unmapped-model'), false);
  assert.equal(getVideoGenerationProvider('future-unmapped-model'), null);
  resetDiscoveredModelRegistry();
});

test('产品节点的数量与视频参数完全由统一 capability 约束', () => {
  assert.deepEqual(supportedImageOutputCounts('google-flow-nano-banana-2'), [1, 2, 3, 4]);
  assert.deepEqual(supportedImageOutputCounts('jimeng-image-5-0-lite'), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(supportedImageOutputCounts('jimeng-image-5-0-pro'), [1, 2, 3, 4]);
  assert.deepEqual(getImageGenerationProvider('jimeng-image-5-0-pro').resolutions, ['1K', '2K', '4K']);
  assert.equal(getImageGenerationProvider('jimeng-image-5-0-pro').maxReferenceImages, 10);
  assert.deepEqual(getVideoGenerationProvider('jimeng-seedance-2-0').resolutions, ['720P', '1080P', '4K']);
  assert.deepEqual(getVideoGenerationProvider('jimeng-seedance-2-0-fast').resolutions, ['720P']);
  assert.equal(getVideoGenerationProvider('jimeng-seedance-2-0-standard').maxReferenceImages, 9);
  assert.deepEqual(supportedImageOutputCounts('gemini-web-image'), [1]);
  assert.equal(clampImageOutputCount('gemini-web-image', 4), 1);
  assert.deepEqual(normalizeVideoParameters('gemini-web-video', { aspectRatio: '1:1', duration: 10 }), {
    aspectRatio: '16:9',
    duration: 10,
  });
});

test('画幅收敛到模型能力表：竖构图场景 + Gemini Web 不会带着 3:4 去提交', () => {
  // 回归：产品短视频节点的画幅由场景参考图推断（只会产出 16:9/4:3/1:1/3:4/9:16），
  // 不受所选模型约束。3:4 不在 Gemini Web 的能力表里，未收敛时要等识图跑完几分钟，
  // 才在 Python 侧抛 ASPECT_RATIO_NOT_SUPPORTED。
  assert.equal(normalizeImageAspectRatio('gemini-web-image', '3:4'), '16:9');
  assert.equal(normalizeImageAspectRatio('gemini-web-image', '9:16'), '9:16');
  assert.equal(normalizeImageAspectRatio('google-flow-nano-banana-pro', '3:4'), '3:4');
  // 未知模型不改写调用方的取值。
  assert.equal(normalizeImageAspectRatio('not-a-model', '3:4'), '3:4');
});

test('比例是硬的、模型是软的：视频模型跟着比例走', () => {
  // 产品短视频链路里替换图就是视频首帧，两者比例必须一致。所选视频模型撑不住用户
  // 选的比例时，应该换模型而不是偷偷改比例 —— 改比例会把构图裁掉且不报错。
  assert.equal(resolveVideoModelForAspectRatio('9:16', 'gemini-web-video').modelId, 'gemini-web-video');
  assert.equal(resolveVideoModelForAspectRatio('9:16', 'gemini-web-video').switched, false);

  // Gemini Web 视频只支持 16:9 / 9:16；3:4 必须换成支持它的模型。
  const switched = resolveVideoModelForAspectRatio('3:4', 'gemini-web-video');
  assert.equal(switched.switched, true);
  assert.equal(switched.from, 'gemini-web-video');
  assert.ok(getVideoGenerationProvider(switched.modelId).supportedAspectRatios.includes('3:4'));
  // 优先浏览器模型：换过去不该要求用户再去配 API Key。
  assert.ok(getVideoGenerationProvider(switched.modelId).browserProvider);

  // 一个都没有时返回 null，由调用方明确拒绝，不做静默裁切。
  assert.equal(resolveVideoModelForAspectRatio('3:2', 'gemini-web-video'), null);
  assert.deepEqual(videoModelsForAspectRatio('3:2'), []);
  assert.ok(videoModelsForAspectRatio('9:16').length > 0);
});
