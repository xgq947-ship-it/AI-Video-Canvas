import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProductAnalysisInstruction,
  buildProductScenePrompt,
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

test('场景分析排除竞品外观和所有场景文字', () => {
  const instruction = buildSceneAnalysisInstruction();
  assert.match(instruction, /不要描述竞品/);
  assert.match(instruction, /标题、文案、字幕/);
  assert.match(instruction, /待替换区域/);
});

test('产品分析可独立控制是否保留我方产品标识', () => {
  assert.match(buildProductAnalysisInstruction({ preserveProductMarkings: true }), /保留并准确描述/);
  assert.match(buildProductAnalysisInstruction({ preserveProductMarkings: false }), /忽略产品上的 Logo/);
});

test('指定按摩器材类别后，分析与生成提示词都携带类别使用语义', () => {
  const analysis = buildProductAnalysisInstruction({ productCategory: '足浴盆' });
  assert.match(analysis, /产品类别为“足浴盆”/);
  assert.match(analysis, /正常使用方式、朝向、接触面/);

  const prompt = buildProductScenePrompt({
    sceneAnalysis: '浴室地面场景',
    productAnalysis: '白色足浴盆',
    dimensions: { length: 45, width: 38, height: 25, unit: 'cm' },
    productCategory: '足浴盆',
  });
  assert.match(prompt, /产品类别：足浴盆/);
  assert.match(prompt, /真实、常见且安全的使用方式/);
});

test('最终提示词固定两张参考图职责并写入真实尺寸', () => {
  const prompt = buildProductScenePrompt({
    sceneAnalysis: '暖色卧室，侧逆光，产品位于床面中央。',
    productAnalysis: '米白色长方形按摩枕，圆角织物表面。',
    dimensions: { length: 42, width: 25, height: 13, unit: 'cm' },
    preserveProductMarkings: true,
    strictSceneComposition: true,
  });
  assert.match(prompt, /参考图1仅用于场景/);
  assert.match(prompt, /参考图2仅用于我方产品外观/);
  assert.match(prompt, /长 42厘米 × 宽 25厘米 × 高 13厘米/);
  assert.match(prompt, /删除参考图1中的全部标题/);
  assert.match(prompt, /只替换其中的竞品/);
});
