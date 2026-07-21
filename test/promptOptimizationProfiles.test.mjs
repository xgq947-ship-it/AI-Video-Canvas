import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_PROMPT_OPTIMIZATION_PROFILES,
  buildPromptOptimizationInstruction,
  formatOptimizedPrompt,
  getPromptOptimizationProfile,
} from '../shared/promptOptimizationProfiles.js';

test('图片提示词优化配置固定包含三种角色身份图', () => {
  assert.deepEqual(
    IMAGE_PROMPT_OPTIMIZATION_PROFILES.map(profile => profile.id),
    ['image-identity-front', 'image-identity-angles', 'image-identity-board'],
  );
});

test('三种图片优化均完整携带角色库标准模板的关键结尾与禁止项', () => {
  const front = getPromptOptimizationProfile('image-identity-front');
  const angles = getPromptOptimizationProfile('image-identity-angles');
  const board = getPromptOptimizationProfile('image-identity-board');

  assert.match(front.systemInstruction, /身份一致性高于美化。不要侧脸，不要歪头，不要美颜磨皮，不要网红脸/);
  assert.match(angles.systemInstruction, /鼻尖必须明确朝向画布左边缘/);
  assert.match(angles.systemInstruction, /鼻尖必须明确朝向画布右边缘/);
  assert.match(angles.systemInstruction, /两个侧向人物背向彼此，绝对不能朝向同一侧/);
  assert.match(angles.systemInstruction, /禁止中间区域和右侧区域朝向相同方向/);
  assert.match(angles.systemInstruction, /不要标准 90° 侧面/);
  assert.match(board.systemInstruction, /中间人物的身高、头身比、肩宽、腰臀比例、四肢长度和发型/);
  assert.match(board.systemInstruction, /不要在左侧生成任何人体或假人/);
});

test('图片优化结果强制把目标尺寸比例放在第一行', () => {
  const profile = getPromptOptimizationProfile('image-identity-angles');
  const result = formatOptimizedPrompt('```text\n输出图片尺寸比例：1:1\n\n保持 @莫妮卡 同一张脸\n```', profile);
  assert.equal(result, '输出图片尺寸比例：16:9\n\n保持 @莫妮卡 同一张脸');
});

test('图片优化指令声明文档模板不可删减且必须输出完整成品', () => {
  const profile = getPromptOptimizationProfile('image-identity-front');
  const instruction = buildPromptOptimizationInstruction(profile);
  assert.match(instruction, /权威提示词模板/);
  assert.match(instruction, /不得删减、概括、弱化/);
  assert.match(instruction, /必须输出完整的权威模板成品/);
});

test('优化指令要求保留参考标签并携带视频节点上下文', () => {
  const profile = getPromptOptimizationProfile('video');
  const instruction = buildPromptOptimizationInstruction(profile, {
    targetModel: 'seedance-2-0',
    aspectRatio: '9:16',
    duration: 4,
  });
  assert.match(instruction, /保留原提示词中的每一个 @参考标签/);
  assert.match(instruction, /目标模型：seedance-2-0/);
  assert.match(instruction, /视频时长：4秒/);
});

test('全身综合设定板左侧固定为无人物的隐形模特服装展示', () => {
  const profile = getPromptOptimizationProfile('image-identity-board');
  assert.match(profile.systemInstruction, /左侧仅展示完整服装正面/);
  assert.match(profile.systemInstruction, /绝对不能出现人物、头部、脸、皮肤/);
});
