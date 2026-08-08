import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  secToFrames,
  normalizeAssetPath,
  layoutShots,
  computeShotsDurationSec,
  computeTotalDurationSec,
  getDialogueWindows,
  validateManifestShape,
  collectAssetRefs,
  buildManifestFromNodes,
  MANGA_NODE_TYPES,
} from '../shared/manifest.js';

test('secToFrames 按 fps 折算并四舍五入', () => {
  assert.equal(secToFrames(1, 24), 24);
  assert.equal(secToFrames(0.5, 24), 12);
  assert.equal(secToFrames(1.02, 24), 24); // 24.48 -> 24
  assert.equal(secToFrames(undefined, 24), 0);
});

test('normalizeAssetPath 归一化为 staticFile 相对路径', () => {
  assert.equal(normalizeAssetPath('/library/videos/a.mp4'), 'videos/a.mp4');
  assert.equal(normalizeAssetPath('library/audio/b.mp3'), 'audio/b.mp3');
  assert.equal(normalizeAssetPath('http://localhost:3001/library/videos/c.mp4?t=1'), 'videos/c.mp4');
  assert.equal(normalizeAssetPath('videos\\d.mp4'), 'videos/d.mp4');
  assert.equal(normalizeAssetPath(''), '');
});

test('layoutShots 按 order 排序并累计入点', () => {
  const shots = [
    { id: 'b', file: 'b.mp4', start: 1, end: 3, order: 2 },
    { id: 'a', file: 'a.mp4', start: 0, end: 4, order: 1 },
  ];
  const L = layoutShots(shots);
  assert.equal(L[0].shot.id, 'a');
  assert.equal(L[0].fromSec, 0);
  assert.equal(L[0].durationSec, 4);
  assert.equal(L[1].shot.id, 'b');
  assert.equal(L[1].fromSec, 4); // 接在 a 后面
  assert.equal(L[1].durationSec, 2);
  assert.equal(computeShotsDurationSec(shots), 6);
});

test('computeTotalDurationSec 取镜头与音轨的最大结束', () => {
  const manifest = {
    shots: [{ file: 'a.mp4', start: 0, end: 5 }],
    audioTracks: [{ type: 'bgm', file: 'b.mp3', start: 0, end: 9 }],
  };
  assert.equal(computeTotalDurationSec(manifest), 9);
});

test('getDialogueWindows 仅取 dialogue 音轨', () => {
  const manifest = {
    audioTracks: [
      { type: 'dialogue', start: 1, end: 4 },
      { type: 'bgm', start: 0, end: 9 },
    ],
  };
  assert.deepEqual(getDialogueWindows(manifest), [{ start: 1, end: 4 }]);
});

test('validateManifestShape 捕获非法结构', () => {
  assert.equal(validateManifestShape(null).valid, false);
  const bad = { composition: { width: 0, height: 720, fps: 24 }, shots: [{ file: '', start: 0, end: 0 }] };
  const r = validateManifestShape(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.length >= 2);

  const good = {
    composition: { width: 1280, height: 720, fps: 24 },
    shots: [{ file: 'a.mp4', start: 0, end: 5 }],
    audioTracks: [],
  };
  assert.equal(validateManifestShape(good).valid, true);
  assert.equal(validateManifestShape({
    ...good,
    shots: [{ ...good.shots[0], transition: 'zoom' }],
  }).valid, false);
});

test('collectAssetRefs 收集镜头与音轨素材', () => {
  const manifest = {
    shots: [{ id: 's1', file: '/library/videos/a.mp4' }],
    audioTracks: [{ id: 'a1', file: '/library/audio/b.mp3' }],
  };
  const refs = collectAssetRefs(manifest);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].path, 'videos/a.mp4');
  assert.equal(refs[1].path, 'audio/b.mp3');
});

test('buildManifestFromNodes 从节点图组装清单', () => {
  const T = MANGA_NODE_TYPES;
  const nodes = [
    { id: 'r', type: T.RENDER, title: '成片', parentIds: ['v1', 'v2', 'd1', 'bgm1'] },
    { id: 'v2', type: T.VIDEO, resultUrl: '/library/videos/s2.mp4', trimStart: 0, trimEnd: 5, order: 2, x: 200 },
    { id: 'v1', type: T.VIDEO, resultUrl: '/library/videos/s1.mp4', trimStart: 0, trimEnd: 4, order: 1, transition: 'fade', x: 100 },
    { id: 'd1', type: T.AUDIO, mediaUrl: '/library/audio/d.mp3', timelineStart: 1, durationSec: 3, speaker: '林默' },
    { id: 'bgm1', type: T.BGM, mediaUrl: '/library/audio/bgm.mp3', timelineStart: 0, timelineEnd: 9 },
    { id: 'stray', type: T.SFX, mediaUrl: '/library/audio/x.mp3' }, // 未连接，应被忽略
  ];
  const m = buildManifestFromNodes('r', nodes, { composition: { width: 1280, height: 720, fps: 24 } });

  assert.equal(m.shots.length, 2);
  assert.equal(m.shots[0].file, '/library/videos/s1.mp4'); // order=1 在前
  assert.equal(m.shots[0].order, 1);
  assert.equal(m.shots[0].transition, 'fade');
  assert.equal(m.shots[1].order, 2);

  assert.equal(m.audioTracks.length, 2);
  const dia = m.audioTracks.find((t) => t.type === 'dialogue');
  assert.equal(dia.start, 1);
  assert.equal(dia.end, 4); // start + durationSec(3)
  const bgm = m.audioTracks.find((t) => t.type === 'bgm');
  assert.equal(bgm.ducking, true); // BGM 默认闪避

  // 未连接的 SFX 节点不进入清单
  assert.ok(!m.audioTracks.some((t) => t.file.includes('x.mp3')));

  // 组装结果结构合法
  assert.equal(validateManifestShape(m).valid, true);
});
