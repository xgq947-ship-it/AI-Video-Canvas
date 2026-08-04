import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyVideoRemixGlobalAnalysis,
  applyVideoRemixKeyframeResult,
  applyVideoRemixPromptOptimization,
  applyVideoRemixRawVideoResult,
  applyVideoRemixShotAnalysis,
  applyVideoRemixVideoResult,
  beginVideoRemixAnalysis,
  beginVideoRemixKeyframeGeneration,
  beginVideoRemixPreprocessing,
  beginVideoRemixRender,
  beginVideoRemixVideoGeneration,
  buildAllVideoRemixPrompts,
  buildVideoRemixManifest,
  buildVideoRemixShots,
  completeVideoRemixPreprocessing,
  completeVideoRemixRender,
  confirmVideoRemixAssets,
  confirmVideoRemixKeyframes,
  confirmVideoRemixPrompts,
  confirmVideoRemixVideos,
  createVideoRemixState,
  prepareVideoRemixKeyframes,
  prepareVideoRemixTimeline,
  prepareVideoRemixVideos,
  replaceVideoRemixAsset,
  replaceVideoRemixSource,
  resolveVideoRemixAsset,
  setVideoRemixBgm,
  setVideoRemixSubtitles,
  videoRemixOutputNodeId,
} from '../shared/videoRemix.js';

const editable = value => ({
  value,
  source: 'ai',
  confidence: 0.95,
  locked: false,
});

const positions = ['start', 'quarter', 'middle', 'three_quarter', 'end'];
const positionRatio = {
  start: 0,
  quarter: 0.25,
  middle: 0.5,
  three_quarter: 0.75,
  end: 1,
};

function analyzedShot(base, index) {
  const characterIds = index === 0
    ? ['CHAR_01']
    : index === 1 ? ['CHAR_01', 'CHAR_02'] : ['CHAR_02'];
  const sceneId = index < 2 ? 'SCENE_01' : 'SCENE_02';
  const sceneZone = index < 2 ? 'ZONE_TABLE' : 'ZONE_DOOR';
  const propIds = index < 2 ? ['PROP_01'] : [];
  const dialogue = index === 1 ? [{
    characterId: 'CHAR_01',
    text: editable('你终于来了。'),
    emotion: '释然',
    start: 3.2,
    end: 5.3,
  }] : [];
  const characters = characterIds.map((characterId, characterIndex) => ({
    characterId,
    lookId: characterId === 'CHAR_01' ? 'LOOK_01' : 'LOOK_02',
    x: 0.32 + characterIndex * 0.36,
  }));
  const holding = index === 0 ? undefined : 'PROP_01';

  return {
    ...base,
    analysisStatus: 'ready',
    storyBeat: editable([
      '女主走到桌边并拿起杯子。',
      '女主拿着杯子与男主对话。',
      '男主转身离开房间。',
    ][index]),
    characters: characters.map(({ characterId, lookId }) => ({ characterId, lookId })),
    scene: { sceneId, sceneZone },
    props: propIds.map(propId => ({ propId, role: 'interactive' })),
    frameBlueprint: {
      shotSize: editable(index === 1 ? '双人中景' : '中景'),
      cameraAngle: editable('平视'),
      subjects: characters.map(({ characterId, x }) => ({
        id: characterId,
        x,
        y: 0.55,
        scale: 0.62,
        facing: index === 2 ? 'right' : 'front',
      })),
      props: propIds.map(propId => ({
        id: propId,
        x: 0.58,
        y: 0.65,
        scale: 0.12,
      })),
    },
    motionBlueprint: {
      subjects: characterIds.map(characterId => ({
        characterId,
        actionSequence: [{
          start: 0,
          end: 6,
          action: [
            '从画面左侧走到桌边并用右手拿起杯子',
            '保持杯子在右手并看向对方说话',
            '从门边转身后向画面右侧离开',
          ][index],
          category: index === 1 ? 'facial' : 'body',
        }],
        movementDirection: index === 2 ? 'left_to_right' : 'toward_center',
      })),
      propInteractions: index === 0 ? [{
        actor: 'CHAR_01',
        prop: 'PROP_01',
        action: 'pick_up',
        hand: 'right',
        start: 2,
        end: 4,
      }] : [],
    },
    cameraBlueprint: {
      shotSize: editable(index === 1 ? '双人中景' : '中景'),
      angle: editable('平视'),
      movement: [{
        type: index === 2 ? 'pan_right' : 'dolly_in',
        start: 0,
        end: 6,
      }],
      lensFeel: editable('自然透视'),
    },
    timingBlueprint: {
      phases: [
        { phase: 'setup', start: 0, end: 2 },
        { phase: 'action', start: 2, end: 4 },
        { phase: 'resolve', start: 4, end: 6 },
      ],
    },
    audioBlueprint: {
      dialogue,
      environment: editable(sceneId === 'SCENE_01' ? '室内轻微交谈声' : '门厅脚步声'),
      soundEvents: [{
        start: 0,
        end: 2,
        description: index === 0 ? '自然脚步声' : '轻微衣物摩擦声',
      }],
    },
    startState: {
      characterStates: Object.fromEntries(characterIds.map(characterId => [
        characterId,
        {
          holding,
          position: index === 2 ? '门边' : '桌边',
          direction: index === 2 ? '向右' : '面向中央',
          emotion: index === 1 ? '释然' : '平静',
          lookId: characterId === 'CHAR_01' ? 'LOOK_01' : 'LOOK_02',
        },
      ])),
      sceneId,
      sceneZone,
      lighting: '暖色自然光',
      time: '白天',
    },
    endState: {
      characterStates: Object.fromEntries(characterIds.map(characterId => [
        characterId,
        {
          holding: index === 0 && characterId === 'CHAR_01' ? 'PROP_01' : holding,
          position: index === 2 ? '画面右侧' : '桌边',
          direction: index === 2 ? '向右' : '面向中央',
          emotion: index === 1 ? '释然' : '平静',
          lookId: characterId === 'CHAR_01' ? 'LOOK_01' : 'LOOK_02',
        },
      ])),
      sceneId,
      sceneZone,
      lighting: '暖色自然光',
      time: '白天',
    },
    transition: index === 1 ? 'fade' : 'hard_cut',
  };
}

function globalAnalysis(shotIds) {
  return {
    story: {
      summary: '女主拿起杯子，与来访者短暂交谈后目送对方离开。',
      genre: '生活剧情',
      structure: ['拿起杯子', '人物交谈', '转身离开'],
    },
    characters: [
      {
        id: 'CHAR_01',
        name: '女主',
        identity: '黑色长发的年轻女性',
        looks: [{
          id: 'LOOK_01',
          name: '日常装',
          description: '白色衬衫与深色长裤',
          referenceImages: ['/library/acceptance/look-1.png'],
          source: 'analysis',
        }],
        voiceDescription: {
          language: 'zh-CN',
          gender: 'female',
          ageFeel: '25岁左右',
          tone: '自然清晰',
          pitch: '中等',
          speakingStyle: '生活化',
        },
        referenceImages: ['/library/acceptance/char-1.png'],
        appearsInShots: shotIds.slice(0, 2),
        source: 'analysis',
      },
      {
        id: 'CHAR_02',
        name: '来访者',
        identity: '短发的年轻男性',
        looks: [{
          id: 'LOOK_02',
          name: '通勤装',
          description: '深色夹克',
          referenceImages: ['/library/acceptance/look-2.png'],
          source: 'analysis',
        }],
        referenceImages: ['/library/acceptance/char-2.png'],
        appearsInShots: shotIds.slice(1),
        source: 'analysis',
      },
    ],
    scenes: [
      {
        id: 'SCENE_01',
        name: '咖啡厅',
        visualDescription: '木桌与暖色吊灯',
        audioDescription: '轻微顾客交谈声',
        zones: [{ id: 'ZONE_TABLE', name: '桌边', description: '靠窗木桌' }],
        referenceImages: ['/library/acceptance/scene-1.png'],
        appearsInShots: shotIds.slice(0, 2),
        source: 'analysis',
      },
      {
        id: 'SCENE_02',
        name: '门厅',
        visualDescription: '明亮入口与玻璃门',
        audioDescription: '轻微脚步与门声',
        zones: [{ id: 'ZONE_DOOR', name: '入口', description: '玻璃门附近' }],
        referenceImages: ['/library/acceptance/scene-2.png'],
        appearsInShots: [shotIds[2]],
        source: 'analysis',
      },
    ],
    props: [{
      id: 'PROP_01',
      name: '咖啡杯',
      category: 'interactive',
      description: '白色陶瓷杯',
      referenceImages: ['/library/acceptance/prop-1.png'],
      appearsInShots: shotIds.slice(0, 2),
      source: 'analysis',
    }],
    style: '写实商业短片',
    analysisKey: 'acceptance-analysis-v1',
    mode: 'deep',
    shotComplexities: shotIds.map((shotId, index) => ({
      shotId,
      motionComplexity: ['simple', 'medium', 'complex'][index],
      confidence: 0.94,
    })),
  };
}

test('18 秒 / 3 Shot MVP 从本地化状态贯通到唯一 Final Video Node', () => {
  const source = {
    id: 'reference-acceptance',
    sourceType: 'local',
    localUrl: '/library/projects/Acceptance/videos/original.mp4',
    previewUrl: '/library/projects/Acceptance/videos/original.mp4',
    proxyUrl: '/library/projects/Acceptance/video-remix/remix-acceptance/proxy.mp4',
    sourceHash: 'source-hash-acceptance',
    originalFilename: 'acceptance.mp4',
    duration: 18,
    width: 1080,
    height: 1920,
    fps: 30,
    codec: 'h264',
    audioCodec: 'aac',
    hasAudio: true,
    orientation: 'portrait',
  };
  const shots = buildVideoRemixShots({
    duration: 18,
    cutPoints: [6, 12],
    detectionSource: 'ffmpeg',
  }).map(shot => ({
    ...shot,
    analysisFrames: positions.map(position => ({
      position,
      time: shot.start + shot.duration * positionRatio[position],
      url: `/library/projects/Acceptance/frames/${shot.shotId}-${position}.jpg`,
    })),
  }));

  let state = createVideoRemixState({ remixId: 'remix-acceptance' });
  state = replaceVideoRemixSource(state, source);
  state = beginVideoRemixPreprocessing(state);
  state = completeVideoRemixPreprocessing(state, {
    source,
    proxyUrl: source.proxyUrl,
    shots,
  });
  assert.equal(state.stage, 'shots_ready');
  assert.equal(state.shots.length, 3);

  state = beginVideoRemixAnalysis(state, 'deep');
  state = applyVideoRemixGlobalAnalysis(
    state,
    globalAnalysis(state.shots.map(shot => shot.shotId))
  );
  state.shots.forEach((shot, index) => {
    state = applyVideoRemixShotAnalysis(state, analyzedShot(shot, index));
  });
  assert.equal(state.stage, 'analysis_ready');
  assert.equal(state.assets.characters.length, 2);
  assert.equal(state.assets.scenes.length, 2);
  assert.equal(state.assets.props.length, 1);

  state = replaceVideoRemixAsset(state, 'characters', 'CHAR_01', {
    source: 'upload',
    name: '新女主',
    identity: '短发、清晰下颌线的年轻女性',
    referenceImages: ['/library/projects/Acceptance/images/new-character.png'],
  });
  state = replaceVideoRemixAsset(state, 'scenes', 'SCENE_01', {
    source: 'upload',
    name: '酒店休息区',
    visualDescription: '现代酒店休息区与暖色灯光',
    referenceImages: ['/library/projects/Acceptance/images/new-scene.png'],
  });
  state = replaceVideoRemixAsset(state, 'props', 'PROP_01', {
    source: 'upload',
    name: '便携按摩器',
    description: '白色手持按摩器',
    referenceImages: ['/library/projects/Acceptance/images/new-prop.png'],
  });
  state = confirmVideoRemixAssets(state);
  assert.equal(state.stage, 'assets_ready');
  assert.equal(resolveVideoRemixAsset(state.assets.characters[0]).name, '新女主');

  state = buildAllVideoRemixPrompts(state, 'google-flow-omni-flash');
  for (const shot of state.shots) {
    const prompt = state.prompts[shot.shotId];
    state = applyVideoRemixPromptOptimization(state, shot.shotId, {
      optimizedTemplate: `【视频优化】\n${prompt.rawPrompt}`,
      videoProfileId: 'video-flow',
      imagePromptTemplate: `【关键帧优化】\n${prompt.rawImagePrompt}`,
      imageProfileId: 'image-remix-keyframe',
    });
  }
  state = confirmVideoRemixPrompts(state);
  assert.equal(state.promptReview.confirmed, true);
  assert.match(state.prompts.shot_001.resolvedPrompt, /新女主/);
  assert.match(state.prompts.shot_001.resolvedPrompt, /酒店休息区/);
  assert.match(state.prompts.shot_001.resolvedPrompt, /便携按摩器/);
  assert.match(state.prompts.shot_002.optimizedPrompt, /你终于来了/);

  state = prepareVideoRemixKeyframes(state, {
    imageModel: 'google-flow-nano-banana-pro',
    aspectRatio: '9:16',
    resolution: '2K',
  });
  assert.deepEqual(
    state.keyframes.reduce((counts, frame) => ({
      ...counts,
      [frame.shotId]: (counts[frame.shotId] || 0) + 1,
    }), {}),
    { shot_001: 1, shot_002: 2, shot_003: 3 }
  );
  for (const keyframe of state.keyframes) {
    state = beginVideoRemixKeyframeGeneration(state, keyframe.id);
    state = applyVideoRemixKeyframeResult(state, keyframe.id, {
      url: `/library/projects/Acceptance/images/${keyframe.id}.png`,
      inputHash: keyframe.inputHash,
    });
  }
  state = confirmVideoRemixKeyframes(state);
  assert.equal(state.keyframeReview.confirmed, true);

  state = prepareVideoRemixVideos(state, {
    videoModel: 'google-flow-omni-flash',
    aspectRatio: '9:16',
    resolution: '自动',
    generateAudio: true,
  });
  assert.equal(state.generatedVideos.length, 3);
  for (const video of state.generatedVideos) {
    state = beginVideoRemixVideoGeneration(state, video.id, {
      generationNodeId: `generation-${video.shotId}`,
    });
    state = applyVideoRemixRawVideoResult(state, video.id, {
      rawUrl: `/library/projects/Acceptance/videos/${video.shotId}-raw.mp4`,
      inputHash: video.inputHash,
    });
    state = applyVideoRemixVideoResult(state, video.id, {
      url: `/library/projects/Acceptance/videos/${video.shotId}.mp4`,
      rawUrl: `/library/projects/Acceptance/videos/${video.shotId}-raw.mp4`,
      inputHash: video.inputHash,
      sourceDuration: video.requestDuration,
      targetDuration: video.targetDuration,
      trimStart: 0,
      trimEnd: video.targetDuration,
      speed: 1,
    });
  }
  state = confirmVideoRemixVideos(state);
  assert.equal(state.videoReview.confirmed, true);

  state = prepareVideoRemixTimeline(state);
  state = setVideoRemixSubtitles(state, {
    enabled: true,
    style: 'short-video',
  });
  state = setVideoRemixBgm(state, {
    mode: 'upload',
    url: '/library/projects/Acceptance/audio/bgm.mp3',
    name: 'bgm.mp3',
    volume: 0.15,
  });
  const manifest = buildVideoRemixManifest(state, {
    projectId: 'workflow-acceptance',
    title: 'Video Remix MVP Acceptance',
  });
  assert.equal(manifest.shots.length, 3);
  assert.deepEqual(manifest.shots.map(shot => shot.id), [
    'shot_001',
    'shot_002',
    'shot_003',
  ]);
  assert.equal(manifest.durationSec, 18);
  assert.equal(manifest.subtitles.length, 1);
  assert.equal(manifest.audioTracks[0].file, '/library/projects/Acceptance/audio/bgm.mp3');

  state = beginVideoRemixRender(state, {
    jobId: 'render-acceptance',
    inputHash: manifest.inputHash,
  });
  const outputNodeId = videoRemixOutputNodeId('remix-node-acceptance');
  state = completeVideoRemixRender(state, {
    jobId: 'render-acceptance',
    inputHash: manifest.inputHash,
    url: '/library/projects/Acceptance/videos/final.mp4',
    duration: manifest.durationSec,
    nodeId: outputNodeId,
  });
  assert.equal(state.stage, 'completed');
});
