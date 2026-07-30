import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getVideoProviderCapabilities,
} from '../shared/generationProviders.js';
import {
  applyVideoRemixRawVideoResult,
  applyVideoRemixVideoResult,
  beginVideoRemixVideoCalibration,
  beginVideoRemixVideoGeneration,
  confirmVideoRemixVideos,
  createVideoRemixShot,
  createVideoRemixState,
  getVideoRemixShotVideoInputs,
  getVideoRemixVideoReadiness,
  planVideoRemixShotDuration,
  prepareVideoRemixVideos,
  recoverStaleVideoRemixVideos,
  setVideoRemixVideoError,
  updateVideoRemixKeyframePrompt,
  updateVideoRemixVideoPrompt,
} from '../shared/videoRemix.js';

const editable = value => ({
  value,
  source: 'ai',
  confidence: 0.98,
  locked: false,
});

function videoFixture({
  model = 'google-flow-omni-flash',
  shotCount = 1,
  duration = 3.2,
} = {}) {
  const shots = Array.from({ length: shotCount }, (_, index) => {
    const shotId = `shot_${String(index + 1).padStart(3, '0')}`;
    return {
      ...createVideoRemixShot({
        shotId,
        start: index * duration,
        end: (index + 1) * duration,
      }),
      analysisStatus: 'ready',
      motionComplexity: 'medium',
      storyBeat: editable('人物走到桌边并拿起杯子'),
      characters: [{ characterId: 'CHAR_01', lookId: 'LOOK_01' }],
      scene: { sceneId: 'SCENE_01', sceneZone: 'ZONE_TABLE' },
      props: [{ propId: 'PROP_01', role: '交互' }],
      frameBlueprint: {
        shotSize: editable('中景'),
        cameraAngle: editable('平视'),
        subjects: [{
          id: 'CHAR_01',
          x: 0.3,
          y: 0.55,
          scale: 0.62,
          facing: '向右',
        }],
        props: [{ id: 'PROP_01', x: 0.65, y: 0.62, scale: 0.12 }],
      },
      motionBlueprint: {
        subjects: [{
          characterId: 'CHAR_01',
          actionSequence: [{
            start: 0,
            end: duration,
            action: '从左向右走到桌边',
            category: 'body',
          }],
          movementDirection: '从左向右',
        }],
        propInteractions: [],
      },
      cameraBlueprint: {
        shotSize: editable('中景'),
        angle: editable('平视'),
        movement: [{ type: 'dolly_in', start: 0, end: duration }],
      },
      timingBlueprint: {
        phases: [{ phase: '走近', start: 0, end: duration }],
      },
      audioBlueprint: {
        dialogue: [{
          characterId: 'CHAR_01',
          text: editable('你好'),
          emotion: '自然',
          start: 1,
          end: 2,
        }],
        environment: editable('咖啡厅环境声'),
        soundEvents: [],
      },
    };
  });
  const keyframes = shots.flatMap(shot => [
    {
      id: `${shot.shotId}_start`,
      shotId: shot.shotId,
      position: 'start',
      status: 'confirmed',
      url: `/library/${shot.shotId}-start.png`,
    },
    {
      id: `${shot.shotId}_end`,
      shotId: shot.shotId,
      position: 'end',
      status: 'confirmed',
      url: `/library/${shot.shotId}-end.png`,
    },
  ]);
  return createVideoRemixState({
    remixId: 'remix_video_test',
    stage: 'keyframes_ready',
    source: {
      id: 'source',
      duration: duration * shotCount,
      orientation: 'landscape',
    },
    shots,
    story: {
      summary: '人物走到桌边',
      structure: ['走近'],
      style: '写实',
    },
    assets: {
      characters: [{
        id: 'CHAR_01',
        name: '女主',
        identity: '黑色长发',
        looks: [{
          id: 'LOOK_01',
          name: '日常装',
          description: '白色衬衫',
          referenceImages: ['/library/look.png'],
          source: 'analysis',
        }],
        referenceImages: ['/library/character.png'],
        appearsInShots: shots.map(shot => shot.shotId),
        source: 'analysis',
      }],
      scenes: [{
        id: 'SCENE_01',
        name: '咖啡厅',
        visualDescription: '暖色木桌',
        zones: [{
          id: 'ZONE_TABLE',
          name: '桌边',
          description: '靠窗木桌',
        }],
        referenceImages: ['/library/scene.png'],
        appearsInShots: shots.map(shot => shot.shotId),
        source: 'analysis',
      }],
      props: [{
        id: 'PROP_01',
        name: '杯子',
        category: 'interactive',
        description: '白色陶瓷杯',
        referenceImages: ['/library/prop.png'],
        appearsInShots: shots.map(shot => shot.shotId),
        source: 'analysis',
      }],
    },
    assetReview: { confirmed: true },
    promptReview: {
      confirmed: true,
      targetModel: model,
    },
    keyframeReview: {
      confirmed: true,
      imageModel: 'google-flow-nano-banana-pro',
      aspectRatio: '16:9',
      resolution: '2K',
    },
    prompts: Object.fromEntries(shots.map(shot => [
      shot.shotId,
      {
        targetModel: model,
        rawPrompt: `RAW ${shot.shotId}`,
        resolvedPrompt: `RESOLVED ${shot.shotId}`,
        optimizedPrompt: `OPTIMIZED ${shot.shotId}，保持动作、运镜、对白和环境声。`,
        promptHash: `prompt-${model}-${shot.shotId}`,
      },
    ])),
    keyframes,
  });
}

test('Video Provider capability 对应真实首尾帧与参考素材协议', () => {
  assert.deepEqual(
    getVideoProviderCapabilities('seedance-2-0'),
    {
      imageToVideo: true,
      startFrame: true,
      endFrame: true,
      multiReference: false,
      characterReference: false,
      audioGeneration: true,
      maxDuration: 15,
      maxReferenceImages: 2,
      referenceMode: 'start-end',
    }
  );
  const jimeng = getVideoProviderCapabilities('jimeng-seedance-2-0');
  assert.equal(jimeng.referenceMode, 'reference-materials');
  assert.equal(jimeng.multiReference, true);
  assert.equal(jimeng.audioGeneration, false);

  const flow = getVideoProviderCapabilities('google-flow-omni-flash');
  assert.equal(flow.startFrame, true);
  assert.equal(flow.endFrame, false);
  assert.equal(flow.multiReference, true);
  assert.equal(flow.audioGeneration, true);
});

test('Shot 时长选择优先覆盖后裁剪，只允许 0.85x 以上轻微补时长', () => {
  assert.deepEqual(
    planVideoRemixShotDuration('google-flow-omni-flash', 3.2),
    {
      supported: true,
      requestDuration: 4,
      sourceDuration: 4,
      targetDuration: 3.2,
      trimStart: 0,
      trimEnd: 3.2,
      speed: 1,
      calibration: 'trim',
    }
  );
  const adjusted = planVideoRemixShotDuration(
    'google-flow-omni-flash',
    11.5
  );
  assert.equal(adjusted.supported, true);
  assert.equal(adjusted.requestDuration, 10);
  assert.equal(adjusted.speed, 0.87);
  assert.equal(adjusted.calibration, 'speed');

  const rejected = planVideoRemixShotDuration(
    'google-flow-omni-flash',
    12
  );
  assert.equal(rejected.supported, false);
  assert.match(rejected.reason, /0.85x/);
});

test('模型能力自动选择 Start/End 或 Start + 当前资产多参考', () => {
  const state = videoFixture();
  const flow = getVideoRemixShotVideoInputs(
    state,
    'shot_001',
    'google-flow-omni-flash'
  );
  assert.deepEqual(flow.referenceImages, [
    '/library/shot_001-start.png',
    '/library/character.png',
    '/library/look.png',
    '/library/scene.png',
    '/library/prop.png',
  ]);
  assert.deepEqual(flow.referenceImageLabels, [
    'START_FRAME',
    'CHAR_01',
    'LOOK_01',
    'SCENE_01',
    'PROP_01',
  ]);
  assert.equal(flow.imageBase64, undefined);
  assert.equal(flow.lastFrameBase64, undefined);

  const seedance = getVideoRemixShotVideoInputs(
    state,
    'shot_001',
    'seedance-2-0'
  );
  assert.equal(seedance.imageBase64, '/library/shot_001-start.png');
  assert.equal(seedance.lastFrameBase64, '/library/shot_001-end.png');
  assert.deepEqual(seedance.referenceImages, []);
});

test('视频计划缓存相同输入，分辨率与声音变化只失效视频层', () => {
  const options = {
    videoModel: 'google-flow-omni-flash',
    aspectRatio: '16:9',
    resolution: '自动',
    generateAudio: true,
  };
  let state = prepareVideoRemixVideos(videoFixture(), options);
  const [video] = state.generatedVideos;
  assert.equal(video.status, 'pending');
  assert.equal(video.requestDuration, 4);
  assert.equal(video.targetDuration, 3.2);
  assert.match(video.prompt, /动作、运镜、对白和环境声/);

  state = beginVideoRemixVideoGeneration(state, video.id, {
    generationNodeId: 'node_video_1',
  });
  state = applyVideoRemixRawVideoResult(state, video.id, {
    rawUrl: '/library/raw.mp4',
    inputHash: video.inputHash,
  });
  state = applyVideoRemixVideoResult(state, video.id, {
    url: '/library/calibrated.mp4',
    rawUrl: '/library/raw.mp4',
    inputHash: video.inputHash,
    sourceDuration: 4,
    targetDuration: 3.2,
    trimStart: 0,
    trimEnd: 3.2,
    speed: 1,
  });
  state = confirmVideoRemixVideos(state);
  assert.equal(state.videoReview.confirmed, true);
  assert.equal(prepareVideoRemixVideos(state, options), state);

  const changed = prepareVideoRemixVideos(state, {
    ...options,
    generateAudio: false,
  });
  assert.equal(changed.generatedVideos[0].status, 'pending');
  assert.equal(changed.generatedVideos[0].url, undefined);
  assert.equal(changed.keyframes.length, 2);
  assert.equal(changed.keyframeReview.confirmed, true);
});

test('旧任务结果受 inputHash 保护，手动 Prompt 会清空原始与校准视频', () => {
  let state = prepareVideoRemixVideos(videoFixture(), {
    videoModel: 'google-flow-omni-flash',
    aspectRatio: '16:9',
    resolution: '自动',
    generateAudio: true,
  });
  const [video] = state.generatedVideos;
  state = beginVideoRemixVideoGeneration(state, video.id, {
    generationNodeId: 'node_video_1',
  });
  assert.equal(applyVideoRemixRawVideoResult(state, video.id, {
    rawUrl: '/library/stale.mp4',
    inputHash: 'stale-input',
  }), state);

  state = applyVideoRemixRawVideoResult(state, video.id, {
    rawUrl: '/library/raw.mp4',
    inputHash: video.inputHash,
  });
  state = applyVideoRemixVideoResult(state, video.id, {
    url: '/library/final.mp4',
    inputHash: video.inputHash,
  });
  state = updateVideoRemixVideoPrompt(
    state,
    video.id,
    `${state.generatedVideos[0].prompt}\n不要新增旁白。`
  );
  assert.equal(state.generatedVideos[0].status, 'pending');
  assert.equal(state.generatedVideos[0].rawUrl, undefined);
  assert.equal(state.generatedVideos[0].url, undefined);
  assert.equal(state.generatedVideos[0].promptSource, 'user');
  assert.equal(state.videoReview.confirmed, false);
});

test('单 Shot 失败隔离；校准失败保留原视频，提交未知阻止自动重投', () => {
  let state = prepareVideoRemixVideos(videoFixture({ shotCount: 2 }), {
    videoModel: 'google-flow-omni-flash',
    aspectRatio: '16:9',
    resolution: '自动',
    generateAudio: true,
  });
  const [first, second] = state.generatedVideos;
  state = beginVideoRemixVideoGeneration(state, first.id, {
    generationNodeId: 'node_first',
  });
  state = beginVideoRemixVideoGeneration(state, second.id, {
    generationNodeId: 'node_second',
  });
  state = applyVideoRemixRawVideoResult(state, first.id, {
    rawUrl: '/library/first-raw.mp4',
    inputHash: first.inputHash,
  });
  state = setVideoRemixVideoError(
    state,
    first.id,
    '本地 FFmpeg 中断',
    {
      code: 'CALIBRATION_FAILED',
      inputHash: first.inputHash,
      errorStage: 'calibration',
    }
  );
  state = setVideoRemixVideoError(
    state,
    second.id,
    '平台已接收，连接中断',
    {
      code: 'SUBMISSION_UNKNOWN',
      submitted: true,
      inputHash: second.inputHash,
      errorStage: 'generation',
    }
  );
  assert.equal(state.generatedVideos[0].rawUrl, '/library/first-raw.mp4');
  assert.equal(state.generatedVideos[0].retryBlocked, false);
  assert.equal(state.generatedVideos[1].retryBlocked, true);
  assert.equal(state.errors.at(-1).retryable, false);
  assert.equal(getVideoRemixVideoReadiness(state).failed, 2);
});

test('中断恢复区分可安全重做的本地校准与需人工核对的平台提交', () => {
  let state = prepareVideoRemixVideos(videoFixture({ shotCount: 2 }), {
    videoModel: 'google-flow-omni-flash',
    aspectRatio: '16:9',
    resolution: '自动',
    generateAudio: true,
  });
  const [first, second] = state.generatedVideos;
  state = beginVideoRemixVideoGeneration(state, first.id, {
    generationNodeId: 'node_first',
  });
  state = beginVideoRemixVideoGeneration(state, second.id, {
    generationNodeId: 'node_second',
  });
  state = applyVideoRemixRawVideoResult(state, second.id, {
    rawUrl: '/library/second-raw.mp4',
    inputHash: second.inputHash,
  });
  state = beginVideoRemixVideoCalibration(state, second.id);
  const staleAt = Date.now() - 31 * 60_000;
  state.generatedVideos = state.generatedVideos.map(video => ({
    ...video,
    generationStartedAt: video.status === 'generating'
      ? new Date(staleAt).toISOString()
      : video.generationStartedAt,
    calibrationStartedAt: video.status === 'calibrating'
      ? new Date(staleAt).toISOString()
      : video.calibrationStartedAt,
  }));
  const recovered = recoverStaleVideoRemixVideos(state, Date.now());
  assert.equal(recovered.generatedVideos[0].errorStage, 'generation');
  assert.equal(recovered.generatedVideos[0].retryBlocked, true);
  assert.equal(recovered.generatedVideos[1].errorStage, 'calibration');
  assert.equal(recovered.generatedVideos[1].retryBlocked, false);
  assert.equal(recovered.generatedVideos[1].rawUrl, '/library/second-raw.mp4');
});

test('关键帧重新编辑会清空已生成视频与视频确认门', () => {
  let state = prepareVideoRemixVideos(videoFixture(), {
    videoModel: 'google-flow-omni-flash',
    aspectRatio: '16:9',
    resolution: '自动',
    generateAudio: true,
  });
  const [video] = state.generatedVideos;
  state = beginVideoRemixVideoGeneration(state, video.id, {
    generationNodeId: 'node_video_1',
  });
  state = applyVideoRemixRawVideoResult(state, video.id, {
    rawUrl: '/library/raw.mp4',
    inputHash: video.inputHash,
  });
  state = applyVideoRemixVideoResult(state, video.id, {
    url: '/library/final.mp4',
    inputHash: video.inputHash,
  });
  state = confirmVideoRemixVideos(state);
  assert.equal(state.videoReview.confirmed, true);

  state = updateVideoRemixKeyframePrompt(
    state,
    state.keyframes[0].id,
    '更新后的 Start Frame Prompt'
  );
  assert.deepEqual(state.generatedVideos, []);
  assert.equal(state.videoReview.confirmed, false);
});
