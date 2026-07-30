import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildVideoRemixCalibrationPlan,
  calibrateVideoRemixShot,
} from '../server/services/videoRemix/shotVideo.js';

test('本地时长计划优先裁剪，短片只允许 0.85x 以上轻微变速', () => {
  assert.deepEqual(
    buildVideoRemixCalibrationPlan({
      sourceDuration: 5,
      targetDuration: 3.2,
      trimStart: 0.7,
    }),
    {
      sourceDuration: 5,
      targetDuration: 3.2,
      trimStart: 0.7,
      trimEnd: 3.9,
      speed: 1,
      calibration: 'trim',
    }
  );
  const speed = buildVideoRemixCalibrationPlan({
    sourceDuration: 10,
    targetDuration: 11.5,
  });
  assert.equal(speed.speed, 0.87);
  assert.equal(speed.calibration, 'speed');
  assert.throws(() => buildVideoRemixCalibrationPlan({
    sourceDuration: 8,
    targetDuration: 10,
  }), /0.85x/);
});

test('校准只读取当前项目视频，调用内置 FFmpeg 并复用相同输入缓存', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-remix-video-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const libraryDir = path.join(root, 'library');
  const projectsDir = path.join(libraryDir, 'projects');
  const workflowsDir = path.join(root, 'workflows');
  const projectRoot = path.join(projectsDir, '时长校准项目');
  const rawDirectory = path.join(projectRoot, 'videos');
  fs.mkdirSync(rawDirectory, { recursive: true });
  fs.mkdirSync(workflowsDir, { recursive: true });
  fs.writeFileSync(
    path.join(workflowsDir, 'workflow_1.json'),
    JSON.stringify({
      id: 'workflow_1',
      title: '时长校准项目',
      projectDirName: '时长校准项目',
      nodes: [],
    })
  );
  fs.writeFileSync(path.join(rawDirectory, 'raw.mp4'), 'raw-video');

  const invocations = [];
  const result = await calibrateVideoRemixShot({
    workflowId: 'workflow_1',
    remixId: 'remix_1',
    shotId: 'shot_001',
    sourceUrl: '/library/projects/%E6%97%B6%E9%95%BF%E6%A0%A1%E5%87%86%E9%A1%B9%E7%9B%AE/videos/raw.mp4',
    targetDuration: 3.2,
    trimStart: 0.5,
  }, {
    libraryDir,
    projectsDir,
    workflowsDir,
    probeImpl: async () => ({
      duration: 5,
      width: 1280,
      height: 720,
      fps: 24,
      hasAudio: true,
      orientation: 'landscape',
    }),
    runProcessImpl: async (command, args) => {
      invocations.push({ command, args });
      fs.writeFileSync(args.at(-1), 'calibrated-video');
      return { stdout: '', stderr: '' };
    },
    ffmpegPath: '/bundled/ffmpeg',
  });

  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].command, '/bundled/ffmpeg');
  assert.equal(invocations[0].args.includes('libx264'), true);
  assert.equal(
    invocations[0].args[invocations[0].args.indexOf('-t') + 1],
    '3.200'
  );
  assert.equal(result.sourceDuration, 5);
  assert.equal(result.targetDuration, 3.2);
  assert.equal(result.trimStart, 0.5);
  assert.match(result.url, /video-remix\/remix_1\/videos\/shot_001_/);
  assert.equal(fs.existsSync(path.join(
    projectRoot,
    result.url.split('/').slice(-4).map(decodeURIComponent).join('/')
  )), true);

  const cached = await calibrateVideoRemixShot({
    workflowId: 'workflow_1',
    remixId: 'remix_1',
    shotId: 'shot_001',
    sourceUrl: '/library/projects/%E6%97%B6%E9%95%BF%E6%A0%A1%E5%87%86%E9%A1%B9%E7%9B%AE/videos/raw.mp4',
    targetDuration: 3.2,
    trimStart: 0.5,
  }, {
    libraryDir,
    projectsDir,
    workflowsDir,
    probeImpl: async () => ({
      duration: 5,
      width: 1280,
      height: 720,
      fps: 24,
      hasAudio: true,
      orientation: 'landscape',
    }),
    runProcessImpl: async () => {
      throw new Error('cache should skip FFmpeg');
    },
    ffmpegPath: '/bundled/ffmpeg',
  });
  assert.equal(cached.cached, true);
});
