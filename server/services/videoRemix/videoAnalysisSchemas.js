import { z } from 'zod';

const text = (maximum = 4000) => z.string().trim().min(1).max(maximum);
const optionalText = (maximum = 1000) => z.string().trim().max(maximum).optional();
const identifier = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/);
const confidence = z.number().min(0).max(1);
const seconds = z.number().finite().min(0);

const voiceDescriptionSchema = z.object({
  language: optionalText(80),
  gender: optionalText(80),
  ageFeel: optionalText(120),
  tone: optionalText(240),
  pitch: optionalText(120),
  speakingStyle: optionalText(240),
}).strict();

const characterSchema = z.object({
  id: identifier,
  name: text(120),
  identity: text(1200),
  looks: z.array(z.object({
    id: identifier,
    name: text(120),
    description: text(800),
  }).strict()).max(20),
  voiceDescription: voiceDescriptionSchema.optional(),
  appearsInShots: z.array(identifier).max(500),
}).strict();

const sceneSchema = z.object({
  id: identifier,
  name: text(160),
  visualDescription: text(1200),
  audioDescription: optionalText(800),
  zones: z.array(z.object({
    id: identifier,
    name: text(120),
    description: text(600),
  }).strict()).max(30),
  appearsInShots: z.array(identifier).max(500),
}).strict();

const propSchema = z.object({
  id: identifier,
  name: text(160),
  category: z.enum(['hero', 'interactive', 'background']),
  description: text(1000),
  appearsInShots: z.array(identifier).max(500),
}).strict();

export const globalVideoAnalysisSchema = z.object({
  story: z.object({
    summary: text(4000),
    genre: text(200),
    structure: z.array(text(800)).min(1).max(30),
  }).strict(),
  characters: z.array(characterSchema).max(80),
  scenes: z.array(sceneSchema).max(80),
  props: z.array(propSchema).max(150),
  style: text(2000),
  shotComplexities: z.array(z.object({
    shotId: identifier,
    motionComplexity: z.enum(['simple', 'medium', 'complex']),
    confidence,
  }).strict()).min(1).max(500),
}).strict();

const aiEditableStringSchema = z.object({
  value: z.string().trim().max(3000),
  confidence,
}).strict();

const timedActionSchema = z.object({
  start: seconds,
  end: seconds,
  action: text(800),
  category: z.enum(['body', 'pose', 'hand', 'facial', 'object']).optional(),
}).strict();

const continuitySchema = z.object({
  characterStates: z.record(z.object({
    holding: optionalText(200),
    position: optionalText(300),
    direction: optionalText(200),
    emotion: optionalText(200),
    lookId: identifier.optional(),
  }).strict()),
  sceneId: identifier.optional(),
  sceneZone: identifier.optional(),
  lighting: optionalText(300),
  time: optionalText(200),
}).strict();

const cameraMovementType = z.enum([
  'static',
  'pan_left',
  'pan_right',
  'tilt_up',
  'tilt_down',
  'dolly_in',
  'dolly_out',
  'truck_left',
  'truck_right',
  'orbit',
  'handheld',
  'zoom_in',
  'zoom_out',
]);

export const shotVideoAnalysisSchema = z.object({
  shotId: identifier,
  storyBeat: aiEditableStringSchema,
  characters: z.array(z.object({
    characterId: identifier,
    lookId: identifier.optional(),
  }).strict()).max(30),
  scene: z.object({
    sceneId: identifier.optional(),
    sceneZone: identifier.optional(),
  }).strict(),
  props: z.array(z.object({
    propId: identifier,
    role: optionalText(300),
  }).strict()).max(50),
  frameBlueprint: z.object({
    shotSize: aiEditableStringSchema,
    cameraAngle: aiEditableStringSchema,
    subjects: z.array(z.object({
      id: identifier,
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      scale: z.number().positive().max(10),
      facing: optionalText(120),
      pose: optionalText(400),
    }).strict()).max(30),
    props: z.array(z.object({
      id: identifier,
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      scale: z.number().positive().max(10).optional(),
    }).strict()).max(50),
  }).strict(),
  motionBlueprint: z.object({
    subjects: z.array(z.object({
      characterId: identifier,
      actionSequence: z.array(timedActionSchema).max(80),
      movementDirection: optionalText(240),
    }).strict()).max(30),
    propInteractions: z.array(z.object({
      actor: identifier,
      prop: identifier,
      action: text(600),
      hand: z.enum(['left', 'right', 'both']).optional(),
      start: seconds,
      end: seconds,
    }).strict()).max(80),
  }).strict(),
  cameraBlueprint: z.object({
    shotSize: aiEditableStringSchema,
    angle: aiEditableStringSchema,
    movement: z.array(z.object({
      type: cameraMovementType,
      start: seconds.optional(),
      end: seconds.optional(),
    }).strict()).max(20),
    lensFeel: aiEditableStringSchema.optional(),
  }).strict(),
  timingBlueprint: z.object({
    phases: z.array(z.object({
      phase: text(300),
      start: seconds,
      end: seconds,
    }).strict()).max(40),
  }).strict(),
  audioBlueprint: z.object({
    dialogue: z.array(z.object({
      characterId: identifier,
      text: aiEditableStringSchema,
      emotion: optionalText(200),
      start: seconds.optional(),
      end: seconds.optional(),
    }).strict()).max(80),
    environment: aiEditableStringSchema,
    soundEvents: z.array(z.object({
      start: seconds,
      end: seconds,
      description: text(600),
    }).strict()).max(80),
  }).strict(),
  motionComplexity: z.enum(['simple', 'medium', 'complex']),
  startState: continuitySchema.optional(),
  endState: continuitySchema.optional(),
  transition: z.enum(['hard_cut', 'fade', 'flash', 'zoom', 'match_motion', 'other']),
}).strict();

export class StructuredAnalysisError extends Error {
  constructor(message, {
    code = 'ANALYSIS_SCHEMA_INVALID',
    issues = [],
    cause,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'StructuredAnalysisError';
    this.code = code;
    this.status = 422;
    this.retryable = true;
    this.issues = issues;
  }
}

export function parseStrictStructuredJson(value) {
  const source = String(value || '').trim();
  if (!source.startsWith('{') || !source.endsWith('}')) {
    throw new StructuredAnalysisError('Gemini 没有返回纯 JSON 对象', {
      issues: ['根输出必须从 { 开始并以 } 结束，不能包含 Markdown 或说明文字'],
    });
  }
  try {
    const parsed = JSON.parse(source);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('根值不是对象');
    }
    return parsed;
  } catch (error) {
    throw new StructuredAnalysisError('Gemini 返回的 JSON 无法解析', {
      issues: [error.message],
      cause: error,
    });
  }
}

function formattedIssues(error) {
  if (!(error instanceof z.ZodError)) return [error?.message || String(error)];
  return error.issues.slice(0, 12).map(issue => (
    `${issue.path.join('.') || '<root>'}: ${issue.message}`
  ));
}

function assertUniqueIds(items, label, issues) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) issues.push(`${label} 出现重复 id：${item.id}`);
    seen.add(item.id);
  }
}

export function normalizeGlobalVideoAnalysis(raw, expectedShotIds) {
  let parsed;
  try {
    parsed = globalVideoAnalysisSchema.parse(raw);
  } catch (error) {
    throw new StructuredAnalysisError('全片分析未通过结构校验', {
      issues: formattedIssues(error),
      cause: error,
    });
  }

  const expected = new Set(expectedShotIds.map(String));
  const issues = [];
  assertUniqueIds(parsed.characters, 'characters', issues);
  assertUniqueIds(parsed.scenes, 'scenes', issues);
  assertUniqueIds(parsed.props, 'props', issues);
  for (const character of parsed.characters) assertUniqueIds(character.looks, `${character.id}.looks`, issues);
  for (const scene of parsed.scenes) assertUniqueIds(scene.zones, `${scene.id}.zones`, issues);
  const classifications = new Map();
  for (const item of parsed.shotComplexities) {
    if (!expected.has(item.shotId)) issues.push(`shotComplexities 引用了未知 Shot：${item.shotId}`);
    if (classifications.has(item.shotId)) issues.push(`shotComplexities 重复：${item.shotId}`);
    classifications.set(item.shotId, item);
  }
  for (const shotId of expected) {
    if (!classifications.has(shotId)) issues.push(`shotComplexities 缺少：${shotId}`);
  }
  for (const collection of [parsed.characters, parsed.scenes, parsed.props]) {
    for (const asset of collection) {
      for (const shotId of asset.appearsInShots) {
        if (!expected.has(shotId)) issues.push(`${asset.id}.appearsInShots 引用了未知 Shot：${shotId}`);
      }
    }
  }
  if (issues.length > 0) {
    throw new StructuredAnalysisError('全片分析存在无效或重复引用', { issues });
  }

  return {
    story: parsed.story,
    characters: parsed.characters.map(character => ({
      ...character,
      looks: character.looks.map(look => ({ ...look, referenceImages: [] })),
      referenceImages: [],
      source: 'analysis',
    })),
    scenes: parsed.scenes.map(scene => ({
      ...scene,
      referenceImages: [],
      source: 'analysis',
    })),
    props: parsed.props.map(prop => ({
      ...prop,
      referenceImages: [],
      source: 'analysis',
    })),
    style: parsed.style,
    shotComplexities: parsed.shotComplexities,
  };
}

const editable = field => ({
  value: field.value,
  source: 'ai',
  confidence: field.confidence,
  locked: false,
});

function isLockedUserField(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && value.source === 'user'
    && value.locked === true
    && Object.hasOwn(value, 'value')
  );
}

function containsLockedUserField(value) {
  if (isLockedUserField(value)) return true;
  if (Array.isArray(value)) return value.some(containsLockedUserField);
  return Boolean(
    value
    && typeof value === 'object'
    && Object.values(value).some(containsLockedUserField)
  );
}

function arrayIdentity(value) {
  if (!value || typeof value !== 'object') return '';
  return String(
    value.shotId
    || value.characterId
    || value.sceneId
    || value.propId
    || value.id
    || ''
  );
}

export function mergeLockedAnalysisFields(previous, incoming) {
  if (isLockedUserField(previous)) return previous;
  if (Array.isArray(incoming)) {
    const previousList = Array.isArray(previous) ? previous : [];
    const matched = new Set();
    const merged = incoming.map((item, index) => {
      const identity = arrayIdentity(item);
      const previousIndex = identity
        ? previousList.findIndex((candidate, candidateIndex) => (
          !matched.has(candidateIndex) && arrayIdentity(candidate) === identity
        ))
        : (!matched.has(index) ? index : -1);
      if (previousIndex >= 0) matched.add(previousIndex);
      return mergeLockedAnalysisFields(previousList[previousIndex], item);
    });
    previousList.forEach((item, index) => {
      if (!matched.has(index) && containsLockedUserField(item)) merged.push(item);
    });
    return merged;
  }
  if (incoming && typeof incoming === 'object') {
    const keys = new Set(Object.keys(incoming));
    if (previous && typeof previous === 'object') {
      for (const [key, value] of Object.entries(previous)) {
        if (containsLockedUserField(value)) keys.add(key);
      }
    }
    return Object.fromEntries([...keys].map(key => [
      key,
      Object.hasOwn(incoming, key)
        ? mergeLockedAnalysisFields(previous?.[key], incoming[key])
        : previous[key],
    ]));
  }
  return incoming;
}

function validateTimedRange(item, duration, pathLabel, issues, optional = false) {
  if (optional && item.start === undefined && item.end === undefined) return;
  if (item.start !== undefined && item.start > duration) issues.push(`${pathLabel}.start 超出 Shot 时长`);
  if (item.end !== undefined && item.end > duration) issues.push(`${pathLabel}.end 超出 Shot 时长`);
  if (item.start !== undefined && item.end !== undefined && item.end < item.start) {
    issues.push(`${pathLabel}.end 早于 start`);
  }
}

export function normalizeShotVideoAnalysis(raw, {
  shot,
  globalAnalysis,
}) {
  let parsed;
  try {
    parsed = shotVideoAnalysisSchema.parse(raw);
  } catch (error) {
    throw new StructuredAnalysisError(`${shot.shotId} 未通过结构校验`, {
      issues: formattedIssues(error),
      cause: error,
    });
  }
  const issues = [];
  if (parsed.shotId !== shot.shotId) {
    issues.push(`shotId 必须是 ${shot.shotId}`);
  }
  const characterById = new Map(globalAnalysis.characters.map(item => [item.id, item]));
  const sceneById = new Map(globalAnalysis.scenes.map(item => [item.id, item]));
  const characterIds = new Set(characterById.keys());
  const sceneIds = new Set(sceneById.keys());
  const propIds = new Set(globalAnalysis.props.map(item => item.id));
  for (const item of parsed.characters) {
    if (!characterIds.has(item.characterId)) issues.push(`未知 characterId：${item.characterId}`);
    if (
      item.lookId
      && !characterById.get(item.characterId)?.looks.some(look => look.id === item.lookId)
    ) {
      issues.push(`${item.characterId} 不存在 lookId：${item.lookId}`);
    }
  }
  if (parsed.scene.sceneId && !sceneIds.has(parsed.scene.sceneId)) {
    issues.push(`未知 sceneId：${parsed.scene.sceneId}`);
  }
  if (
    parsed.scene.sceneZone
    && !sceneById.get(parsed.scene.sceneId)?.zones.some(zone => zone.id === parsed.scene.sceneZone)
  ) {
    issues.push(`${parsed.scene.sceneId || '空场景'} 不存在 sceneZone：${parsed.scene.sceneZone}`);
  }
  for (const item of parsed.props) {
    if (!propIds.has(item.propId)) issues.push(`未知 propId：${item.propId}`);
  }
  for (const item of parsed.frameBlueprint.subjects) {
    if (!characterIds.has(item.id)) issues.push(`frameBlueprint.subjects 未知 id：${item.id}`);
  }
  for (const item of parsed.frameBlueprint.props) {
    if (!propIds.has(item.id)) issues.push(`frameBlueprint.props 未知 id：${item.id}`);
  }
  for (const [index, subject] of parsed.motionBlueprint.subjects.entries()) {
    if (!characterIds.has(subject.characterId)) {
      issues.push(`motionBlueprint.subjects 未知 characterId：${subject.characterId}`);
    }
    subject.actionSequence.forEach((item, actionIndex) => {
      validateTimedRange(item, shot.duration, `subjects.${index}.actionSequence.${actionIndex}`, issues);
    });
  }
  parsed.motionBlueprint.propInteractions.forEach((item, index) => {
    if (!characterIds.has(item.actor)) issues.push(`propInteractions.${index}.actor 未知：${item.actor}`);
    if (!propIds.has(item.prop)) issues.push(`propInteractions.${index}.prop 未知：${item.prop}`);
    validateTimedRange(item, shot.duration, `propInteractions.${index}`, issues);
  });
  parsed.cameraBlueprint.movement.forEach((item, index) => {
    validateTimedRange(item, shot.duration, `cameraMovement.${index}`, issues, true);
  });
  parsed.timingBlueprint.phases.forEach((item, index) => {
    validateTimedRange(item, shot.duration, `timing.phases.${index}`, issues);
  });
  parsed.audioBlueprint.dialogue.forEach((item, index) => {
    if (!characterIds.has(item.characterId)) issues.push(`dialogue.${index}.characterId 未知：${item.characterId}`);
    validateTimedRange(item, shot.duration, `dialogue.${index}`, issues, true);
  });
  parsed.audioBlueprint.soundEvents.forEach((item, index) => {
    validateTimedRange(item, shot.duration, `soundEvents.${index}`, issues);
  });
  for (const [stateName, state] of [
    ['startState', parsed.startState],
    ['endState', parsed.endState],
  ]) {
    if (!state) continue;
    if (state.sceneId && !sceneIds.has(state.sceneId)) issues.push(`${stateName}.sceneId 未知：${state.sceneId}`);
    if (
      state.sceneZone
      && !sceneById.get(state.sceneId)?.zones.some(zone => zone.id === state.sceneZone)
    ) {
      issues.push(`${stateName}.sceneZone 未知：${state.sceneZone}`);
    }
    for (const [characterId, characterState] of Object.entries(state.characterStates)) {
      if (!characterIds.has(characterId)) issues.push(`${stateName}.characterStates 未知：${characterId}`);
      if (characterState.holding && !propIds.has(characterState.holding)) {
        issues.push(`${stateName}.${characterId}.holding 未知：${characterState.holding}`);
      }
      if (
        characterState.lookId
        && !characterById.get(characterId)?.looks.some(look => look.id === characterState.lookId)
      ) {
        issues.push(`${stateName}.${characterId}.lookId 未知：${characterState.lookId}`);
      }
    }
  }
  if (issues.length > 0) {
    throw new StructuredAnalysisError(`${shot.shotId} 存在无效引用或时间`, { issues });
  }

  const incoming = {
    ...shot,
    storyBeat: editable(parsed.storyBeat),
    characters: parsed.characters,
    scene: parsed.scene,
    props: parsed.props,
    frameBlueprint: {
      ...parsed.frameBlueprint,
      shotSize: editable(parsed.frameBlueprint.shotSize),
      cameraAngle: editable(parsed.frameBlueprint.cameraAngle),
    },
    motionBlueprint: parsed.motionBlueprint,
    cameraBlueprint: {
      ...parsed.cameraBlueprint,
      shotSize: editable(parsed.cameraBlueprint.shotSize),
      angle: editable(parsed.cameraBlueprint.angle),
      ...(parsed.cameraBlueprint.lensFeel
        ? { lensFeel: editable(parsed.cameraBlueprint.lensFeel) }
        : {}),
    },
    timingBlueprint: parsed.timingBlueprint,
    audioBlueprint: {
      ...parsed.audioBlueprint,
      dialogue: parsed.audioBlueprint.dialogue.map(item => ({
        ...item,
        text: editable(item.text),
      })),
      environment: editable(parsed.audioBlueprint.environment),
    },
    motionComplexity: parsed.motionComplexity,
    startState: parsed.startState,
    endState: parsed.endState,
    transition: parsed.transition,
    analysisStatus: 'ready',
    analysisError: undefined,
    analyzedAt: new Date().toISOString(),
  };
  return mergeLockedAnalysisFields(shot, incoming);
}

export const GLOBAL_ANALYSIS_OUTPUT_CONTRACT = `{
  "story":{"summary":"string","genre":"string","structure":["string"]},
  "characters":[{"id":"CHAR_01","name":"string","identity":"string","looks":[{"id":"LOOK_01","name":"string","description":"string"}],"voiceDescription":{"language":"string","gender":"string","ageFeel":"string","tone":"string","pitch":"string","speakingStyle":"string"},"appearsInShots":["shot_001"]}],
  "scenes":[{"id":"SCENE_01","name":"string","visualDescription":"string","audioDescription":"string","zones":[{"id":"ZONE_01","name":"string","description":"string"}],"appearsInShots":["shot_001"]}],
  "props":[{"id":"PROP_01","name":"string","category":"hero|interactive|background","description":"string","appearsInShots":["shot_001"]}],
  "style":"string",
  "shotComplexities":[{"shotId":"shot_001","motionComplexity":"simple|medium|complex","confidence":0.0}]
}`;

export const SHOT_ANALYSIS_OUTPUT_CONTRACT = `{
  "shotId":"shot_001",
  "storyBeat":{"value":"string","confidence":0.0},
  "characters":[{"characterId":"CHAR_01","lookId":"LOOK_01"}],
  "scene":{"sceneId":"SCENE_01","sceneZone":"ZONE_01"},
  "props":[{"propId":"PROP_01","role":"string"}],
  "frameBlueprint":{"shotSize":{"value":"string","confidence":0.0},"cameraAngle":{"value":"string","confidence":0.0},"subjects":[{"id":"CHAR_01","x":0.5,"y":0.5,"scale":1,"facing":"string","pose":"string"}],"props":[{"id":"PROP_01","x":0.5,"y":0.5,"scale":1}]},
  "motionBlueprint":{"subjects":[{"characterId":"CHAR_01","actionSequence":[{"start":0,"end":1,"action":"string","category":"body|pose|hand|facial|object"}],"movementDirection":"string"}],"propInteractions":[{"actor":"CHAR_01","prop":"PROP_01","action":"string","hand":"left|right|both","start":0,"end":1}]},
  "cameraBlueprint":{"shotSize":{"value":"string","confidence":0.0},"angle":{"value":"string","confidence":0.0},"movement":[{"type":"static|pan_left|pan_right|tilt_up|tilt_down|dolly_in|dolly_out|truck_left|truck_right|orbit|handheld|zoom_in|zoom_out","start":0,"end":1}],"lensFeel":{"value":"string","confidence":0.0}},
  "timingBlueprint":{"phases":[{"phase":"string","start":0,"end":1}]},
  "audioBlueprint":{"dialogue":[{"characterId":"CHAR_01","text":{"value":"string","confidence":0.0},"emotion":"string","start":0,"end":1}],"environment":{"value":"string","confidence":0.0},"soundEvents":[{"start":0,"end":1,"description":"string"}]},
  "motionComplexity":"simple|medium|complex",
  "startState":{"characterStates":{},"sceneId":"SCENE_01","sceneZone":"ZONE_01","lighting":"string","time":"string"},
  "endState":{"characterStates":{},"sceneId":"SCENE_01","sceneZone":"ZONE_01","lighting":"string","time":"string"},
  "transition":"hard_cut|fade|flash|zoom|match_motion|other"
}`;
