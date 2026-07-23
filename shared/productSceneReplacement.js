const positiveNumber = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
export const PRODUCT_SCENE_ASPECT_RATIOS = Object.freeze(['16:9', '4:3', '1:1', '3:4', '9:16']);

export function inferProductSceneAspectRatio(value, fallback = '1:1') {
  if (PRODUCT_SCENE_ASPECT_RATIOS.includes(value)) return value;
  const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (!match || Number(match[2]) <= 0) return PRODUCT_SCENE_ASPECT_RATIOS.includes(fallback) ? fallback : '1:1';
  const ratio = Number(match[1]) / Number(match[2]);
  return PRODUCT_SCENE_ASPECT_RATIOS.reduce((best, candidate) => {
    const [width, height] = candidate.split(':').map(Number);
    const bestParts = best.split(':').map(Number);
    return Math.abs(ratio - width / height) < Math.abs(ratio - bestParts[0] / bestParts[1]) ? candidate : best;
  }, PRODUCT_SCENE_ASPECT_RATIOS[0]);
}

export function validateProductDimensions(dimensions) {
  if (!dimensions || !positiveNumber(dimensions.length) || !positiveNumber(dimensions.width) || !positiveNumber(dimensions.height)) {
    return '请填写完整且大于 0 的产品长、宽、高';
  }
  if (!['mm', 'cm'].includes(dimensions.unit)) return '产品尺寸单位只能是 mm 或 cm';
  return '';
}

export function buildSceneAnalysisInstruction() {
  return [
    '你是商业产品摄影场景分析专家。只分析提供的竞品场景图片，为后续把竞品替换成另一款产品提供场景规格。',
    '准确描述环境、构图、景别、机位、镜头透视、光线方向与软硬、色彩、材质、产品摆放区域、接触面、遮挡关系和阴影。',
    '不要描述竞品的品牌、外观、颜色、材质、结构或尺寸，把竞品所在区域理解为待替换区域。',
    '完全忽略并移除标题、文案、字幕、标签、水印、角标、按钮文字和其他可见文字，也不要描述其字体或排版。',
    '输出一段紧凑的中文场景规格，不要标题、解释、Markdown。'
  ].join('\n');
}

export function buildProductAnalysisInstruction({ preserveProductMarkings = true, productCategory = '' } = {}) {
  return [
    '你是工业产品外观识别专家。只分析提供的我方产品图片，为商业场景换品生成准确的产品外观规格。',
    productCategory
      ? `用户已指定产品类别为“${productCategory}”。以该类别为准，结合图片识别其正常使用方式、朝向、接触面和常见摆放姿态。`
      : '未指定产品类别时，根据图片谨慎判断产品用途，不确定时不要虚构使用方式。',
    '准确描述产品类别、整体轮廓、长宽高比例、颜色、材质、表面工艺、结构、按钮、接口、纹理、边缘、正面朝向和具有识别度的细节。',
    preserveProductMarkings
      ? '保留并准确描述我方产品自身已有的 Logo、机身标识和控制面板文字；不要虚构图片中不存在的文字。'
      : '忽略产品上的 Logo、品牌字样、机身文字和控制面板文字。',
    '不要描述拍摄背景、手、人物、包装或其他陪体，只输出产品本身。',
    '输出一段紧凑的中文产品规格，不要标题、解释、Markdown。'
  ].join('\n');
}

export function buildProductScenePrompt({
  sceneAnalysis,
  productAnalysis,
  dimensions,
  preserveProductMarkings = true,
  strictSceneComposition = true,
  productCategory = '',
}) {
  const error = validateProductDimensions(dimensions);
  if (error) throw new Error(error);
  const unit = dimensions.unit === 'mm' ? '毫米' : '厘米';
  return [
    '执行商业产品场景替换。参考图1仅用于场景、构图、机位、透视、光影和接触面的复刻；参考图2仅用于我方产品外观与身份一致性。',
    strictSceneComposition
      ? '严格保持参考图1的画幅、构图、机位、背景、光线、色调、产品摆放位置和阴影关系，只替换其中的竞品。'
      : '保持参考图1的核心环境与光影，允许为了我方产品自然摆放而小幅调整构图。',
    `场景规格：${String(sceneAnalysis || '').trim()}`,
    `我方产品规格：${String(productAnalysis || '').trim()}`,
    productCategory
      ? `产品类别：${productCategory}。按照该类别真实、常见且安全的使用方式确定产品朝向、接触面和摆放姿态。`
      : '产品类别未指定，严格根据参考图2中可确认的结构决定摆放方式，不虚构用途。',
    `我方产品真实尺寸：长 ${dimensions.length}${unit} × 宽 ${dimensions.width}${unit} × 高 ${dimensions.height}${unit}。根据场景透视、接触面和周围已知物体换算合理画面占比，产品不得被不自然放大或缩小。`,
    preserveProductMarkings
      ? '保留参考图2中真实存在的我方产品 Logo、机身标识和控制面板细节，不得生成竞品标识。'
      : '成图中的产品不出现 Logo、品牌字样或机身文字。',
    '删除参考图1中的全部标题、广告文案、字幕、标签、水印和角标；最终画面无额外文字、无竞品、无竞品标识。',
    '产品必须完整融入场景：透视正确、接触自然、遮挡合理、投影方向和软硬与环境一致，保持写实商业摄影质感。'
  ].join('\n');
}
