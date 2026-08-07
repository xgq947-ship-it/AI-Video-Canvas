import test from 'node:test';
import assert from 'node:assert/strict';
import {
    IMAGE_PROMPT_OPTIMIZATION_PROFILES,
    VIDEO_PROMPT_OPTIMIZATION_PROFILES,
    buildPromptOptimizationInstruction,
    formatOptimizedPrompt,
    getPromptOptimizationProfile,
    resolveVideoProfileForModel,
    resolveVideoRemixPromptProfileForModel
} from '../shared/promptOptimizationProfiles.js';

test('图片提示词优化配置包含人物、场景、道具各三种一致性设定图', () => {
  assert.deepEqual(
    IMAGE_PROMPT_OPTIMIZATION_PROFILES.map(profile => profile.id),
    [
      'image-identity-front',
      'image-identity-angles',
      'image-identity-board',
      'image-scene-establishing',
      'image-scene-layout',
      'image-scene-material-lighting',
      'image-prop-front',
      'image-prop-angles',
      'image-prop-details',
      'image-edit-surgical',
    ],
  );
});

test('手术式编辑 profile 输出 CHANGE / PRESERVE EXACTLY 三段式，且不强制改画幅', () => {
  const edit = getPromptOptimizationProfile('image-edit-surgical');
  assert.equal(edit.nodeType, 'image');
  assert.equal(edit.aspectRatio, undefined);
  assert.match(edit.systemInstruction, /CHANGE（只改这一处）/);
  assert.match(edit.systemInstruction, /PRESERVE EXACTLY（逐项锁定）/);
  assert.match(edit.systemInstruction, /ONLY CHANGE/);
  assert.match(edit.systemInstruction, /一次只改一处/);
});

test('图片优化指令统一携带 LIRA 防翻车约束，视频优化不带', () => {
  const imageInstruction = buildPromptOptimizationInstruction(getPromptOptimizationProfile('image-identity-front'));
  assert.match(imageInstruction, /图片通用防翻车约束（LIRA 提炼，适用于全部图片任务）/);
  assert.match(imageInstruction, /60\/30\/10 主辅点缀逻辑/);
  assert.match(imageInstruction, /"painterly（绘画感）"会拉向概念艺术/);
  assert.match(imageInstruction, /不出现真实人名、品牌名、IP 名/);
  const videoInstruction = buildPromptOptimizationInstruction(getPromptOptimizationProfile('video'));
  assert.doesNotMatch(videoInstruction, /图片通用防翻车约束/);
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

// —— 视频提示词分两套：Flow 与即梦的参考图约定完全不通用 ——
test('Flow 与即梦的视频提示词按模型正确分流', () => {
    assert.equal(resolveVideoProfileForModel('google-flow-veo-3-1-lite').id, 'video-flow');
    assert.equal(resolveVideoProfileForModel('google-flow-omni-flash').id, 'video-flow');
    assert.equal(resolveVideoProfileForModel('jimeng-seedance-2-0').id, 'video');
    assert.equal(resolveVideoProfileForModel('jimeng-seedance-2-0-fast').id, 'video');
    // 未知/空模型回落到即梦版（历史默认），不能报错
    assert.equal(resolveVideoProfileForModel('').id, 'video');
    assert.equal(resolveVideoProfileForModel(undefined).id, 'video');
});

test('Flow 版明确禁用 @ 标签，即梦版明确保留 @ 标签', () => {
    const flow = getPromptOptimizationProfile('video-flow');
    const jimeng = getPromptOptimizationProfile('video');

    // Flow 不支持 @名称 指认素材，必须明确要求把 @tag 翻译成外观描述
    assert.match(flow.systemInstruction, /不要使用 @ 标签/);
    assert.match(flow.systemInstruction, /翻译成对该素材的具体外观描述/);
    // Flow 版不得残留「保留 @tag」这类即梦专用指令
    assert.equal(/必须原样保留、不能改名或删除/.test(flow.systemInstruction), false);

    // 即梦反过来：必须保留 @tag，否则指不到具体某张参考图
    assert.match(jimeng.systemInstruction, /必须原样保留、不能改名或删除/);
});

test('两套视频 profile 都挂在 video 节点下且各自标明供应商', () => {
    const ids = VIDEO_PROMPT_OPTIMIZATION_PROFILES.map(p => p.id);
    assert.deepEqual(ids.sort(), ['video', 'video-flow']);
    for (const profile of VIDEO_PROMPT_OPTIMIZATION_PROFILES) {
        assert.equal(profile.nodeType, 'video');
        assert.ok(profile.videoProvider, `${profile.id} 缺少 videoProvider`);
    }
});

test('Video Remix 按目标模型复用现有视频 Profile，并为通用模型使用隔离适配器', () => {
    assert.equal(
        resolveVideoRemixPromptProfileForModel('google-flow-veo-3-1-fast').id,
        'video-flow'
    );
    assert.equal(
        resolveVideoRemixPromptProfileForModel('jimeng-seedance-2-0').id,
        'video'
    );
    assert.equal(
        resolveVideoRemixPromptProfileForModel('seedance-2-0').id,
        'video'
    );
    assert.equal(
        resolveVideoRemixPromptProfileForModel('gemini-web-video').id,
        'video-remix-generic'
    );
});

test('Video Remix 优化指令把资产占位符声明为不可破坏的机器契约', () => {
    const profile = resolveVideoRemixPromptProfileForModel('google-flow-omni-flash');
    const instruction = buildPromptOptimizationInstruction(profile, {
        task: 'optimize_video_remix_video_prompt',
        targetModel: 'google-flow-omni-flash',
        preservePlaceholders: true,
    });
    assert.match(instruction, /\{\{ASSET_ID\}\}/);
    assert.match(instruction, /每一个都必须原样保留/);
    assert.match(instruction, /输出不保留 @ 标签/);
    assert.match(instruction, /任务：optimize_video_remix_video_prompt/);
});

test('关键帧优化器只描述静态画面，不复用完整视频动作路径', () => {
    const profile = getPromptOptimizationProfile('image-remix-keyframe');
    assert.equal(profile.nodeType, 'image-remix');
    assert.match(profile.systemInstruction, /单一静态画面/);
    assert.match(profile.systemInstruction, /不得加入完整动作路径/);
});
