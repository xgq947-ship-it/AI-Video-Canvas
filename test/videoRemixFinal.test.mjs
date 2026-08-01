import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginVideoRemixRender,
  buildVideoRemixManifest,
  buildVideoRemixSubtitles,
  checkVideoRemixContinuity,
  completeVideoRemixRender,
  createVideoRemixShot,
  createVideoRemixState,
  moveVideoRemixTimelineShot,
  prepareVideoRemixTimeline,
  removeVideoRemixTimelineShot,
  replaceVideoRemixTimelineShot,
  restoreVideoRemixTimelineShot,
  setVideoRemixBgm,
  setVideoRemixRenderError,
  setVideoRemixSubtitles,
  updateVideoRemixRenderJob,
  updateVideoRemixTimelineShot,
  videoRemixOutputNodeId,
} from '../shared/videoRemix.js';

const editable = value => ({
  value,
  source: 'ai',
  confidence: 0.98,
  locked: false,
});

function finalFixture() {
  const first = {
    ...createVideoRemixShot({ shotId: 'shot_001', start: 0, end: 3 }),
    transition: 'fade',
    audioBlueprint: {
      dialogue: [{
        characterId: 'CHAR_01',
        text: editable('第一句'),
        start: 1,
        end: 2,
      }],
      environment: editable('室内环境声'),
      soundEvents: [],
    },
    startState: {
      characterStates: {
        CHAR_01: {
          holding: 'PROP_01',
          position: '门边',
          direction: '向右',
          emotion: '平静',
          lookId: 'LOOK_01',
        },
      },
      sceneId: 'SCENE_01',
      sceneZone: 'ZONE_DOOR',
      lighting: '暖光',
      time: '白天',
    },
    endState: {
      characterStates: {
        CHAR_01: {
          holding: 'PROP_01',
          position: '桌边',
          direction: '向右',
          emotion: '惊讶',
          lookId: 'LOOK_01',
        },
      },
      sceneId: 'SCENE_01',
      sceneZone: 'ZONE_TABLE',
      lighting: '暖光',
      time: '白天',
    },
  };
  const second = {
    ...createVideoRemixShot({ shotId: 'shot_002', start: 3, end: 5 }),
    transition: 'hard_cut',
    audioBlueprint: {
      dialogue: [{
        characterId: 'CHAR_01',
        text: editable('第二句'),
        start: 0.5,
        end: 1.5,
      }],
      environment: editable('室内环境声'),
      soundEvents: [],
    },
    startState: {
      characterStates: {
        CHAR_01: {
          holding: 'PROP_02',
          position: '桌边',
          direction: '向右',
          emotion: '惊讶',
          lookId: 'LOOK_01',
        },
      },
      sceneId: 'SCENE_01',
      sceneZone: 'ZONE_TABLE',
      lighting: '暖光',
      time: '白天',
    },
    endState: {
      characterStates: {
        CHAR_01: {
          holding: 'PROP_02',
          position: '窗边',
          direction: '向左',
          emotion: '平静',
          lookId: 'LOOK_01',
        },
      },
      sceneId: 'SCENE_01',
      sceneZone: 'ZONE_WINDOW',
      lighting: '暖光',
      time: '白天',
    },
  };
  return createVideoRemixState({
    remixId: 'remix-final-test',
    stage: 'videos_ready',
    source: {
      id: 'source',
      sourceType: 'local',
      localUrl: '/library/projects/Test/videos/source.mp4',
      duration: 5,
      width: 1920,
      height: 1080,
      fps: 25,
      hasAudio: true,
      orientation: 'landscape',
    },
    shots: [first, second],
    videoReview: { confirmed: true },
    generatedVideos: [
      {
        id: 'video_1',
        shotId: 'shot_001',
        status: 'confirmed',
        url: '/library/projects/Test/videos/shot-1.mp4',
        inputHash: 'hash-1',
        targetDuration: 3,
      },
      {
        id: 'video_2',
        shotId: 'shot_002',
        status: 'confirmed',
        url: '/library/projects/Test/videos/shot-2.mp4',
        inputHash: 'hash-2',
        targetDuration: 2,
      },
    ],
    timeline: [
      {
        shotId: 'shot_001',
        order: 0,
        start: 0,
        end: 3,
        transition: 'fade',
      },
      {
        shotId: 'shot_002',
        order: 1,
        start: 3,
        end: 5,
        transition: 'hard_cut',
      },
    ],
  });
}

test('成片 Timeline 使用确认视频、相对切点与原片顺序', () => {
  const prepared = prepareVideoRemixTimeline(finalFixture());
  assert.equal(prepared.timelineReview.prepared, true);
  assert.deepEqual(prepared.timeline.map(item => ({
    shotId: item.shotId,
    start: item.start,
    end: item.end,
    transition: item.transition,
    source: item.source,
  })), [
    {
      shotId: 'shot_001',
      start: 0,
      end: 3,
      transition: 'fade',
      source: 'generated',
    },
    {
      shotId: 'shot_002',
      start: 0,
      end: 2,
      transition: 'hard_cut',
      source: 'generated',
    },
  ]);
  assert.deepEqual(
    prepared.timeline.map(item => item.videoUrl),
    [
      '/library/projects/Test/videos/shot-1.mp4',
      '/library/projects/Test/videos/shot-2.mp4',
    ]
  );
});

test('旧版 schema-v1 项目会补齐 Phase 9 默认状态', () => {
  const legacy = structuredClone(finalFixture());
  delete legacy.timelineReview;
  delete legacy.continuityReport;
  delete legacy.bgm;
  delete legacy.subtitles;
  delete legacy.renderJob;
  delete legacy.output;

  const normalized = createVideoRemixState(legacy);
  assert.deepEqual(normalized.timelineReview, { prepared: false });
  assert.equal(normalized.bgm.mode, 'none');
  assert.equal(normalized.subtitles.enabled, false);
  assert.deepEqual(normalized.subtitles.items, []);
  assert.equal(normalized.renderJob, null);
  assert.equal(normalized.output, null);
  assert.equal(prepareVideoRemixTimeline(normalized).timelineReview.prepared, true);
});

test('连续性检查比较场景、光线与人物状态，并指出不连续道具', () => {
  const report = checkVideoRemixContinuity(
    prepareVideoRemixTimeline(finalFixture())
  );
  assert.equal(report.checkedCuts, 1);
  assert.ok(report.score > 0.8 && report.score < 1);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /手持道具/);
  assert.match(report.warnings[0], /PROP_01/);
  assert.match(report.warnings[0], /PROP_02/);
});

test('Dialogue Blueprint 字幕随 Shot 排序与切点重算绝对时间', () => {
  let state = setVideoRemixSubtitles(
    prepareVideoRemixTimeline(finalFixture()),
    { enabled: true, style: 'short-video' }
  );
  assert.deepEqual(buildVideoRemixSubtitles(state).map(item => [
    item.text,
    item.start,
    item.end,
  ]), [
    ['第一句', 1, 2],
    ['第二句', 3.5, 4.5],
  ]);

  state = moveVideoRemixTimelineShot(state, 'shot_002', -1);
  state = updateVideoRemixTimelineShot(state, 'shot_002', {
    start: 0.5,
    end: 1.5,
  });
  assert.deepEqual(state.subtitles.items.map(item => [
    item.text,
    item.start,
    item.end,
  ]), [
    ['第二句', 0, 1],
    ['第一句', 2, 3],
  ]);
});

test('轻量 Timeline 支持替换、恢复、删除与最少一个 Shot 保护', () => {
  let state = prepareVideoRemixTimeline(finalFixture());
  state = replaceVideoRemixTimelineShot(state, 'shot_001', {
    videoUrl: '/library/projects/Test/videos/replacement.mp4',
    sourceDuration: 6,
  });
  assert.equal(state.timeline[0].source, 'replacement');
  assert.equal(state.timeline[0].end, 3);

  state = restoreVideoRemixTimelineShot(state, 'shot_001');
  assert.equal(state.timeline[0].source, 'generated');
  assert.match(state.timeline[0].videoUrl, /shot-1/);

  state = removeVideoRemixTimelineShot(state, 'shot_002');
  assert.deepEqual(state.timeline.map(item => item.shotId), ['shot_001']);
  const protectedState = removeVideoRemixTimelineShot(state, 'shot_001');
  assert.equal(protectedState.timeline.length, 1);
});

test('Video Remix Manifest 复用 Remotion，并实现无/原视频/上传 BGM', () => {
  let state = setVideoRemixSubtitles(
    prepareVideoRemixTimeline(finalFixture()),
    { enabled: true, style: 'short-video' }
  );
  const none = buildVideoRemixManifest(state, {
    projectId: 'workflow-1',
    title: '测试成片',
  });
  assert.equal(none.composition.width, 1920);
  assert.equal(none.composition.height, 1080);
  assert.equal(none.composition.fps, 25);
  assert.equal(none.shots[0].transition, 'fade');
  assert.equal(none.shots[0].volume, 1);
  assert.equal(none.audioTracks.length, 0);
  assert.equal(none.subtitles.length, 2);
  assert.equal(none.output.subtitleStyle, 'short-video');
  assert.equal(none.durationSec, 5);
  assert.match(none.output.fileName, /^video-remix-remix-final-test-/);

  state = setVideoRemixBgm(state, { mode: 'original' });
  const original = buildVideoRemixManifest(state);
  assert.equal(original.shots[0].volume, 0);
  assert.equal(original.audioTracks[0].file, state.source.localUrl);
  assert.equal(original.audioTracks[0].volume, 1);
  assert.equal(original.audioTracks[0].loop, false);

  state = setVideoRemixBgm(state, {
    mode: 'upload',
    url: '/library/projects/Test/audio/music.mp3',
    name: 'music.mp3',
    volume: 0.2,
  });
  const uploaded = buildVideoRemixManifest(state);
  assert.equal(uploaded.shots[0].volume, 1);
  assert.equal(uploaded.audioTracks[0].type, 'bgm');
  assert.equal(uploaded.audioTracks[0].volume, 0.2);
  assert.equal(uploaded.audioTracks[0].loop, true);
});

test('Remotion 任务只接受当前 job/inputHash，失败可安全重试', () => {
  const prepared = prepareVideoRemixTimeline(finalFixture());
  const manifest = buildVideoRemixManifest(prepared);
  let state = beginVideoRemixRender(prepared, {
    jobId: 'job-1',
    inputHash: manifest.inputHash,
  });
  assert.equal(state.stage, 'rendering');
  state = updateVideoRemixRenderJob(state, {
    jobId: 'job-1',
    status: 'rendering',
    stage: 'rendering',
    progress: 0.5,
  });
  assert.equal(state.renderJob.progress, 0.5);

  const ignored = completeVideoRemixRender(state, {
    jobId: 'old-job',
    inputHash: manifest.inputHash,
    url: '/library/projects/Test/videos/old.mp4',
    duration: 5,
  });
  assert.equal(ignored.output, null);

  state = completeVideoRemixRender(state, {
    jobId: 'job-1',
    inputHash: manifest.inputHash,
    url: '/library/projects/Test/videos/final.mp4',
    duration: 5,
    nodeId: videoRemixOutputNodeId('remix-node'),
  });
  assert.equal(state.stage, 'completed');
  assert.match(state.output.url, /^\/library\/projects\/Test\/videos\/final\.mp4\?t=\d+$/);
  assert.equal(state.output.nodeId, 'video-remix-final-remix-node');

  state = beginVideoRemixRender(prepared, {
    jobId: 'job-2',
    inputHash: manifest.inputHash,
  });
  state = setVideoRemixRenderError(state, '后端重启，任务已中断', {
    jobId: 'job-2',
    code: 'RENDER_JOB_LOST',
  });
  assert.equal(state.stage, 'videos_ready');
  assert.equal(state.renderJob.status, 'failed');
  assert.equal(state.errors.at(-1).retryable, true);
});
