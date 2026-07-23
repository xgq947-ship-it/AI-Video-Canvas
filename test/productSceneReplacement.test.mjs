import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProductAnalysisInstruction,
  buildProductScenePrompt,
  buildPlacementAnalysisInstruction,
  buildOverlayAnalysisInstruction,
  buildPoseAnalysisInstruction,
  buildSceneAnalysisInstruction,
  inferProductSceneAspectRatio,
  validateProductDimensions,
} from '../shared/productSceneReplacement.js';

test('产品场景节点把场景图片比例归一化为 Google Flow 支持的画幅', () => {
  assert.equal(inferProductSceneAspectRatio('1080/1920'), '9:16');
  assert.equal(inferProductSceneAspectRatio('1920/1080'), '16:9');
  assert.equal(inferProductSceneAspectRatio('1200/1600'), '3:4');
  assert.equal(inferProductSceneAspectRatio('Auto'), '1:1');
});

test('尺寸必须完整、大于零且单位有效', () => {
  assert.match(validateProductDimensions({ length: 30, width: 0, height: 12, unit: 'cm' }), /长、宽、高/);
  assert.match(validateProductDimensions({ length: 30, width: 20, height: 12, unit: 'm' }), /单位/);
  assert.equal(validateProductDimensions({ length: 30, width: 20, height: 12, unit: 'cm' }), '');
});

test('场景分析排除竞品外观，并把叠加层交给 overlaySpec', () => {
  const instruction = buildSceneAnalysisInstruction();
  assert.match(instruction, /不要描述竞品/);
  assert.match(instruction, /只描述真实拍摄内容/);
  assert.match(instruction, /由 overlaySpec 单独记录/);
  assert.match(instruction, /待替换区域/);
});

test('产品分析可独立控制是否保留我方产品标识', () => {
  assert.match(buildProductAnalysisInstruction({ preserveProductMarkings: true }), /保留并准确描述/);
  assert.match(buildProductAnalysisInstruction({ preserveProductMarkings: false }), /忽略产品上的 Logo/);
});

test('人物姿势与产品位置使用独立几何锁定规格', () => {
  assert.match(buildPoseAnalysisInstruction(), /肩、肘、腕、手掌和手指/);
  assert.match(buildPoseAnalysisInstruction(), /不得把手持改成佩戴/);
  assert.match(buildPlacementAnalysisInstruction(), /画面宽高百分比/);
  assert.match(buildPlacementAnalysisInstruction(), /禁止移到腰腹/);
});

test('指定按摩器材类别只用于理解产品，不覆盖参考图姿势与位置', () => {
  const analysis = buildProductAnalysisInstruction({ productCategory: '足浴盆' });
  assert.match(analysis, /产品类别为“足浴盆”/);
  assert.match(analysis, /不要把常见佩戴或使用方式/);

  const prompt = buildProductScenePrompt({
    sceneAnalysis: '浴室地面场景',
    poseAnalysis: '人物双手保持原坐标',
    placementAnalysis: '产品中心位于画面中央',
    productAnalysis: '白色足浴盆',
    dimensions: { length: 45, width: 38, height: 25, unit: 'cm' },
    productCategory: '足浴盆',
  });
  assert.match(prompt, /产品类别：足浴盆/);
  assert.match(prompt, /禁止依据该类别的常见用法改变参考图1/);
});

test('最终提示词固定两张参考图职责并写入真实尺寸', () => {
  const prompt = buildProductScenePrompt({
    sceneAnalysis: '暖色卧室，侧逆光，产品位于床面中央。',
    poseAnalysis: '双手关键点保持原坐标。',
    placementAnalysis: '产品中心点位于画面宽 50%、高 60%。',
    productAnalysis: '米白色长方形按摩枕，圆角织物表面。',
    dimensions: { length: 42, width: 25, height: 13, unit: 'cm' },
    preserveProductMarkings: true,
    strictSceneComposition: true,
  });
  assert.match(prompt, /参考图1分成两层/);
  assert.match(prompt, /参考图2仅用于我方产品外观/);
  assert.match(prompt, /长 42厘米 × 宽 25厘米 × 高 13厘米/);
  assert.match(prompt, /最高优先级二（清除叠加层）/);
  assert.match(prompt, /局部编辑/);
  assert.match(prompt, /禁止改变人物姿势/);
  assert.match(prompt, /产品位置锁定/);
});

test('清除叠加层与锁定实拍构图是两条同级要求，松散构图下也照样下发', () => {
  const base = {
    sceneAnalysis: '直播间场景',
    poseAnalysis: '双手保持原坐标',
    placementAnalysis: '产品位于胸前',
    productAnalysis: '白色揉腹仪',
    dimensions: { length: 22.5, width: 20, height: 13.7, unit: 'cm' },
  };

  for (const strictSceneComposition of [true, false]) {
    const prompt = buildProductScenePrompt({ ...base, strictSceneComposition });
    assert.match(prompt, /最高优先级一/);
    assert.match(prompt, /最高优先级二（清除叠加层）/);
    // 社交按钮、促销贴这类「牛皮癣」不含文字，必须被单独点名，否则模型会当成背景保留。
    assert.match(prompt, /社交按钮图标及其数字/);
    assert.match(prompt, /促销价格贴/);
    assert.match(prompt, /评价与销量徽标/);
    // 锁定实拍层的措辞不能反过来禁止清除叠加层。
    assert.match(prompt, /不受“保持原图不变”类要求的约束/);
    assert.match(prompt, /清除叠加层后补全的区域除外/);
    assert.doesNotMatch(prompt, /禁止新增肢体或改变背景。$/);
  }
});

test('识别到的叠加层清单会写进提示词，没有叠加层时不产生空行', () => {
  const base = {
    sceneAnalysis: '干净影棚',
    poseAnalysis: '双手保持原坐标',
    placementAnalysis: '产品位于画面中央',
    productAnalysis: '白色揉腹仪',
    dimensions: { length: 22.5, width: 20, height: 13.7, unit: 'cm' },
  };

  const withOverlay = buildProductScenePrompt({
    ...base,
    overlayAnalysis: '左下角「618优惠」促销贴，占宽 5%-45%、高 60%-70%，遮住沙发扶手。',
  });
  assert.match(withOverlay, /必须清除的叠加层清单：左下角「618优惠」促销贴/);

  for (const overlayAnalysis of ['无', '', undefined]) {
    const clean = buildProductScenePrompt({ ...base, overlayAnalysis });
    assert.doesNotMatch(clean, /必须清除的叠加层清单/);
    assert.doesNotMatch(clean, /\n\n/);
  }
});

test('提示词明确要求最高清晰度，且补全区域不能比别处糊', () => {
  const prompt = buildProductScenePrompt({
    sceneAnalysis: '直播间场景',
    poseAnalysis: '双手保持原坐标',
    placementAnalysis: '产品位于胸前',
    productAnalysis: '白色揉腹仪',
    dimensions: { length: 22.5, width: 20, height: 13.7, unit: 'cm' },
  });
  assert.match(prompt, /输出质量：按最高清晰度呈现/);
  assert.match(prompt, /不得出现模糊、涂抹、噪点、过度锐化或压缩伪影/);
  assert.match(prompt, /补全区域的清晰度要与画面其余部分一致/);
});

test('叠加层识别指令按「是否后期加上去」判定，并放过实物文字', () => {
  const instruction = buildOverlayAnalysisInstruction();
  assert.match(instruction, /不是「是否为文字」/);
  assert.match(instruction, /社交按钮图标即使不含文字也必须列出/);
  assert.match(instruction, /产品机身标识、包装印刷/);
  assert.match(instruction, /只输出「无」/);
});
