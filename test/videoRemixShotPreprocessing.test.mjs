import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parseSceneDetectionOutput,
  preprocessReferenceVideo,
  updateVideoRemixShotTimeline,
} from '../server/services/videoRemix/shotPreprocessing.js';

const PROBE = Object.freeze({
  duration: 3,
  width: 1280,
  height: 720,
  fps: 30,
  codec: 'h264',
  audioCodec: 'aac',
  hasAudio: true,
  orientation: 'landscape',
});

function makeContext(t) {
  const libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-remix-shots-'));
  t.after(() => fs.rmSync(libraryDir, { recursive: true, force: true }));
  const workflowsDir = path.join(libraryDir, 'workflows');
  const projectsDir = path.join(libraryDir, 'projects');
  const projectRoot = path.join(projectsDir, '镜头测试项目');
  const sourceDirectory = path.join(
    projectRoot,
    'video-remix',
    'remix_shots',
    'source',
    'ref_source'
  );
  fs.mkdirSync(workflowsDir, { recursive: true });
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.writeFileSync(path.join(workflowsDir, 'workflow-1.json'), JSON.stringify({
    id: 'workflow-1',
    title: '镜头测试项目',
    projectDirName: '镜头测试项目',
    nodes: [],
  }));
  const originalPath = path.join(sourceDirectory, 'original.mp4');
  fs.writeFileSync(originalPath, Buffer.from('immutable-original'));
  const invocations = [];
  const context = {
    libraryDir,
    workflowsDir,
    projectsDir,
    frameConcurrency: 1,
    probeImpl: async () => ({ ...PROBE }),
    runProcessImpl: async (_command, args) => {
      invocations.push(args);
      const outputPath = args.at(-1);
      if (args.includes('-filter:v')) {
        return {
          stdout: '',
          stderr: [
            'frame:0 pts:15360 pts_time:1',
            'lavfi.scene_score=0.812500',
            'frame:1 pts:30720 pts_time:2',
            'lavfi.scene_score=0.625000',
          ].join('\n'),
        };
      }
      await fsp.mkdir(path.dirname(outputPath), { recursive: true });
      await fsp.writeFile(
        outputPath,
        outputPath.endsWith('.jpg') ? Buffer.from('jpeg') : Buffer.from('proxy')
      );
      return { stdout: '', stderr: '' };
    },
  };
  const source = {
    id: 'ref_source',
    sourceType: 'local',
    localUrl: '/library/projects/%E9%95%9C%E5%A4%B4%E6%B5%8B%E8%AF%95%E9%A1%B9%E7%9B%AE/video-remix/remix_shots/source/ref_source/original.mp4',
    originalFilename: 'original.mp4',
    ...PROBE,
  };
  return { context, source, originalPath, invocations };
}

test('解析 FFmpeg metadata 输出为有序场景切点', () => {
  assert.deepEqual(parseSceneDetectionOutput([
    'frame:0 pts:100 pts_time:2',
    'lavfi.scene_score=0.400000',
    'frame:1 pts:50 pts_time:1',
    'lavfi.scene_score=0.700000',
    'frame:2 pts:50 pts_time:1',
    'lavfi.scene_score=0.800000',
  ].join('\n')), [
    { time: 1, score: 0.8 },
    { time: 2, score: 0.4 },
  ]);
});

test('预处理生成 15fps H.264 代理、自动 Shot 与每镜头五帧', async (t) => {
  const {
    context,
    source,
    originalPath,
    invocations,
  } = makeContext(t);
  const originalBytes = fs.readFileSync(originalPath);
  const result = await preprocessReferenceVideo({
    workflowId: 'workflow-1',
    remixId: 'remix_shots',
    source,
    threshold: 0.3,
  }, context);

  assert.equal(result.shots.length, 3);
  assert.deepEqual(result.shots.map(shot => [shot.start, shot.end]), [
    [0, 1],
    [1, 2],
    [2, 3],
  ]);
  assert.equal(result.shots[1].detection.source, 'ffmpeg');
  assert.equal(result.shots[1].detection.score, 0.8125);
  assert.equal(result.shots.every(shot => shot.analysisFrames.length === 5), true);
  assert.deepEqual(
    result.shots[0].analysisFrames.map(frame => frame.position),
    ['start', 'quarter', 'middle', 'three_quarter', 'end']
  );
  assert.deepEqual(fs.readFileSync(originalPath), originalBytes);

  const proxyInvocation = invocations.find(args => args.includes('libx264'));
  assert.ok(proxyInvocation);
  assert.ok(proxyInvocation.includes('veryfast'));
  assert.match(proxyInvocation[proxyInvocation.indexOf('-vf') + 1], /fps=15/);
  const proxyPath = path.join(
    context.libraryDir,
    decodeURIComponent(result.proxyUrl.replace('/library/', ''))
  );
  assert.deepEqual(fs.readFileSync(proxyPath), Buffer.from('proxy'));

  const manifest = JSON.parse(fs.readFileSync(
    path.join(path.dirname(proxyPath), 'shots.json'),
    'utf8'
  ));
  assert.equal(manifest.sceneThreshold, 0.3);
  assert.equal(manifest.shots[0].analysisFrames[0].url, undefined);
  assert.equal(manifest.shots[0].analysisFrames[0].file, 'shots/shot_001/frames/start.jpg');
});

test('FFmpeg 没有实际写出分析帧时拒绝残缺时间线', async (t) => {
  const { context, source } = makeContext(t);
  const runProcess = context.runProcessImpl;
  context.runProcessImpl = async (command, args) => {
    // path.basename 而非 endsWith('/end.jpg')：源码用 path.join 拼输出路径，
    // Windows 上分隔符是 \，写死 / 会让这条拦截永远不命中，模拟的“帧没写出”
    // 场景就不会发生，assert.rejects 自然等不到 reject。
    if (path.basename(String(args.at(-1))) === 'end.jpg') return { stdout: '', stderr: '' };
    return runProcess(command, args);
  };

  await assert.rejects(
    preprocessReferenceVideo({
      workflowId: 'workflow-1',
      remixId: 'remix_shots',
      source,
    }, context),
    error => error.code === 'SHOT_FRAME_NOT_CREATED'
  );
  assert.equal(fs.existsSync(path.join(context.libraryDir, 'projects', '镜头测试项目', 'video-remix', 'remix_shots', 'preprocess', 'current.json')), false);
});

test('手动拖动、拆分或合并切点会生成新版本并保留可复用 Shot id', async (t) => {
  const { context, source } = makeContext(t);
  const first = await preprocessReferenceVideo({
    workflowId: 'workflow-1',
    remixId: 'remix_shots',
    source,
  }, context);
  const edited = await updateVideoRemixShotTimeline({
    workflowId: 'workflow-1',
    remixId: 'remix_shots',
    source: first.source,
    cutPoints: [0.5, 1, 2],
    previousShots: first.shots,
  }, context);

  assert.notEqual(edited.proxyUrl, first.proxyUrl);
  assert.deepEqual(edited.shots.map(shot => [shot.start, shot.end]), [
    [0, 0.5],
    [0.5, 1],
    [1, 2],
    [2, 3],
  ]);
  assert.equal(edited.shots[0].shotId, first.shots[0].shotId);
  assert.equal(edited.shots[0].detection.source, 'manual');
  assert.equal(edited.shots.every(shot => shot.analysisFrames.length === 5), true);
  const oldProxyPath = path.join(
    context.libraryDir,
    decodeURIComponent(first.proxyUrl.replace('/library/', ''))
  );
  assert.equal(fs.existsSync(oldProxyPath), true);
});

test('预处理拒绝借用当前 Remix 目录之外的项目素材', async (t) => {
  const { context, source } = makeContext(t);
  const unsafeSource = {
    ...source,
    localUrl: '/library/projects/%E9%95%9C%E5%A4%B4%E6%B5%8B%E8%AF%95%E9%A1%B9%E7%9B%AE/videos/other.mp4',
  };
  const otherPath = path.join(context.projectsDir, '镜头测试项目', 'videos', 'other.mp4');
  fs.mkdirSync(path.dirname(otherPath), { recursive: true });
  fs.writeFileSync(otherPath, 'other');

  await assert.rejects(
    preprocessReferenceVideo({
      workflowId: 'workflow-1',
      remixId: 'remix_shots',
      source: unsafeSource,
    }, context),
    error => error.code === 'UNSAFE_REFERENCE_VIDEO_PATH'
  );
});
