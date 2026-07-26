import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IMAGE_GENERATION_PROVIDERS,
  VIDEO_GENERATION_PROVIDERS,
  clampImageOutputCount,
  getImageGenerationProvider,
  getVideoGenerationProvider,
  normalizeImageAspectRatio,
  normalizeVideoParameters,
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
  assert.deepEqual(video.supportedDurations, [8]);
  assert.equal(video.maxReferenceImages, 3);
  assert.equal(video.supportsNativeAudio, true);
  assert.equal(video.supportsExtend, true);
});

test('产品节点的数量与视频参数完全由统一 capability 约束', () => {
  assert.deepEqual(supportedImageOutputCounts('google-flow-nano-banana-2'), [1, 2, 3, 4]);
  assert.deepEqual(supportedImageOutputCounts('gemini-web-image'), [1]);
  assert.equal(clampImageOutputCount('gemini-web-image', 4), 1);
  assert.deepEqual(normalizeVideoParameters('gemini-web-video', { aspectRatio: '1:1', duration: 10 }), {
    aspectRatio: '16:9',
    duration: 8,
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
