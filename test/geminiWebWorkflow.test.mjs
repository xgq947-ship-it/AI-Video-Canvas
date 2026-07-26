import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGeminiWebImageArgs,
  buildGeminiWebVideoArgs,
  isGeminiWebImageModel,
  isGeminiWebVideoModel,
} from '../server/services/geminiWebWorkflow.js';

test('Gemini Web 生图参数经独立 Provider 原样进入 Ops CLI', () => {
  assert.equal(isGeminiWebImageModel('gemini-web-image'), true);
  const args = buildGeminiWebImageArgs({
    prompt: '  商业产品图  ', aspectRatio: '4:3',
    referenceImages: ['/tmp/a.png', '/tmp/b.png'], outputDir: '/tmp/output', timeoutMinutes: 10,
  });
  assert.deepEqual(args, [
    'text-to-image', 'gemini-web', 'generate', '--prompt', '商业产品图',
    '--aspect-ratio', '4:3', '--count', '1', '--output-dir', '/tmp/output',
    '--timeout-minutes', '10', '--reference-image', '/tmp/a.png',
    '--reference-image', '/tmp/b.png', '--execute',
  ]);
});

test('Gemini Web 视频参数包含画幅、时长、运镜、原生音频与参考图', () => {
  assert.equal(isGeminiWebVideoModel('gemini-web-video'), true);
  const args = buildGeminiWebVideoArgs({
    prompt: '产品推镜头', aspectRatio: '9:16', duration: 8,
    referenceImages: ['/tmp/a.png'], outputDir: '/tmp/video', timeoutMinutes: 15,
    cameraMovement: '推镜头', nativeAudio: true,
  });
  assert.deepEqual(args, [
    'image-to-video', 'gemini-web', 'generate', '--prompt', '产品推镜头',
    '--aspect-ratio', '9:16', '--duration', '8', '--output-dir', '/tmp/video',
    '--timeout-minutes', '15', '--camera-movement', '推镜头', '--native-audio',
    '--reference-image', '/tmp/a.png', '--execute',
  ]);
});
