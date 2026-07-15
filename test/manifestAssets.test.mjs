import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAssetPath, findMissingAssets } from '../server/utils/manifestAssets.js';

const makeLib = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-'));
  fs.mkdirSync(path.join(dir, 'videos'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'videos', 'a.mp4'), 'x');
  fs.writeFileSync(path.join(dir, 'audio', 'b.mp3'), 'x');
  return dir;
};

test('resolveAssetPath 解析到 library 内部', () => {
  const lib = makeLib();
  const p = resolveAssetPath(lib, '/library/videos/a.mp4');
  assert.equal(p, path.join(lib, 'videos', 'a.mp4'));
});

test('resolveAssetPath 阻止路径穿越', () => {
  const lib = makeLib();
  assert.throws(() => resolveAssetPath(lib, '/library/../../../etc/passwd'), /越界/);
  assert.throws(() => resolveAssetPath(lib, '../../secret.txt'), /越界/);
  assert.throws(() => resolveAssetPath(lib, ''), /为空/);
});

test('findMissingAssets 找出缺失素材', () => {
  const lib = makeLib();
  const manifest = {
    shots: [
      { id: 's1', file: '/library/videos/a.mp4' }, // 存在
      { id: 's2', file: '/library/videos/missing.mp4' }, // 缺失
    ],
    audioTracks: [
      { id: 'a1', file: '/library/audio/b.mp3' }, // 存在
      { id: 'a2', file: '/library/audio/../../evil.mp3' }, // 越界
    ],
  };
  const missing = findMissingAssets(lib, manifest);
  const raws = missing.map((m) => m.raw);
  assert.ok(raws.includes('/library/videos/missing.mp4'));
  assert.ok(raws.some((r) => r.includes('evil.mp3')));
  assert.equal(missing.length, 2);
});
