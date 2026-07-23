import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCompositionAnalysisInstruction,
  buildPersonaAnalysisInstruction,
  buildProductAnalysisInstruction,
  buildProductScenePrompt,
  buildSceneAnalysisInstruction,
  inferProductSceneAspectRatio,
  validateProductDimensions,
} from '../shared/productSceneReplacement.js';

const base = {
  sceneAnalysis: '室内暖色客厅，平视机位，柔和侧光',
  personaAnalysis: '25-30 岁女性，中长发，浅灰家居服',
  compositionAnalysis: '半身入画，产品贴在腹部由双手扶住，占画面约三成',
  productAnalysis: '白色圆形揉腹仪，灰色织物绑带',
  dimensions: { length: 22.5, width: 20, height: 13.7, unit: 'cm' },
};

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

test('场景分析要求信息自足，且不描述人物、竞品与叠加层', () => {
  const instruction = buildSceneAnalysisInstruction();
  assert.match(instruction, /从零重建/);
  assert.match(instruction, /成图完全依赖你的文字/);
  assert.match(instruction, /不要描述画面里的人物/);
  assert.match(instruction, /不要描述竞品的品牌、外观/);
  assert.match(instruction, /促销贴、字幕、水印、社交按钮图标一律当作不存在|后期叠加的标题/);
});

// 这条是整套方案能否「换人」的关键：人物描述一旦带上可指认的五官细节，
// 生成结果就会收敛回原视频里那个人，等于白改。
test('人物分析只输出通用特征，明确挡掉可指认到本人的信息', () => {
  const instruction = buildPersonaAnalysisInstruction();
  assert.match(instruction, /可以换成另一个人来演/);
  assert.match(instruction, /大致年龄段、性别、体型胖瘦、发长与发型风格/);
  assert.match(instruction, /严禁描述任何能指认到具体某个人的信息/);
  assert.match(instruction, /脸型轮廓、五官形状与比例/);
  assert.match(instruction, /痣、疤痕、纹身/);
  assert.match(instruction, /就直接省略，不要勉强概括/);
});

test('构图分析按功能描述持握方式，避免照抄竞品轮廓', () => {
  const instruction = buildCompositionAnalysisInstruction();
  assert.match(instruction, /持握或摆放方式必须按「功能」描述/);
  assert.match(instruction, /不要按竞品的外形轮廓描述抓握手势/);
  assert.match(instruction, /新产品的形状可能完全不同/);
  assert.match(instruction, /不要描述人物的长相与服装/);
});

test('产品分析可独立控制是否保留我方产品标识', () => {
  assert.match(buildProductAnalysisInstruction({ preserveProductMarkings: true }), /保留并准确描述/);
  assert.match(buildProductAnalysisInstruction({ preserveProductMarkings: false }), /忽略产品上的 Logo/);
});

test('提示词是从零生成指令，不是对参考图做编辑', () => {
  const prompt = buildProductScenePrompt(base);
  assert.match(prompt, /生成一张全新的写实商业产品场景图/);
  assert.match(prompt, /这是从零创作，不是对任何图片做编辑或局部修改/);
  assert.match(prompt, /唯一的参考图是我方产品图/);
  // 旧版那套「局部编辑参考图1 + 锁定原人物坐标」的措辞必须彻底消失，
  // 只要它还在，模型就会去复刻竞品图里的人。
  assert.doesNotMatch(prompt, /参考图1/);
  assert.doesNotMatch(prompt, /局部编辑/);
  assert.doesNotMatch(prompt, /保持原坐标/);
});

test('提示词点名要求全新虚构人物且画面无任何文字', () => {
  const prompt = buildProductScenePrompt(base);
  assert.match(prompt, /人物必须是全新虚构人物/);
  assert.match(prompt, /不得与任何真实人物、公众人物、网红或已有影像素材中的人物相似/);
  assert.match(prompt, /不得出现任何文字、字幕、标题、促销贴、价格标签、水印、角标、社交按钮图标、数字或 UI 元素/);
});

test('四段识图结果与真实尺寸都写进提示词，尺寸以人体比例为参照', () => {
  const prompt = buildProductScenePrompt({ ...base, productCategory: '揉腹仪' });
  assert.match(prompt, /环境：室内暖色客厅/);
  assert.match(prompt, /人物：25-30 岁女性/);
  assert.match(prompt, /构图与姿势：半身入画/);
  assert.match(prompt, /严格按上述构图组织画面/);
  // 识图文本自带句号，拼接时不能再补一个，否则提示词里会出现「。。」
  assert.doesNotMatch(prompt, /。。/);
  assert.match(prompt, /产品：白色圆形揉腹仪/);
  assert.match(prompt, /长 22.5厘米 × 宽 20厘米 × 高 13.7厘米/);
  assert.match(prompt, /以人体比例为参照换算画面占比/);
  assert.match(prompt, /产品类别：揉腹仪/);
});

test('人物设定为空时不占行，填了则声明覆盖识图结果', () => {
  for (const personaBrief of ['', '   ', undefined]) {
    const prompt = buildProductScenePrompt({ ...base, personaBrief });
    assert.doesNotMatch(prompt, /人物设定以此为准/);
    assert.doesNotMatch(prompt, /\n\n/);
  }

  const steered = buildProductScenePrompt({ ...base, personaBrief: '30 岁左右女性，短发' });
  assert.match(steered, /人物设定以此为准（与上一条冲突时优先采用本条，未提及的部分沿用上一条）：30 岁左右女性，短发/);
});

test('尺寸非法时构建提示词直接抛错', () => {
  assert.throws(() => buildProductScenePrompt({ ...base, dimensions: { length: 0, width: 20, height: 13, unit: 'cm' } }), /长、宽、高/);
});
