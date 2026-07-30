import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildVideoRemixShots,
} from '../shared/videoRemix.js';
import {
  GeminiVideoAnalyzer,
} from '../server/services/videoRemix/geminiVideoAnalyzer.js';
import {
  normalizeShotVideoAnalysis,
  parseStrictStructuredJson,
} from '../server/services/videoRemix/videoAnalysisSchemas.js';
import {
  analyzeVideoRemixGlobal,
  analyzeVideoRemixShot,
  loadVideoRemixAnalysisSnapshot,
} from '../server/services/videoRemix/videoAnalysis.js';

function globalFixture(shotIds = ['shot_001']) {
  return {
    story: {
      summary: '人物在房间中拿起杯子。',
      genre: '生活',
      structure: ['进入房间', '拿起杯子'],
    },
    characters: [{
      id: 'CHAR_01',
      name: '女主',
      identity: '年轻女性，黑色长发',
      looks: [{ id: 'LOOK_01', name: '日常造型', description: '白色上衣' }],
      voiceDescription: {
        language: 'zh-CN',
        gender: 'female',
        ageFeel: '25岁',
        tone: '自然',
        pitch: '中等',
        speakingStyle: '生活化',
      },
      appearsInShots: shotIds,
    }],
    scenes: [{
      id: 'SCENE_01',
      name: '房间',
      visualDescription: '日光室内',
      audioDescription: '安静环境声',
      zones: [{ id: 'ZONE_01', name: '桌边', description: '木桌附近' }],
      appearsInShots: shotIds,
    }],
    props: [{
      id: 'PROP_01',
      name: '杯子',
      category: 'interactive',
      description: '白色陶瓷杯',
      appearsInShots: shotIds,
    }],
    style: '自然写实，柔和日光',
    shotComplexities: shotIds.map((shotId, index) => ({
      shotId,
      motionComplexity: ['simple', 'medium', 'complex'][index] || 'medium',
      confidence: 0.9,
    })),
  };
}

function shotFixture(shotId = 'shot_001', duration = 1) {
  return {
    shotId,
    storyBeat: { value: '人物拿起杯子', confidence: 0.94 },
    characters: [{ characterId: 'CHAR_01', lookId: 'LOOK_01' }],
    scene: { sceneId: 'SCENE_01', sceneZone: 'ZONE_01' },
    props: [{ propId: 'PROP_01', role: '被拿起' }],
    frameBlueprint: {
      shotSize: { value: 'medium shot', confidence: 0.9 },
      cameraAngle: { value: 'eye level', confidence: 0.9 },
      subjects: [{ id: 'CHAR_01', x: 0.5, y: 0.5, scale: 1, facing: 'front', pose: 'standing' }],
      props: [{ id: 'PROP_01', x: 0.65, y: 0.65, scale: 0.3 }],
    },
    motionBlueprint: {
      subjects: [{
        characterId: 'CHAR_01',
        actionSequence: [{ start: 0, end: duration, action: '伸手拿杯子', category: 'hand' }],
        movementDirection: '向右',
      }],
      propInteractions: [{
        actor: 'CHAR_01',
        prop: 'PROP_01',
        action: '右手拿起',
        hand: 'right',
        start: 0,
        end: duration,
      }],
    },
    cameraBlueprint: {
      shotSize: { value: 'medium shot', confidence: 0.9 },
      angle: { value: 'eye level', confidence: 0.9 },
      movement: [{ type: 'static', start: 0, end: duration }],
      lensFeel: { value: 'normal lens', confidence: 0.8 },
    },
    timingBlueprint: {
      phases: [{ phase: '拿取', start: 0, end: duration }],
    },
    audioBlueprint: {
      dialogue: [{
        characterId: 'CHAR_01',
        text: { value: '好。', confidence: 0.8 },
        emotion: '平静',
        start: 0,
        end: duration,
      }],
      environment: { value: '轻微室内底噪', confidence: 0.7 },
      soundEvents: [{ start: 0, end: duration, description: '杯子触碰桌面' }],
    },
    motionComplexity: 'medium',
    startState: {
      characterStates: { CHAR_01: { position: '桌边', lookId: 'LOOK_01' } },
      sceneId: 'SCENE_01',
      sceneZone: 'ZONE_01',
      lighting: '柔和日光',
      time: '白天',
    },
    endState: {
      characterStates: { CHAR_01: { holding: 'PROP_01', position: '桌边', lookId: 'LOOK_01' } },
      sceneId: 'SCENE_01',
      sceneZone: 'ZONE_01',
      lighting: '柔和日光',
      time: '白天',
    },
    transition: 'hard_cut',
  };
}

test('结构化解析拒绝 Markdown 或 JSON 前后的自由文本', () => {
  assert.throws(
    () => parseStrictStructuredJson('```json\n{"story":{}}\n```'),
    error => error.code === 'ANALYSIS_SCHEMA_INVALID'
  );
  assert.deepEqual(parseStrictStructuredJson('{"ok":true}'), { ok: true });
});

test('Gemini 结构校验失败后沿用会话纠错，不重复上传完整视频', async () => {
  const calls = [];
  const valid = globalFixture(['shot_001']);
  const analyzer = new GeminiVideoAnalyzer({
    taskRunner: async options => {
      calls.push(options);
      if (calls.length === 1) {
        return {
          text: '{"story":{}}',
          conversation: { conversationId: 'c_analysis', responseId: 'r_1' },
        };
      }
      return {
        text: JSON.stringify(valid),
        conversation: { conversationId: 'c_analysis', responseId: 'r_2' },
      };
    },
  });
  const result = await analyzer.analyzeVideo({
    source: {
      duration: 1,
      width: 1280,
      height: 720,
      fps: 15,
      hasAudio: true,
      orientation: 'landscape',
    },
    shots: [{ shotId: 'shot_001', start: 0, end: 1, duration: 1 }],
    proxyFile: { buffer: Buffer.from('proxy'), fileName: 'proxy.mp4', mimeType: 'video/mp4' },
    mode: 'fast',
  });

  assert.equal(result.characters[0].source, 'analysis');
  assert.deepEqual(result.characters[0].referenceImages, []);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].files.length, 1);
  assert.equal(calls[1].files.length, 0);
  assert.equal(calls[1].conversation.conversationId, 'c_analysis');
  assert.match(calls[1].prompt, /校验错误/);
});

test('重新分析不会覆盖 user + locked 的重要字段', () => {
  const shot = buildVideoRemixShots({ duration: 1 })[0];
  shot.storyBeat = {
    value: '用户确认的剧情节拍',
    source: 'user',
    locked: true,
  };
  shot.cameraBlueprint.lensFeel = {
    value: '用户指定长焦',
    source: 'user',
    locked: true,
  };
  const global = globalFixture([shot.shotId]);
  const normalizedGlobal = {
    ...global,
    characters: global.characters.map(item => ({ ...item, source: 'analysis', referenceImages: [] })),
    scenes: global.scenes.map(item => ({ ...item, source: 'analysis', referenceImages: [] })),
    props: global.props.map(item => ({ ...item, source: 'analysis', referenceImages: [] })),
  };
  const rawShot = shotFixture(shot.shotId);
  delete rawShot.cameraBlueprint.lensFeel;
  const result = normalizeShotVideoAnalysis(rawShot, {
    shot,
    globalAnalysis: normalizedGlobal,
  });

  assert.deepEqual(result.storyBeat, shot.storyBeat);
  assert.deepEqual(result.cameraBlueprint.lensFeel, shot.cameraBlueprint.lensFeel);
  assert.equal(result.frameBlueprint.shotSize.source, 'ai');
  assert.equal(result.frameBlueprint.shotSize.confidence, 0.9);
  assert.equal(result.analysisStatus, 'ready');
});

function makeAnalysisContext(t) {
  const libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-remix-analysis-'));
  t.after(() => fs.rmSync(libraryDir, { recursive: true, force: true }));
  const workflowsDir = path.join(libraryDir, 'workflows');
  const projectsDir = path.join(libraryDir, 'projects');
  const projectName = '分析测试项目';
  const runName = 'run_proxy';
  const runDirectory = path.join(
    projectsDir,
    projectName,
    'video-remix',
    'remix_analysis',
    'preprocess',
    runName
  );
  fs.mkdirSync(workflowsDir, { recursive: true });
  fs.mkdirSync(runDirectory, { recursive: true });
  fs.writeFileSync(path.join(workflowsDir, 'workflow-1.json'), JSON.stringify({
    id: 'workflow-1',
    title: projectName,
    projectDirName: projectName,
    nodes: [],
  }));
  fs.writeFileSync(path.join(runDirectory, 'analysis_proxy.mp4'), 'proxy-bytes');

  const shots = buildVideoRemixShots({ duration: 3, cutPoints: [1, 2] }).map(shot => {
    const frames = ['start', 'quarter', 'middle', 'three_quarter', 'end'].map(position => {
      const frameDirectory = path.join(runDirectory, 'shots', shot.shotId, 'frames');
      fs.mkdirSync(frameDirectory, { recursive: true });
      fs.writeFileSync(path.join(frameDirectory, `${position}.jpg`), `jpeg-${position}`);
      return {
        position,
        time: shot.start,
        url: `/library/projects/${encodeURIComponent(projectName)}/video-remix/remix_analysis/preprocess/${runName}/shots/${shot.shotId}/frames/${position}.jpg`,
      };
    });
    return { ...shot, analysisFrames: frames };
  });
  const calls = [];
  const global = globalFixture(shots.map(shot => shot.shotId));
  const analyzer = {
    analyzeVideo: async input => {
      calls.push({ kind: 'global', files: [input.proxyFile] });
      return global;
    },
    analyzeShot: async input => {
      calls.push({
        kind: 'shot',
        shotId: input.shot.shotId,
        inputKind: input.inputKind,
        fileCount: input.files.length,
      });
      return {
        ...input.shot,
        storyBeat: { value: `分析 ${input.shot.shotId}`, source: 'ai', confidence: 0.9, locked: false },
        analysisStatus: 'ready',
        analyzedAt: new Date().toISOString(),
      };
    },
  };
  return {
    context: {
      libraryDir,
      workflowsDir,
      projectsDir,
      analyzer,
      clipBuilder: async ({ shot }) => ({
        buffer: Buffer.from(`clip-${shot.shotId}`),
        fileName: `${shot.shotId}.mp4`,
        mimeType: 'video/mp4',
      }),
    },
    source: {
      id: 'ref_analysis',
      sourceType: 'local',
      localUrl: '/unused/original.mp4',
      proxyUrl: `/library/projects/${encodeURIComponent(projectName)}/video-remix/remix_analysis/preprocess/${runName}/analysis_proxy.mp4`,
      sourceHash: 'source-hash',
      duration: 3,
      width: 1280,
      height: 720,
      fps: 15,
      hasAudio: true,
      orientation: 'landscape',
    },
    shots,
    calls,
  };
}

test('全片只上传一次，Shot 按复杂度使用三帧、五帧或完整片段并可逐个恢复', async (t) => {
  const {
    context,
    source,
    shots,
    calls,
  } = makeAnalysisContext(t);
  const global = await analyzeVideoRemixGlobal({
    workflowId: 'workflow-1',
    remixId: 'remix_analysis',
    source,
    shots,
    mode: 'fast',
  }, context);
  assert.ok(global.analysisKey);
  assert.equal(calls.filter(call => call.kind === 'global').length, 1);

  for (const shot of shots) {
    await analyzeVideoRemixShot({
      workflowId: 'workflow-1',
      remixId: 'remix_analysis',
      source,
      shots,
      shotId: shot.shotId,
      mode: 'fast',
      analysisKey: global.analysisKey,
    }, context);
  }
  assert.deepEqual(
    calls.filter(call => call.kind === 'shot').map(call => [call.inputKind, call.fileCount]),
    [['three_frames', 3], ['five_frames', 5], ['video', 1]]
  );

  const snapshot = await loadVideoRemixAnalysisSnapshot({
    workflowId: 'workflow-1',
    remixId: 'remix_analysis',
    source,
    shots,
    mode: 'fast',
    analysisKey: global.analysisKey,
  }, context);
  assert.equal(snapshot.shots.length, 3);
  assert.equal(snapshot.shots[0].analysisFrames.length, 5);
  assert.equal(snapshot.shots[2].storyBeat.value, '分析 shot_003');
});
