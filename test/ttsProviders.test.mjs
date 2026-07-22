import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TTS_PROVIDERS,
  canGenerateTtsDirectly,
  getTtsProvider,
  isKnownTtsProvider,
  normalizeTtsProvider,
} from '../shared/ttsProviders.js';

test('配音供应商列表只保留外部平台、本地与通用导入', () => {
  const ids = TTS_PROVIDERS.map((provider) => provider.id);
  assert.deepEqual(ids, [
    'chatcut-elevenlabs',
    'doubao',
    'fish-audio',
    'qwen-local',
    'import',
  ]);
});

test('旧项目未设置或仍保存 MiniMax 时回退到导入模式', () => {
  assert.equal(normalizeTtsProvider(undefined), 'import');
  assert.equal(normalizeTtsProvider('minimax'), 'import');
  assert.equal(getTtsProvider(undefined).label, '仅导入音频');
  assert.equal(canGenerateTtsDirectly(undefined), false);
});

test('未知供应商不会被当成已支持供应商', () => {
  assert.equal(isKnownTtsProvider('unknown-cloud'), false);
  assert.equal(isKnownTtsProvider('minimax'), false);
});

test('外部与本地音色通过导入进入统一音频节点', () => {
  assert.equal(canGenerateTtsDirectly('chatcut-elevenlabs'), false);
  assert.equal(canGenerateTtsDirectly('doubao'), false);
  assert.equal(canGenerateTtsDirectly('fish-audio'), false);
  assert.equal(canGenerateTtsDirectly('qwen-local'), false);
  assert.equal(getTtsProvider('qwen-local').mode, 'local');
});
