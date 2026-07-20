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
  const refs = collectNodeReferences(['i1', 'v1', 'a1'], nodes);
  assert.deepEqual(
    [...extractReferenceLabels('让 @参考图1 模仿 @视频1 的动作，音色用 @音频1', refs)],
    ['参考图1', '参考视频1', '参考语音1'],
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

test('已保存为素材的节点，引用标签直接用素材名，未命名的素材编号保持连续', () => {
  const namedNodes = [
    { id: 'c1', type: 'Image', title: '人物照', resultUrl: '/c1.png', assetName: '人物肯豆' },
    { id: 'i1', type: 'Image', resultUrl: '/i1.png' },
    { id: 'v1', type: 'Video', resultUrl: '/v1.mp4', assetName: '桌子' },
  ];
  const refs = collectNodeReferences(['c1', 'i1', 'v1'], namedNodes);
  assert.deepEqual(refs.map(ref => ref.label), ['人物肯豆', '参考图1', '桌子']);

  assert.deepEqual(
    [...extractReferenceLabels('@人物肯豆 站在 @参考图1 旁边，穿过 @桌子', refs)],
    ['人物肯豆', '参考图1', '桌子'],
  );
  assert.deepEqual(
    selectPromptReferences(refs, '只用 @桌子').map(ref => ref.id),
    ['v1'],
  );
});

test('素材名不会被同名前缀的编号标签误匹配（最长匹配优先）', () => {
  const namedNodes = [
    { id: 'i1', type: 'Image', resultUrl: '/i1.png' }, // 参考图1
    { id: 'i2', type: 'Image', resultUrl: '/i2.png' }, // 参考图2
  ];
  const refs = collectNodeReferences(['i1', 'i2'], namedNodes);
  assert.deepEqual(
    [...extractReferenceLabels('只用 @参考图2', refs)],
    ['参考图2'],
  );
});
