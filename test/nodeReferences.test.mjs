import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectNodeReferences,
  extractReferenceLabels,
  selectPromptReferences,
} from '../src/utils/nodeReferences.js';

const nodes = [
  { id: 'i1', type: 'Image', title: '人物', resultUrl: '/i1.png' },
  { id: 'v1', type: 'Video', title: '动作', resultUrl: '/v1.mp4', lastFrame: '/v1-last.png' },
  { id: 'i2', type: 'Image Editor', resultUrl: '/i2.png' },
  { id: 'a1', type: 'Audio', mediaUrl: '/a1.mp3' },
  { id: 'v2', type: 'Video Editor', resultUrl: '/v2.mp4' },
  { id: 't1', type: 'Text', prompt: '不应成为参考素材' },
];

test('连接素材按类型独立编号并保留连线顺序', () => {
  const refs = collectNodeReferences(['i1', 'v1', 'i2', 'a1', 'v2', 't1'], nodes);
  assert.deepEqual(refs.map(ref => ref.label), [
    '参考图1', '参考视频1', '参考图2', '参考语音1', '参考视频2',
  ]);
  assert.equal(refs[1].previewUrl, '/v1-last.png');
});

test('@ 参考标签支持标准名和常用简写', () => {
  assert.deepEqual(
    [...extractReferenceLabels('让 @参考图2 模仿 @视频1 的动作，音色用 @音频1')],
    ['参考图2', '参考视频1', '参考语音1'],
  );
});

test('无 @ 默认使用全部参考，有 @ 只传被点名素材', () => {
  const refs = collectNodeReferences(['i1', 'i2', 'v1', 'a1'], nodes);
  assert.equal(selectPromptReferences(refs, '镜头缓慢推进').length, 4);
  assert.deepEqual(
    selectPromptReferences(refs, '外观用 @参考图2，动作用 @参考视频1').map(ref => ref.id),
    ['i2', 'v1'],
  );
});
