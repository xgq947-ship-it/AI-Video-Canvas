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
    '你是商业产品摄影场景分析专家。分析这张竞品广告图，输出一段能让文生图模型「从零重建」同类场景的环境规格。',
    '注意：后续不会把这张图交给生图模型，成图完全依赖你的文字，因此环境信息必须自足——写清室内外、空间类型、背景陈设与材质、地面与墙面、道具、季节与时段、光线方向与软硬、色温与整体色调、机位高度与角度、景别、镜头透视与景深。',
    '不要描述画面里的人物，人物由 personaSpec 单独负责；不要描述竞品的品牌、外观、颜色、材质或结构，产品由 productSpec 负责。',
    '只描述真实拍摄内容。后期叠加的标题、促销贴、字幕、水印、社交按钮图标一律当作不存在，不要写进规格，也不要描述其字体或排版。',
    '输出一段紧凑的中文环境规格，不要标题、解释、Markdown。'
  ].join('\n');
}

// 这是整套方案的成败点：描述得越细，生成的人越会收敛回原视频里那个人。
// 所以只允许输出「换一个人也成立」的通用特征，任何能指认到具体某个人的信息都必须挡掉。
export function buildPersonaAnalysisInstruction() {
  return [
    '分析画面中出镜人物，输出一段「可以换成另一个人来演」的通用人物设定，用于生成一位全新的虚构人物。',
    '只允许描述：大致年龄段、性别、体型胖瘦、发长与发型风格、妆容浓淡风格、服装款式与颜色材质、鞋袜、以及整体气质印象。',
    '严禁描述任何能指认到具体某个人的信息：脸型轮廓、五官形状与比例、双眼皮与眼距、鼻梁与唇形、肤色深浅之外的皮肤特征、痣、疤痕、纹身、酒窝、牙齿特征、发际线细节、具体表情、以及有辨识度的首饰或配饰款式。',
    '如果某项特征你无法在不指认到本人的前提下描述，就直接省略，不要勉强概括。',
    '输出一段紧凑的中文人物设定，不要标题、解释、Markdown。'
  ].join('\n');
}

export function buildCompositionAnalysisInstruction() {
  return [
    '分析画面的构图关系，输出一段能在新场景中复刻同样镜头设计的构图规格。',
    '需要写清：人物在画面中的位置与裁切范围（半身／胸上／全身等）、人物朝向与视线方向、产品所在区域及其占画面的比例、产品与人物身体的相对位置（胸前／腹部／手边等）、以及产品与人物的前后遮挡层级。',
    '持握或摆放方式必须按「功能」描述，例如「双手在胸前捧住」「贴在腹部并用双手扶住」「放在身侧桌面上」，不要按竞品的外形轮廓描述抓握手势——新产品的形状可能完全不同，照抄轮廓会导致姿势别扭。',
    '不要描述人物的长相与服装，那些由 personaSpec 负责。',
    '输出一段紧凑的中文构图规格，不要标题、解释、Markdown。'
  ].join('\n');
}

export function buildProductAnalysisInstruction({ preserveProductMarkings = true, productCategory = '' } = {}) {
  return [
    '你是工业产品外观识别专家。只分析提供的我方产品图片，为商业场景换品生成准确的产品外观规格。',
    productCategory
      ? `用户已指定产品类别为“${productCategory}”。以该类别为准识别产品结构、正反面和自然朝向；类别只帮助理解产品本身，不要把常见佩戴或使用方式写成必须改变场景人物姿势与产品位置的要求。`
      : '未指定产品类别时，根据图片谨慎判断产品用途，不确定时不要虚构使用方式。',
    '准确描述产品类别、整体轮廓、长宽高比例、颜色、材质、表面工艺、结构、按钮、接口、纹理、边缘、正面朝向和具有识别度的细节。',
    preserveProductMarkings
      ? '保留并准确描述我方产品自身已有的 Logo、机身标识和控制面板文字；不要虚构图片中不存在的文字。'
      : '忽略产品上的 Logo、品牌字样、机身文字和控制面板文字。',
    '不要描述拍摄背景、手、人物、包装或其他陪体，只输出产品本身。',
    '输出一段紧凑的中文产品规格，不要标题、解释、Markdown。'
  ].join('\n');
}


// 生成一张全新的图，而不是编辑竞品图。竞品图完全不进生图模型，场景与人物
// 只靠这段文字重建；唯一的参考图是我方产品图，用来锁住产品外观。
// 人物因此是模型凭空造的新面孔，不会复制原视频里那个人的肖像。
export function buildProductScenePrompt({
  sceneAnalysis,
  personaAnalysis,
  compositionAnalysis,
  productAnalysis,
  personaBrief = '',
  dimensions,
  preserveProductMarkings = true,
  productCategory = '',
}) {
  const error = validateProductDimensions(dimensions);
  if (error) throw new Error(error);
  const unit = dimensions.unit === 'mm' ? '毫米' : '厘米';
  const brief = String(personaBrief || '').trim();
  return [
    '生成一张全新的写实商业产品场景图。这是从零创作，不是对任何图片做编辑或局部修改。',
    '唯一的参考图是我方产品图：画面中的产品必须与参考图完全一致，外形、比例、颜色、材质、表面工艺、结构分件和机身标识都不得改动或重新设计。除产品之外，画面其余内容全部依据下面的文字生成。',
    `环境：${String(sceneAnalysis || '').trim()}`,
    `人物：${String(personaAnalysis || '').trim()}`,
    brief ? `人物设定以此为准（与上一条冲突时优先采用本条，未提及的部分沿用上一条）：${brief}` : '',
    `构图与姿势：${String(compositionAnalysis || '').trim()}`,
    '严格按上述构图组织画面：机位、景别、人物裁切、产品在画面中的位置与占比、以及产品与人物的遮挡层级都要对齐。',
    `产品：${String(productAnalysis || '').trim()}`,
    productCategory
      ? `产品类别：${productCategory}。类别用于理解产品结构、正反面和自然朝向，据此让人物以真实、常见且安全的方式与产品互动。`
      : '产品类别未指定，严格根据参考图中可确认的结构决定摆放与互动方式，不虚构用途。',
    `产品真实尺寸：长 ${dimensions.length}${unit} × 宽 ${dimensions.width}${unit} × 高 ${dimensions.height}${unit}。以人体比例为参照换算画面占比——产品相对手掌、前臂和躯干的大小必须符合这个真实尺寸，不得为了突出产品而放大。`,
    preserveProductMarkings
      ? '保留参考图中真实存在的产品 Logo、机身标识和控制面板细节，位置与比例照旧；不得虚构参考图上没有的文字或标识。'
      : '画面中的产品不出现 Logo、品牌字样或机身文字。',
    // 这是本方案的核心诉求：人脸必须是模型新造的，不能来自任何既有素材。
    '人物必须是全新虚构人物：面部为原创，不得与任何真实人物、公众人物、网红或已有影像素材中的人物相似。',
    '画面中不得出现任何文字、字幕、标题、促销贴、价格标签、水印、角标、社交按钮图标、数字或 UI 元素，画面为纯净的商业摄影成片。',
    '产品要真实融入场景：透视与机位一致，接触面自然受力，遮挡关系合理，投影方向与软硬跟环境光一致。',
    // 注意：这只影响画面的细节量与锐度，成图的像素尺寸由 Google Flow 的输出档位决定，
    // 提示词改不了。真要提分辨率得去调 Flow 的输出设置。
    '输出质量：按最高清晰度呈现，产品表面材质、织物纹理、机身标识、人物皮肤与发丝、环境陈设都要锐利可辨，达到商业投放可用的精细度；不得出现模糊、涂抹、噪点、过度锐化或压缩伪影。',
    '负面约束：不要卡通、插画、3D 渲染或 AI 感强的塑料质感；不要多余肢体或畸形手指；不要改变产品造型；不要在画面里加任何文字与图标。'
  ].filter(Boolean).join('\n');
}
