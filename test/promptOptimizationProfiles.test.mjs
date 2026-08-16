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

test('图片手动菜单只保留人物三件套、电商两块板与手术式编辑', () => {
  assert.deepEqual(
    IMAGE_PROMPT_OPTIMIZATION_PROFILES.map(profile => profile.id),
    [
      'image-identity-front',
      'image-identity-angles',
      'image-identity-board',
      'image-model-reference',
      'image-product-reference',
      'image-brand-logo',
      'image-edit-surgical',
    ],
  );
});

test('场景与道具 profile 退出菜单但定义必须还在——视频混剪资产管线按 id 直接取用', () => {
  const hidden = [
    'image-scene-establishing',
    'image-scene-layout',
    'image-scene-material-lighting',
    'image-prop-front',
    'image-prop-angles',
    'image-prop-details',
  ];
  for (const id of hidden) {
    const profile = getPromptOptimizationProfile(id);
    assert.ok(profile, `${id} 定义不得删除`);
    assert.equal(profile.hiddenInMenu, true, `${id} 应标记为不进菜单`);
    assert.equal(
      IMAGE_PROMPT_OPTIMIZATION_PROFILES.some(item => item.id === id),
      false,
      `${id} 不应出现在手动菜单`,
    );
  }
});

test('模特参考图锁身份与造型，明确不带商品，且补上详情页最常用的 45° 角', () => {
  const profile = getPromptOptimizationProfile('image-model-reference');
  assert.equal(profile.nodeType, 'image');
  assert.equal(profile.aspectRatio, '16:9');
  assert.match(profile.systemInstruction, /左前三分之二胸像/);
  assert.match(profile.systemInstruction, /背面半身/);
  // 详情页大量是背影佩戴，缺了背面这格等于让模型编后脑和肩背。
  assert.match(profile.systemInstruction, /后脑发型结构/);
  // 姿态由详情页版式决定，人物板只提供身份。
  assert.match(profile.systemInstruction, /不要让模特佩戴、手持或接触任何商品/);
});

test('产品参考图固定四个必需角度，另两格交给优化器按品类判断', () => {
  const profile = getPromptOptimizationProfile('image-product-reference');
  assert.equal(profile.aspectRatio, '16:9');
  assert.match(profile.systemInstruction, /2 行 × 3 列/);
  assert.match(profile.systemInstruction, /第 1 至 4 格是所有品类都必须具备的固定角度/);
  assert.match(profile.systemInstruction, /左前 45°/);
  assert.match(profile.systemInstruction, /正侧面 90°/);
  assert.match(profile.systemInstruction, /完整背面/);
  assert.match(profile.systemInstruction, /第 5 与第 6 格由你根据参考图判断/);
  assert.match(profile.systemInstruction, /折叠、开合、伸缩等第二形态/);
});

test('产品参考图把「宁可留空也不编造」写成高于填满格子的硬约束', () => {
  const profile = getPromptOptimizationProfile('image-product-reference');
  // 详情页会忠实复刻这块板；编造出来的背面会被原样放大到成品里，
  // 那正好与「产品一致性拉满」的目的相反。
  assert.match(profile.systemInstruction, /优先级高于填满格子/);
  assert.match(profile.systemInstruction, /绝不允许凭空编造结构、接口、纹理或组件/);
  assert.match(profile.systemInstruction, /编号不得压在产品上/);
  // 板上出现文字会被详情页质检判成多余文案，整页失败。
  assert.match(profile.systemInstruction, /不要在板上写任何文字说明/);
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

test('品牌 Logo 图明令禁止底板与材质——那正是 Logo 被画成深色贴片的根源', () => {
  const profile = getPromptOptimizationProfile('image-brand-logo');
  assert.equal(profile.nodeType, 'image');
  assert.equal(profile.aspectRatio, '1:1');
  assert.match(profile.systemInstruction, /纯白背景/);
  assert.match(profile.systemInstruction, /四周留出至少百分之十五的空白边距/);
  // 详情图链路的质检有专门的 logoPresentationCorrect 字段盯这一类失败。
  assert.match(profile.systemInstruction, /不要给标识加任何底板、色块、圆角矩形、边框、投影/);
  assert.match(profile.systemInstruction, /不要把标识放在产品表面、包装、招牌或任何材质上/);
});

test('产品板禁止出现人脸——板上的脸会和模特参考图争夺身份权威', () => {
  const profile = getPromptOptimizationProfile('image-product-reference');
  assert.match(profile.systemInstruction, /无身份铁律/);
  assert.match(profile.systemInstruction, /画面上边缘要切在下巴以下，让头部完全出画/);
  // 说明「为什么」而不只是「不许」，模型照做的概率明显更高。
  assert.match(profile.systemInstruction, /两张参考图就会互相争夺身份权威/);
  assert.match(profile.systemInstruction, /不要出现任何人脸或可识别的人物/);
});
