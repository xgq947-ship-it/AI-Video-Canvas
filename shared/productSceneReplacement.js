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
    '准确描述环境、构图、景别、机位、镜头透视、光线方向与软硬、色彩和材质。人物姿势与待替换产品的位置由其他字段单独描述，这里不要改写或合理化。',
    '不要描述竞品的品牌、外观、颜色、材质、结构或尺寸，把竞品所在区域理解为待替换区域。',
    '只描述真实拍摄内容。后期叠加上去的文字、贴纸、图标、水印由 overlaySpec 单独记录，场景规格里不要出现它们，也不要描述其字体或排版。',
    '输出一段紧凑的中文场景规格，不要标题、解释、Markdown。'
  ].join('\n');
}

export function buildOverlayAnalysisInstruction() {
  return [
    '只定位图片1中所有后期叠加、不属于真实拍摄现场的图层，供后续整层删除并补全其背后的画面。',
    '需要逐条列出：标题与广告文案、字幕条、促销价格贴与优惠角标、评价与销量徽标、平台水印与用户名、点赞／评论／收藏／分享等社交按钮图标及其数字、进度条、边框贴纸、箭头与表情等装饰元素。',
    '判断标准是「是否为后期加上去的图层」，不是「是否为文字」；社交按钮图标即使不含文字也必须列出。',
    '每条用画面宽高百分比给出外接框的左、上、右、下边界，并说明它遮住的真实内容（例如墙面、沙发、人物衣服），便于补全。',
    '真实拍摄现场本就存在的实物文字（产品机身标识、包装印刷、画框里的画面）不属于叠加层，不要列入。',
    '如果确实没有任何叠加图层，只输出「无」。',
    '输出一段紧凑的中文叠加层清单，不要标题、解释、Markdown。'
  ].join('\n');
}

export function buildPoseAnalysisInstruction() {
  return [
    '只分析图片1中人物的几何姿势，输出可用于像素级复刻的姿势规格。',
    '必须描述人物头部朝向与视线、躯干朝向、左右肩、肘、腕、手掌和手指的位置、弯曲角度、抓握方式，以及人物在画面中的裁切范围。',
    '重点记录两只手与原产品的接触点、遮挡前后关系；用画面宽高百分比估算关键点坐标。',
    '不得根据新产品类别设计新动作，不得把手持改成佩戴、使用、低头操作或其他姿势。',
    '输出一段紧凑的中文姿势锁定规格，不要标题、解释、Markdown。'
  ].join('\n');
}

export function buildPlacementAnalysisInstruction() {
  return [
    '只分析图片1中待替换产品区域的几何锚点。',
    '用画面宽高百分比描述其外接框左、上、右、下边界，中心点坐标、主轴角度、正面朝向、与人物躯干的距离，以及双手接触点和遮挡层级。',
    '这些坐标用于把新产品固定在原产品所在位置，禁止移到腰腹、腿部、桌面或画面其他区域。',
    '输出一段紧凑的中文位置锁定规格，不要标题、解释、Markdown。'
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

export function buildProductScenePrompt({
  sceneAnalysis,
  poseAnalysis,
  placementAnalysis,
  productAnalysis,
  overlayAnalysis,
  dimensions,
  preserveProductMarkings = true,
  strictSceneComposition = true,
  productCategory = '',
}) {
  const error = validateProductDimensions(dimensions);
  if (error) throw new Error(error);
  const unit = dimensions.unit === 'mm' ? '毫米' : '厘米';
  const overlaySpec = String(overlayAnalysis || '').trim();
  const hasOverlay = Boolean(overlaySpec) && overlaySpec !== '无';
  return [
    // 参考图1必须拆成两层来讲：实拍层要锁死、叠加层要删干净。
    // 两条要求方向相反，如果只把「锁定构图」写成最高优先级，模型会连促销文案、
    // 社交图标一起原样复刻，成图就会带上牛皮癣。
    '执行参考图1的局部编辑，不是重新设计或重新拍摄画面。参考图1分成两层：实拍层（人物、产品、环境陈设、光影）与叠加层（后期加上去的文字与贴图）。两层的处理方式完全相反，不要混为一谈。参考图2仅用于我方产品外观与身份一致性。',
    strictSceneComposition
      ? '最高优先级一（锁定实拍层几何）：参考图1中人物头部、视线、躯干、肩、肘、腕、双手、手指、抓握动作及人物裁切必须保持原坐标和原角度；产品中心点、外接框区域、主轴角度、双手接触点和遮挡层级必须保持不变。实拍层只允许修改原竞品覆盖的局部像素、其必要的接触阴影，以及叠加层清除后需要补全的区域。'
      : '最高优先级一（保持实拍层）：保持参考图1的核心环境与光影，允许为了我方产品自然摆放而小幅调整构图。',
    '最高优先级二（清除叠加层）：删除参考图1中的全部后期叠加图层——标题与广告文案、字幕条、促销价格贴、优惠角标、评价与销量徽标、平台水印与用户名、点赞／评论／收藏／分享等社交按钮图标及其数字、进度条、边框贴纸与装饰元素。被它们遮住的区域要按周围真实场景补全成干净背景。成图中不得残留任何叠加文字、数字、图标、贴纸或其残影。这一条与优先级一同等重要，不受“保持原图不变”类要求的约束。',
    hasOverlay ? `必须清除的叠加层清单：${overlaySpec}` : '',
    `场景规格：${String(sceneAnalysis || '').trim()}`,
    `人物姿势锁定：${String(poseAnalysis || '').trim()}`,
    `产品位置锁定：${String(placementAnalysis || '').trim()}`,
    `我方产品规格：${String(productAnalysis || '').trim()}`,
    productCategory
      ? `产品类别：${productCategory}。类别仅用于理解产品结构和正反面，禁止依据该类别的常见用法改变参考图1的手持姿势、人物动作、产品锚点或把产品改成佩戴状态。`
      : '产品类别未指定，严格根据参考图2中可确认的结构决定摆放方式，不虚构用途。',
    `我方产品真实尺寸：长 ${dimensions.length}${unit} × 宽 ${dimensions.width}${unit} × 高 ${dimensions.height}${unit}。以原产品中心点为固定锚点，根据真实尺寸从该锚点向外适配外轮廓；不得把产品中心移到其他身体部位，不得为了展示产品而移动人物的手。`,
    preserveProductMarkings
      ? '保留参考图2中真实存在的我方产品 Logo、机身标识和控制面板细节，不得生成竞品标识。'
      : '成图中的产品不出现 Logo、品牌字样或机身文字。',
    '最终画面无竞品、无竞品标识，也没有任何叠加文字与图标。',
    // 注意：这只影响画面的细节量与锐度，成图的像素尺寸由 Google Flow 的输出档位决定，
    // 提示词改不了。真要提分辨率得去调 Flow 的输出设置，见 buildProductScenePrompt 的调用方。
    '输出质量：按最高清晰度呈现，产品表面材质、织物纹理、机身标识、人物皮肤与发丝、环境陈设都要锐利可辨，达到商业投放可用的精细度；不得出现模糊、涂抹、噪点、过度锐化或压缩伪影，补全区域的清晰度要与画面其余部分一致。',
    '将我方产品合成在原竞品位置并置于原手指之后，沿用原抓握遮挡；透视、接触和投影与环境一致。除替换产品、清除叠加层并补全其背后画面、以及局部接触阴影外，参考图1的实拍内容均不得变化。',
    '负面约束：禁止改变人物姿势，禁止改变视线，禁止低头，禁止移动手臂或手指，禁止把产品从胸前移到腰腹，禁止佩戴产品，禁止重新构图，禁止新增肢体，禁止改变实拍背景的陈设与光影（清除叠加层后补全的区域除外），禁止保留、重绘或重新排版任何叠加文字与图标。'
  ].filter(Boolean).join('\n');
}
