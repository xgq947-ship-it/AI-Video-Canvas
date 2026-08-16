/**
 * Shared contract for the canvas-native e-commerce detail remix workflow.
 *
 * The controller performs recognition first, then makes exactly one paid image
 * generation request per competitor page. That request receives the competitor
 * layout, the user's product, and (when enabled and needed) character references
 * and directly produces the final detail image.
 * Input roles are explicit ports. `parentIds` is only the graph edge list and
 * must never be used to guess whether an image is a competitor, own detail,
 * character, or product reference.
 */

export const DETAIL_REMIX_SCHEMA_VERSION = 1;
export const DETAIL_REMIX_STRICT_PARAMETER_MODE = 'STRICT_PARAMETER_MODE';
export const DETAIL_REMIX_MARKETING_MODE = 'MARKETING_MODE';
export const DETAIL_REMIX_STRICT_FACT_MIN_CONFIDENCE = 0.9;
export const DETAIL_REMIX_STRICT_PARAMETER_TAIL_PAGE_COUNT = 2;
export const DETAIL_REMIX_STRICT_PAGE_CATEGORIES = Object.freeze([
  'parameters',
  'specifications',
  'model',
  'accessories',
  'electrical',
  'packing_list',
]);

/**
 * Product detail folders are ordered. Parameter/specification content is only
 * allowed in the final two competitor pages; every earlier page is a marketing
 * page even when it contains an isolated model number or another exact fact.
 */
export function detailRemixAllowsStrictParameterMode(pageIndex = 0, pageCount = 1) {
  const total = Math.max(1, Number(pageCount) || 1);
  const index = Math.max(0, Math.min(total - 1, Number(pageIndex) || 0));
  return index >= Math.max(0, total - DETAIL_REMIX_STRICT_PARAMETER_TAIL_PAGE_COUNT);
}
// Keep the controller compact enough to fit in a typical 720p canvas. The
// form itself scrolls inside this fixed geometry, so edges and selection
// bounds remain deterministic as advanced settings expand.
export const DETAIL_REMIX_NODE_WIDTH = 460;
export const DETAIL_REMIX_NODE_HEIGHT = 620;

export const DETAIL_REMIX_INPUT_PORTS = Object.freeze([
  'competitor-detail',
  'own-detail',
  'character-reference',
  'product-reference',
  'brand-logo',
]);

export const DETAIL_REMIX_PORT_LABELS = Object.freeze({
  'competitor-detail': '竞品详情（可多张）',
  'own-detail': '我的详情（可多张）',
  'character-reference': '人物参考（可选）',
  'product-reference': '产品参考图（可多张）',
  'brand-logo': '品牌 Logo（可选）',
});

export const DETAIL_REMIX_STATUSES = Object.freeze([
  'idle',
  'ready',
  'analyzing',
  'generating-final',
  // Legacy two-stage statuses remain readable so existing project.json files
  // can still be opened and their completed results recovered.
  'generating-plates',
  'plates-ready',
  'composing',
  'completed',
  'outdated',
  'cancelled',
  'error',
]);

const normalizedRegionSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'width', 'height'],
  properties: {
    x: { type: 'number', minimum: 0, maximum: 1 },
    y: { type: 'number', minimum: 0, maximum: 1 },
    width: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
    height: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
  },
});

/**
 * Codex CLI structured-output contract for one competitor page. Every object
 * is closed and every property is required so a truncated/free-form answer is
 * rejected by Codex before it reaches the job parser.
 */
export const DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['page'],
  properties: {
    page: {
      type: 'object',
      additionalProperties: false,
      required: [
        'pageType', 'pageMode', 'strictPageCategory', 'purpose', 'reversePrompt', 'layoutSpec', 'palette', 'lighting',
        'hasPerson', 'personaSpec', 'targetProductView', 'selectedProductViewIds',
        'productInstances', 'brandSlots', 'copySlots', 'mappedSellingPoints', 'mappedFacts',
        'forbiddenCompetitorElements',
      ],
      properties: {
        pageType: { type: 'string' },
        pageMode: {
          type: 'string',
          enum: [DETAIL_REMIX_STRICT_PARAMETER_MODE, DETAIL_REMIX_MARKETING_MODE],
        },
        strictPageCategory: {
          type: 'string',
          enum: ['none', ...DETAIL_REMIX_STRICT_PAGE_CATEGORIES],
        },
        purpose: { type: 'string' },
        reversePrompt: { type: 'string' },
        layoutSpec: { type: 'string' },
        palette: { type: 'string' },
        lighting: { type: 'string' },
        hasPerson: { type: 'boolean' },
        personaSpec: { type: 'string' },
        targetProductView: {
          type: 'object',
          additionalProperties: false,
          required: ['viewAngle', 'visibleSides', 'orientation', 'perspective'],
          properties: {
            viewAngle: { type: 'string' },
            visibleSides: { type: 'array', items: { type: 'string' } },
            orientation: { type: 'string' },
            perspective: { type: 'string' },
          },
        },
        selectedProductViewIds: { type: 'array', items: { type: 'string' } },
        productInstances: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'instanceId', 'x', 'y', 'width', 'height', 'viewAngle',
              'contactSurface', 'foregroundOcclusion', 'productSheetCell',
            ],
            properties: {
              instanceId: { type: 'string' },
              ...normalizedRegionSchema.properties,
              viewAngle: { type: 'string' },
              contactSurface: { type: 'string' },
              foregroundOcclusion: { type: 'string' },
              // Which cell of the own product reference sheet this instance must
              // copy. 0 when no sheet was supplied.
              productSheetCell: { type: 'integer' },
            },
          },
        },
        brandSlots: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'slotId', 'sourceText', 'visualDescription', 'x', 'y', 'width',
              'height', 'align', 'color',
            ],
            properties: {
              slotId: { type: 'string' },
              sourceText: { type: 'string' },
              visualDescription: { type: 'string' },
              ...normalizedRegionSchema.properties,
              align: { type: 'string' },
              color: { type: 'string' },
            },
          },
        },
        copySlots: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'slotId', 'role', 'field', 'parameterPart', 'sourceText', 'x', 'y', 'width', 'height',
              'align', 'color', 'fontWeight', 'maxChars',
            ],
            properties: {
              slotId: { type: 'string' },
              role: { type: 'string' },
              field: { type: 'string' },
              parameterPart: { type: 'string', enum: ['none', 'label', 'value'] },
              sourceText: { type: 'string' },
              ...normalizedRegionSchema.properties,
              align: { type: 'string' },
              color: { type: 'string' },
              fontWeight: { type: 'integer' },
              maxChars: { type: 'integer', minimum: 0 },
            },
          },
        },
        mappedSellingPoints: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['sellingPointId', 'slotId', 'slotRole', 'replacementText'],
            properties: {
              sellingPointId: { type: 'string' },
              slotId: { type: 'string' },
              slotRole: { type: 'string' },
              replacementText: { type: 'string' },
            },
          },
        },
        mappedFacts: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['factId', 'slotId', 'slotRole', 'displayPart'],
            properties: {
              factId: { type: 'string' },
              slotId: { type: 'string' },
              slotRole: { type: 'string' },
              displayPart: { type: 'string', enum: ['label', 'value'] },
            },
          },
        },
        forbiddenCompetitorElements: { type: 'array', items: { type: 'string' } },
      },
    },
  },
});

const optionalNormalizedRegionSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'width', 'height'],
  properties: {
    x: { type: 'number', minimum: 0, maximum: 1 },
    y: { type: 'number', minimum: 0, maximum: 1 },
    width: { type: 'number', minimum: 0, maximum: 1 },
    height: { type: 'number', minimum: 0, maximum: 1 },
  },
});

/** Strict own-detail knowledge contract used by Codex structured output. */
export const DETAIL_REMIX_OWN_KNOWLEDGE_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['brandIdentity', 'productViews', 'sellingPoints', 'verifiedFacts'],
  properties: {
    brandIdentity: {
      type: 'object',
      additionalProperties: false,
      required: [
        'name', 'slogan', 'primaryColors', 'logoDescription',
        'logoSourceImageIndex', 'logoRegion',
      ],
      properties: {
        name: { type: 'string' },
        slogan: { type: 'string' },
        primaryColors: { type: 'array', items: { type: 'string' } },
        logoDescription: { type: 'string' },
        logoSourceImageIndex: { type: 'integer', minimum: -1 },
        logoRegion: optionalNormalizedRegionSchema,
      },
    },
    productViews: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'sourceImageIndex', 'cropRegion', 'viewAngle', 'visibleSides',
          'description', 'quality',
        ],
        properties: {
          sourceImageIndex: { type: 'integer', minimum: 0 },
          cropRegion: normalizedRegionSchema,
          viewAngle: { type: 'string' },
          visibleSides: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
          quality: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    sellingPoints: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id', 'title', 'description', 'evidenceSummary',
          'sourceImageIndexes', 'priority',
        ],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          evidenceSummary: { type: 'string' },
          sourceImageIndexes: { type: 'array', items: { type: 'integer', minimum: 0 } },
          priority: { type: 'number' },
        },
      },
    },
    verifiedFacts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id', 'field', 'label', 'value', 'normalizedValue', 'displayText',
          'evidenceImageIndex', 'evidenceRegion', 'confidence',
        ],
        properties: {
          id: { type: 'string' },
          field: { type: 'string' },
          label: { type: 'string' },
          value: { type: 'string' },
          normalizedValue: { type: 'string' },
          displayText: { type: 'string' },
          evidenceImageIndex: { type: 'integer', minimum: 0 },
          evidenceRegion: normalizedRegionSchema,
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
});

/**
 * 把用户手写的产品说明拆成卖点与精确参数。
 *
 * 这条路取代了「从我方详情图 OCR 出参数」：用户自己写的值不经过识图，没有
 * 读错的可能，因此这些事实标记为 declared——它们不需要、也不可能有图片证据
 * 区域。反幻觉的强度并未下降：白名单从「证据图里出现过的值」换成「说明里
 * 写过的值」，同样是逐字白名单。
 */
export const DETAIL_REMIX_PRODUCT_BRIEF_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['brandIdentity', 'sellingPoints', 'verifiedFacts'],
  properties: {
    brandIdentity: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'slogan'],
      properties: {
        name: { type: 'string' },
        slogan: { type: 'string' },
      },
    },
    sellingPoints: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'description'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
    verifiedFacts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'field', 'label', 'value'],
        properties: {
          id: { type: 'string' },
          field: { type: 'string' },
          label: { type: 'string' },
          value: { type: 'string' },
        },
      },
    },
  },
});

export function buildProductBriefInstruction() {
  return [
    '你是电商详情页的产品资料结构化助手。所给内容是商家自己写的产品说明，里面混杂着卖点和精确参数，你的任务是把它拆成两类结构化数据。',
    '严格只使用说明里已经写明的内容。禁止补充、润色、推断或发明任何说明中没有出现的功效、参数、认证、材质或比较结论——漏掉一条远好过编造一条。',
    'sellingPoints 是可以直接印在详情图上的营销文案：title 是短句主张，description 是一句补充说明。两者都必须是成品文案口吻，不要写「说明中提到」「资料显示」这类分析用语。同一个意思不要拆成多条。',
    'verifiedFacts 是精确参数：label 是参数名（如「额定功率」「电池容量」），value 是参数值连同单位（如「16W」「2500mAh」）。数字、单位、型号、正负号与大小写必须与原文逐字一致，一个字符都不能改。',
    `field 必须从这份规范字段表中选取：${DETAIL_REMIX_STRICT_FIELD_KEYS.join('、')}。都对不上时可自定义一个简短英文小写下划线命名，但不要把营销卖点塞进 verifiedFacts。`,
    '判断归属的标准：能被第三方核验的客观规格进 verifiedFacts，主观主张与使用体验进 sellingPoints。「续航 8 小时」是参数，「持久续航一整天」是卖点。',
    'brandIdentity 只填说明里明确写出的品牌名与品牌标语；没写就留空字符串，绝不猜测。',
    'id 用 sp-1、sp-2 与 fact-1、fact-2 这样的顺序编号。只输出符合 Schema 的 JSON，不要 Markdown。',
  ].join('\n');
}

export function parseProductBriefResponse(value) {
  const parsed = object(parseJsonPayload(value, '产品说明解析结果'));
  const brand = object(parsed.brandIdentity);
  const sellingPoints = array(parsed.sellingPoints).flatMap((entry, index) => {
    const item = object(entry);
    const title = text(item.title);
    const description = text(item.description);
    if (!title && !description) return [];
    return [{
      id: text(item.id) || `sp-${index + 1}`,
      title: title || description,
      description: title ? description : '',
    }];
  });
  const verifiedFacts = array(parsed.verifiedFacts).flatMap((entry, index) => {
    const item = object(entry);
    const label = text(item.label);
    const value = text(item.value);
    if (!label || !value) return [];
    const field = canonicalDetailRemixFactField(item.field, label)
      || text(item.field)
      || normalizedToken(label);
    if (!field) return [];
    return [{
      id: text(item.id) || `fact-${index + 1}`,
      field,
      factType: field,
      label,
      value,
      normalizedValue: normalizeDetailRemixFactValue(value),
      displayText: `${label}\n${value}`,
      // 声明式事实：值来自用户手写，不存在也不需要图片证据区域。
      declared: true,
      evidence: [],
      confidence: 1,
    }];
  });
  return {
    brandIdentity: { name: text(brand.name), slogan: text(brand.slogan) },
    sellingPoints,
    verifiedFacts,
  };
}

/**
 * Reads a supplied product reference and reports whether it is a labelled angle
 * grid, and what each cell shows. Hand-typed cell labels go stale the moment the
 * product changes, and a stale label makes the render prompt confidently wrong;
 * deriving them from the picture keeps the two in sync by construction.
 */
export const DETAIL_REMIX_PRODUCT_SHEET_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['isSheet', 'rows', 'columns', 'cells', 'summary'],
  properties: {
    isSheet: { type: 'boolean' },
    rows: { type: 'integer', minimum: 0 },
    columns: { type: 'integer', minimum: 0 },
    cells: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'label', 'usable', 'issue'],
        properties: {
          index: { type: 'integer', minimum: 1 },
          label: { type: 'string' },
          usable: { type: 'boolean' },
          issue: { type: 'string' },
        },
      },
    },
    summary: { type: 'string' },
  },
});

/** AI-only delivery gate. It never draws pixels; it decides whether the page is deliverable. */
export const DETAIL_REMIX_FINAL_VALIDATION_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'passed', 'copyExact', 'brandCorrect', 'productCorrect',
    'logoCorrect', 'logoPresentationCorrect', 'layoutHierarchyCorrect',
    'visualPolishCorrect', 'layoutIssues', 'productPlacementCorrect', 'parameterAlignmentCorrect',
    'unsupportedStrictFactsAbsent', 'characterIdentityCorrect', 'characterHairstyleCorrect',
    'characterOutfitCorrect', 'characterAccessoriesCorrect', 'characterIssues',
    'competitorRemoved', 'gibberishDetected', 'missingTexts', 'wrongTexts',
    'unexpectedTexts', 'summary',
  ],
  properties: {
    passed: { type: 'boolean' },
    copyExact: { type: 'boolean' },
    brandCorrect: { type: 'boolean' },
    productCorrect: { type: 'boolean' },
    logoCorrect: { type: 'boolean' },
    logoPresentationCorrect: { type: 'boolean' },
    layoutHierarchyCorrect: { type: 'boolean' },
    visualPolishCorrect: { type: 'boolean' },
    layoutIssues: { type: 'array', items: { type: 'string' } },
    productPlacementCorrect: { type: 'boolean' },
    parameterAlignmentCorrect: { type: 'boolean' },
    unsupportedStrictFactsAbsent: { type: 'boolean' },
    characterIdentityCorrect: { type: 'boolean' },
    characterHairstyleCorrect: { type: 'boolean' },
    characterOutfitCorrect: { type: 'boolean' },
    characterAccessoriesCorrect: { type: 'boolean' },
    characterIssues: { type: 'array', items: { type: 'string' } },
    competitorRemoved: { type: 'boolean' },
    gibberishDetected: { type: 'boolean' },
    missingTexts: { type: 'array', items: { type: 'string' } },
    wrongTexts: { type: 'array', items: { type: 'string' } },
    unexpectedTexts: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
});

const array = value => (Array.isArray(value) ? value : []);
const text = value => String(value ?? '').trim();
const unique = values => [...new Set(array(values).map(text).filter(Boolean))];
const object = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const normalizedToken = value => text(value)
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[\s_:/\\|()（）\[\]【】,.，。;；-]+/gu, '');

const STRICT_FIELD_ALIASES = Object.freeze([
  ['product_name', /(?:产品名称|商品名称|品名|productname|itemname)/iu],
  ['model', /(?:产品型号|商品型号|规格型号|型号|model)/iu],
  ['charging_input', /(?:充电输入|输入电压|充电电压|charginginput|inputvoltage)/iu],
  ['battery_capacity', /(?:电池容量|电池电量|batterycapacity|mah)/iu],
  ['power', /(?:额定功率|工作功率|功率|ratedpower|power)/iu],
  ['voltage', /(?:额定电压|工作电压|电压|ratedvoltage|voltage)/iu],
  ['electric_current', /(?:额定电流|工作电流|电流|ratedcurrent|current)/iu],
  ['frequency', /(?:额定频率|工作频率|频率|frequency|hz)/iu],
  ['interface', /(?:充电接口|接口类型|接口|port|interface|typec|usb)/iu],
  ['work_time', /(?:单次工作时间|工作时间|运行时间|续航时间|使用时间|runtime|worktime|workingtime)/iu],
  ['temperature', /(?:热敷温度|工作温度|温度|temperature|°c|℃)/iu],
  ['dimensions', /(?:产品尺寸|外形尺寸|包装尺寸|尺寸|规格尺寸|dimensions?|size)/iu],
  ['weight', /(?:产品重量|净重|毛重|重量|weight|kg|克重)/iu],
  ['gear', /(?:档位|挡位|模式数量|档数|gears?|levels?)/iu],
  ['package_contents', /(?:装箱清单|包装清单|包装内容|随箱清单|packinglist|packagecontents)/iu],
  ['accessories', /(?:配件清单|配件|附件|accessories)/iu],
  ['certification', /(?:执行标准|认证|证书|certification|certificate)/iu],
  ['material', /(?:主要材质|材质|面料|material)/iu],
]);

/** 规范参数字段键，供产品说明解析时约束 field 取值。 */
export const DETAIL_REMIX_STRICT_FIELD_KEYS = Object.freeze(
  STRICT_FIELD_ALIASES.map(([key]) => key),
);

/** Canonical key used to prove that a competitor slot and an own fact describe the same field. */
export function canonicalDetailRemixFactField(value, label = '') {
  const explicit = text(value);
  const labelText = text(label);
  for (const source of [explicit, labelText]) {
    if (!source) continue;
    const normalized = normalizedToken(source);
    for (const [field, matcher] of STRICT_FIELD_ALIASES) {
      if (matcher.test(source) || matcher.test(normalized)) return field;
    }
  }
  const normalized = normalizedToken(explicit || labelText);
  return normalized ? `custom:${normalized}` : '';
}

/** Normalization is only for matching/deduplication; the exact `value` remains the display source. */
export function normalizeDetailRemixFactValue(value) {
  return text(value).normalize('NFKC').replace(/\s+/gu, ' ');
}

const strictCategory = value => {
  const source = normalizedToken(value);
  if (!source || source === 'none' || source === '无') return 'none';
  if (/(?:packinglist|packagecontents|装箱|包装清单|随箱)/u.test(source)) return 'packing_list';
  if (/(?:accessor|配件|附件)/u.test(source)) return 'accessories';
  if (/(?:electric|electrical|电气|电器参数)/u.test(source)) return 'electrical';
  if (/(?:model|型号)/u.test(source)) return 'model';
  if (/(?:specification|specifications|规格)/u.test(source)) return 'specifications';
  if (/(?:parameter|parameters|参数)/u.test(source)) return 'parameters';
  return DETAIL_REMIX_STRICT_PAGE_CATEGORIES.includes(text(value)) ? text(value) : 'none';
};

/** Program-side classification; an inconsistent model answer always resolves toward the safer strict mode. */
export function detailRemixPageMode(value = {}) {
  const page = object(value);
  if (page.strictParameterModeEligible === false) return DETAIL_REMIX_MARKETING_MODE;
  const category = strictCategory(page.strictPageCategory || page.pageCategory);
  const typeText = `${text(page.pageType || page.type)} ${text(page.purpose)}`;
  const strictType = /(?:specification|specifications|parameter|parameters|model|accessor|electrical|packing[ _-]?list|参数页?|规格页?|型号页?|配件页?|电气参数页?|包装清单页?|装箱清单页?)/iu.test(typeText);
  const explicitStrict = text(page.pageMode).toUpperCase() === DETAIL_REMIX_STRICT_PARAMETER_MODE;
  const parameterSlots = array(page.copySlots).filter(slot => (
    ['label', 'value'].includes(text(slot?.parameterPart).toLowerCase())
    || /parameter(?:label|value)|specification/iu.test(text(slot?.role))
  ));
  const pairedFieldParts = new Map();
  for (const slot of parameterSlots) {
    const field = canonicalDetailRemixFactField(slot?.field, slot?.sourceText);
    if (!field) continue;
    const parts = pairedFieldParts.get(field) || new Set();
    const role = text(slot?.parameterPart || slot?.role).toLowerCase();
    if (/label/u.test(role)) parts.add('label');
    if (/value/u.test(role)) parts.add('value');
    pairedFieldParts.set(field, parts);
  }
  const hasPair = [...pairedFieldParts.values()].some(parts => parts.has('label') && parts.has('value'));
  return explicitStrict || category !== 'none' || strictType || hasPair
    ? DETAIL_REMIX_STRICT_PARAMETER_MODE
    : DETAIL_REMIX_MARKETING_MODE;
}

export function isDetailRemixStrictParameterPage(value = {}) {
  return detailRemixPageMode(value) === DETAIL_REMIX_STRICT_PARAMETER_MODE;
}

export function detailRemixStrictPageCategory(value = {}) {
  const page = object(value);
  const explicit = strictCategory(page.strictPageCategory || page.pageCategory);
  if (explicit !== 'none') return explicit;
  return strictCategory(`${text(page.pageType || page.type)} ${text(page.purpose)}`);
}

function normalizeFolderImport(value) {
  const source = object(value);
  const allowedStatuses = ['idle', 'uploading', 'completed', 'partial_failed', 'failed'];
  const total = Math.max(0, Number(source.total) || 0);
  const uploaded = Math.min(total, Math.max(0, Number(source.uploaded) || 0));
  const failed = Math.min(total, Math.max(0, Number(source.failed) || 0));
  return {
    folderName: text(source.folderName),
    status: allowedStatuses.includes(source.status) ? source.status : 'idle',
    total,
    uploaded,
    failed,
    nodeIds: unique(source.nodeIds),
    ...(text(source.startedAt) ? { startedAt: text(source.startedAt) } : {}),
    ...(text(source.completedAt) ? { completedAt: text(source.completedAt) } : {}),
  };
}

function normalizeQueueProgress(value) {
  const source = object(value);
  const progress = section => {
    const item = object(section);
    const total = Math.max(0, Number(item.total) || 0);
    return {
      status: text(item.status) || 'waiting',
      total,
      completed: Math.min(total, Math.max(0, Number(item.completed) || 0)),
      failed: Math.min(total, Math.max(0, Number(item.failed) || 0)),
      ...(Number.isInteger(Number(item.currentIndex)) ? { currentIndex: Number(item.currentIndex) } : {}),
    };
  };
  return {
    ownKnowledge: {
      ...progress(source.ownKnowledge),
      sellingPointCount: Math.max(0, Number(source.ownKnowledge?.sellingPointCount) || 0),
    },
    competitor: progress(source.competitor),
    composition: progress(source.composition),
  };
}

function normalizedCharacter(inputRefs = {}) {
  const canonical = object(inputRefs.characterReference || inputRefs.character);
  const legacyNodeIds = inputRefs.characterNodeIds;
  const nodeIds = unique(canonical.nodeIds ?? legacyNodeIds);
  const hasExplicitEnabled = typeof canonical.enabled === 'boolean'
    || typeof inputRefs.useCharacterReference === 'boolean'
    || typeof inputRefs.characterReferenceEnabled === 'boolean';
  const enabled = typeof canonical.enabled === 'boolean'
    ? canonical.enabled
    : typeof inputRefs.useCharacterReference === 'boolean'
      ? inputRefs.useCharacterReference
      : typeof inputRefs.characterReferenceEnabled === 'boolean'
        ? inputRefs.characterReferenceEnabled
        // Compatibility for the earliest drafts, where selecting a character
        // implicitly enabled it. New nodes have no IDs and therefore default off.
        : !hasExplicitEnabled && nodeIds.length > 0;
  return { enabled, nodeIds };
}

function normalizePageSnapshot(value, fallbackIndex) {
  const page = { ...object(value) };
  const plateReady = page.plateReady === true || Boolean(text(page.plateUrl || page.resultUrl));
  const compositeReady = page.compositeReady === true || Boolean(text(page.compositeUrl));
  const resultReady = page.resultReady === true || Boolean(text(
    page.finalUrl || page.resultUrl || page.compositeUrl || page.plateUrl,
  ));
  // Durable media belongs to ordinary Image nodes (top-level resultUrl) and to
  // the recoverable job. Nested URLs are intentionally removed here because
  // project asset organization/rename only knows how to rewrite top-level
  // media fields.
  for (const key of [
    'sourceImage',
    'rawResultUrl',
    'finalUrl',
    'rawPlateUrl',
    'plateUrl',
    'resultUrl',
    'compositeRawUrl',
    'compositeUrl',
  ]) delete page[key];
  return {
    ...page,
    index: Number.isInteger(Number(page.index)) ? Number(page.index) : fallbackIndex,
    resultReady,
    plateReady,
    compositeReady,
  };
}

export function normalizeDetailRemixInputRefs(value = {}) {
  const input = object(value);
  return {
    competitorDetailNodeIds: unique(input.competitorDetailNodeIds ?? input.competitorNodeIds),
    ownDetailNodeIds: unique(input.ownDetailNodeIds ?? input.ownNodeIds),
    characterReference: normalizedCharacter(input),
    productNodeIds: unique(input.productNodeIds ?? input.productReferenceNodeIds),
    brandLogoNodeIds: unique(input.brandLogoNodeIds),
  };
}

export function createDetailRemixNodeData(overrides = {}) {
  const source = object(overrides);
  const inputRefs = normalizeDetailRemixInputRefs(source.inputRefs);
  const status = DETAIL_REMIX_STATUSES.includes(source.status) ? source.status : 'idle';
  return {
    ...source,
    schemaVersion: DETAIL_REMIX_SCHEMA_VERSION,
    inputRefs,
    folderImports: {
      competitor: normalizeFolderImport(source.folderImports?.competitor),
      own: normalizeFolderImport(source.folderImports?.own),
    },
    queueProgress: normalizeQueueProgress(source.queueProgress),
    analysis: {
      ...object(source.analysis),
      ownSellingPoints: array(source.analysis?.ownSellingPoints),
      pages: array(source.analysis?.pages).map(normalizePageSnapshot),
    },
    recognitionProvider: ['gemini-web', 'codex-cli'].includes(source.recognitionProvider)
      ? source.recognitionProvider
      : 'gemini-web',
    maxStructuralRegenerations: [0, 1, 2, 3].includes(Number(source.maxStructuralRegenerations))
      ? Number(source.maxStructuralRegenerations)
      : 1,
    // 卖点与精确参数的唯一权威来源。用户直接写清楚，比从旧详情图 OCR 出来更准，
    // 也让整条链路不再必须依赖「我的详情」这组输入。
    productBrief: text(source.productBrief),
    preferSuppliedProductReferences: source.preferSuppliedProductReferences === true,
    // `productSheet` is the user's optional override; `detectedProductSheet` is
    // what the last run actually read off the picture and is display-only.
    productSheet: normalizeDetailRemixProductSheet(source.productSheet),
    detectedProductSheet: normalizeDetailRemixProductSheet(source.detectedProductSheet),
    productSheetWarnings: array(source.productSheetWarnings).map(text).filter(Boolean),
    status,
    ...(text(source.errorMessage) ? { errorMessage: text(source.errorMessage) } : {}),
  };
}

export const normalizeDetailRemixNodeData = createDetailRemixNodeData;

function orderedMappingEntries(node, mapping) {
  const parentIds = unique(node?.parentIds);
  const order = new Map(parentIds.map((id, index) => [id, index]));
  return Object.entries(object(mapping))
    .filter(([parentId, port]) => parentId && DETAIL_REMIX_INPUT_PORTS.includes(port))
    .sort(([left], [right]) => (
      (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER)
    ));
}

/** Synchronize semantic port mapping and the denormalized ordered input refs. */
export function syncDetailRemixInputRefs(node, inputPortByParentId = node?.inputPortByParentId || {}) {
  const current = createDetailRemixNodeData(node?.detailRemix || {});
  const mapping = Object.fromEntries(orderedMappingEntries(node, inputPortByParentId));
  const idsFor = port => Object.entries(mapping)
    .filter(([, value]) => value === port)
    .map(([parentId]) => parentId);
  const nextRefs = {
    competitorDetailNodeIds: idsFor('competitor-detail'),
    ownDetailNodeIds: idsFor('own-detail'),
    characterReference: {
      enabled: current.inputRefs.characterReference.enabled,
      nodeIds: idsFor('character-reference'),
    },
    productNodeIds: idsFor('product-reference'),
    brandLogoNodeIds: idsFor('brand-logo'),
  };
  const previousRefs = current.inputRefs;
  const activeCharacter = reference => ({
    enabled: reference.enabled,
    // A disabled character connection is intentionally dormant. Keep the
    // selection for the next toggle-on, but do not invalidate paid final
    // output when that dormant edge is connected, disconnected, or edited.
    nodeIds: reference.enabled ? reference.nodeIds : [],
  });
  const generationInputsChanged = JSON.stringify({
    competitor: nextRefs.competitorDetailNodeIds,
    own: nextRefs.ownDetailNodeIds,
    character: activeCharacter(nextRefs.characterReference),
    product: nextRefs.productNodeIds,
    brandLogo: nextRefs.brandLogoNodeIds,
  }) !== JSON.stringify({
    competitor: previousRefs.competitorDetailNodeIds,
    own: previousRefs.ownDetailNodeIds,
    character: activeCharacter(previousRefs.characterReference),
    product: previousRefs.productNodeIds,
    brandLogo: previousRefs.brandLogoNodeIds,
  });
  const hasRun = Boolean(current.jobId);
  const nextStatus = generationInputsChanged
    && ['ready', 'plates-ready', 'completed'].includes(current.status)
    ? 'outdated'
    : current.status;
  return {
    ...node,
    parentIds: Object.keys(mapping),
    inputPortByParentId: mapping,
    detailRemix: createDetailRemixNodeData({
      ...current,
      inputRefs: nextRefs,
      status: nextStatus,
      ...(generationInputsChanged && hasRun ? { needsRegeneration: true } : {}),
      ...(generationInputsChanged ? { compositionNeedsRegeneration: false } : {}),
    }),
  };
}

export function assignDetailRemixInputPort(node, parent, requestedPort) {
  if (!node || node.type !== 'Detail Page Remix' || !parent?.id) return node;
  const port = DETAIL_REMIX_INPUT_PORTS.includes(requestedPort)
    ? requestedPort
    : 'competitor-detail';
  const mapping = { ...object(node.inputPortByParentId), [parent.id]: port };
  const next = {
    ...node,
    parentIds: unique([...(node.parentIds || []), parent.id]),
  };
  return syncDetailRemixInputRefs(next, mapping);
}

export function buildDetailRemixInputMapping(inputRefs = {}) {
  const refs = normalizeDetailRemixInputRefs(inputRefs);
  return Object.fromEntries([
    ...refs.competitorDetailNodeIds.map(id => [id, 'competitor-detail']),
    ...refs.ownDetailNodeIds.map(id => [id, 'own-detail']),
    ...refs.characterReference.nodeIds.map(id => [id, 'character-reference']),
    ...refs.productNodeIds.map(id => [id, 'product-reference']),
    ...refs.brandLogoNodeIds.map(id => [id, 'brand-logo']),
  ]);
}

export function activeDetailRemixInputRefs(value = {}) {
  const refs = normalizeDetailRemixInputRefs(value?.inputRefs || value);
  return {
    ...refs,
    characterReference: {
      ...refs.characterReference,
      activeNodeIds: refs.characterReference.enabled ? refs.characterReference.nodeIds : [],
    },
  };
}

export function detailRemixInputFingerprint(value = {}) {
  const refs = activeDetailRemixInputRefs(value);
  return JSON.stringify({
    competitorDetailNodeIds: refs.competitorDetailNodeIds,
    ownDetailNodeIds: refs.ownDetailNodeIds,
    characterReferenceEnabled: refs.characterReference.enabled,
    characterReferenceNodeIds: refs.characterReference.activeNodeIds,
    productNodeIds: refs.productNodeIds,
    brandLogoNodeIds: refs.brandLogoNodeIds,
  });
}

const nodeImageUrl = node => text(node?.resultUrl || node?.editorBackgroundUrl);
const isUsableImageNode = node => (
  ['Image', 'Image Editor'].includes(node?.type)
  && nodeImageUrl(node)
  && !node?.detailRemixSourceJobId
);

export function validateDetailRemixPreflight(value, nodes, options = {}) {
  const state = createDetailRemixNodeData(value);
  const byId = new Map(array(nodes).map(node => [node.id, node]));
  const valid = ids => ids.filter(id => isUsableImageNode(byId.get(id)));
  const competitor = valid(state.inputRefs.competitorDetailNodeIds);
  const own = valid(state.inputRefs.ownDetailNodeIds);
  const character = valid(state.inputRefs.characterReference.nodeIds);
  const product = valid(state.inputRefs.productNodeIds);
  // Compatibility for an already-created legacy two-stage job. New executions
  // use the default/final branch below and require every active input up front.
  if (options.phase === 'composition') {
    if (!product.length) return { ok: false, error: '产品合成前请至少选择一张我的产品图' };
    return {
      ok: true,
      refs: {
        competitorDetailNodeIds: competitor,
        ownDetailNodeIds: own,
        characterNodeIds: [],
        productNodeIds: product,
      },
    };
  }
  if (!competitor.length) return { ok: false, error: '请至少提供一张竞品详情图' };
  // 卖点与参数现在有两条来源：产品说明文本（更准，用户直接写），或从旧的
  // 「我的详情」识别。两者至少要有一条，不再强制必须导入我方详情图。
  const brief = text(state.productBrief);
  if (!brief && !own.length) {
    return { ok: false, error: '请填写产品说明（卖点与参数），或连接至少一张我的详情图' };
  }
  // 产品长什么样只能靠图。没有产品参考图时才回退到从我方详情自动裁角度。
  if (!product.length && !own.length) {
    return { ok: false, error: '请至少提供一张产品参考图' };
  }
  if (state.inputRefs.characterReference.enabled && !character.length) {
    return { ok: false, error: '已开启人物参考，请选择一张有效人物参考图' };
  }
  return {
    ok: true,
    refs: {
      competitorDetailNodeIds: competitor,
      ownDetailNodeIds: own,
      characterNodeIds: state.inputRefs.characterReference.enabled ? character : [],
      productNodeIds: product,
      brandLogoNodeIds: valid(state.inputRefs.brandLogoNodeIds || []),
    },
  };
}

/** Mark only final generation output stale; analysis snapshots remain inspectable. */
export function markDetailRemixDependentsStale(nodes, changedNodeId) {
  if (!changedNodeId) return nodes;
  let changed = false;
  const next = array(nodes).map(node => {
    if (node?.type !== 'Detail Page Remix') return node;
    const state = createDetailRemixNodeData(node.detailRemix || {});
    const refs = state.inputRefs;
    const generationDependsOnChanged = [
      ...refs.competitorDetailNodeIds,
      ...refs.ownDetailNodeIds,
      ...(refs.characterReference.enabled ? refs.characterReference.nodeIds : []),
      ...refs.productNodeIds,
      ...refs.brandLogoNodeIds,
    ].includes(changedNodeId);
    if (!generationDependsOnChanged) return node;
    changed = true;
    const running = ['analyzing', 'generating-final', 'generating-plates', 'composing'].includes(state.status);
    return {
      ...node,
      detailRemix: createDetailRemixNodeData({
        ...state,
        status: running ? state.status : 'outdated',
        needsRegeneration: true,
        compositionNeedsRegeneration: false,
      }),
    };
  });
  return changed ? next : nodes;
}

function parseJsonPayload(value, label) {
  if (value && typeof value === 'object') return value;
  const source = text(value).replace(/^\uFEFF/u, '');
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || source;
  const objectStart = fenced.indexOf('{');
  const arrayStart = fenced.indexOf('[');
  const start = objectStart < 0 ? arrayStart : arrayStart < 0 ? objectStart : Math.min(objectStart, arrayStart);
  const end = Math.max(fenced.lastIndexOf('}'), fenced.lastIndexOf(']'));
  if (start < 0 || end <= start) {
    const invalid = new Error(`${label}不是有效 JSON`);
    invalid.code = 'DETAIL_REMIX_JSON_FORMAT';
    throw invalid;
  }
  const payload = fenced.slice(start, end + 1);
  const candidates = [
    payload,
    // This is intentionally conservative: removing a comma immediately
    // before a closing token cannot change field meaning. Never guess missing
    // commas/quotes because a guessed analysis could alter paid generation.
    payload.replace(/,\s*([}\]])/g, '$1'),
  ];
  let lastError;
  for (const candidate of [...new Set(candidates)]) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  const invalid = new Error(`${label} JSON 解析失败：${lastError?.message || '未知格式错误'}`);
  invalid.code = 'DETAIL_REMIX_JSON_FORMAT';
  throw invalid;
}

export function parseOwnSellingPointsResponse(value) {
  const parsed = parseJsonPayload(value, '我方卖点提炼结果');
  const points = array(parsed?.ownSellingPoints ?? parsed?.sellingPoints ?? parsed?.points ?? parsed);
  const verifiedFacts = array(
    parsed?.verifiedFacts || parsed?.productFacts || parsed?.specifications || parsed?.facts,
  ).map((fact, index) => {
    const item = object(fact);
    const label = text(item.label || item.name || item.key);
    const exactValue = text(item.value || item.exactValue);
    const field = canonicalDetailRemixFactField(item.field || item.factType || item.type, label);
    const evidenceImageIndex = Number(item.evidenceImageIndex ?? item.sourceImageIndex ?? item.sourceImageIndexes?.[0]);
    const evidenceRegion = object(item.evidenceRegion || item.sourceRegion || item.region || item.boundingBox);
    return {
      ...item,
      id: text(item.id) || `fact-${index + 1}`,
      field,
      factType: field,
      label,
      value: exactValue,
      normalizedValue: normalizeDetailRemixFactValue(item.normalizedValue || exactValue),
      displayText: text(item.displayText) || [label, exactValue].filter(Boolean).join('\n'),
      ...(Number.isInteger(evidenceImageIndex) ? { evidenceImageIndex } : {}),
      ...(Object.keys(evidenceRegion).length ? { evidenceRegion } : {}),
    };
  }).filter(fact => fact.field && fact.label && fact.value);
  return {
    ...object(parsed),
    brandIdentity: object(parsed?.brandIdentity || parsed?.brand),
    productViews: array(parsed?.productViews || parsed?.productAngles || parsed?.productCrops),
    verifiedFacts,
    sellingPoints: points.map((point, index) => {
      if (typeof point === 'string') return { id: `sp-${index + 1}`, title: text(point), description: '' };
      const item = object(point);
      return {
        ...item,
        id: text(item.id) || `sp-${index + 1}`,
        title: text(item.title || item.headline || item.claim || item.text),
        description: text(item.description || item.supportCopy || item.evidence),
        sourceImageIndexes: array(item.sourceImageIndexes).map(Number).filter(Number.isFinite),
      };
    }).filter(point => point.title || point.description),
  };
}

export function parseCompetitorPageResponse(value) {
  const parsed = parseJsonPayload(value, '竞品详情反推结果');
  const page = object(parsed.page || parsed.analysis || parsed);
  const productInstances = array(page.productInstances || page.productRegions);
  const productRegion = object(page.productRegion || page.blankProductRegion || productInstances[0]);
  const copySlots = array(page.copySlots).map((slot, index) => {
    const item = object(slot);
    const role = text(item.role) || 'copy';
    const explicitPart = text(item.parameterPart).toLowerCase();
    const inferredPart = /label/iu.test(role) ? 'label' : /value/iu.test(role) ? 'value' : 'none';
    const parameterPart = ['label', 'value'].includes(explicitPart) ? explicitPart : inferredPart;
    return {
      ...item,
      slotId: text(item.slotId || item.id) || `copy-${index + 1}`,
      role,
      field: parameterPart === 'none'
        ? text(item.field)
        : canonicalDetailRemixFactField(item.field, item.sourceText),
      parameterPart,
    };
  });
  const normalizedPage = {
    ...page,
    copySlots,
  };
  const pageMode = detailRemixPageMode(normalizedPage);
  return {
    ...object(parsed),
    page: {
      ...normalizedPage,
      hasPerson: page.hasPerson === true,
      pageType: text(page.pageType || page.type) || 'marketing',
      pageMode,
      strictPageCategory: pageMode === DETAIL_REMIX_STRICT_PARAMETER_MODE
        ? detailRemixStrictPageCategory(normalizedPage)
        : 'none',
      // Preserve the model's raw marketing mappings here. The server applies
      // the page-order lock before deciding whether strict mode may discard
      // them; dropping them in this generic parser made an early marketing
      // page unrecoverable when the model mislabeled it as a model/spec page.
      mappedSellingPoints: array(page.mappedSellingPoints || page.sellingPointMapping),
      mappedFacts: array(page.mappedFacts || page.factMapping),
      copySlots,
      brandSlots: array(page.brandSlots || page.logoSlots),
      productRegion,
      productInstances: productInstances.length ? productInstances : (Object.keys(productRegion).length ? [productRegion] : []),
      selectedProductViewIds: array(page.selectedProductViewIds || page.productViewIds).map(text).filter(Boolean),
    },
  };
}

export function buildOwnSellingPointsInstruction({ imageCount = 1, chunkIndex = 0, chunkCount = 1 } = {}) {
  return [
    '你是电商详情页事实核验与卖点提炼专家。所附图片全部是“我方商品详情”，不是竞品。',
    `本批共 ${imageCount} 张图片（第 ${chunkIndex + 1}/${chunkCount} 批）。`,
    '只允许提炼图片中明确可见或文字明确陈述的卖点；禁止编造功效、参数、认证、材质、适用人群或比较性结论。',
    'sellingPoints.title 与 sellingPoints.description 必须是可以直接印在最终详情图上的精炼成品文案，禁止写“图片显示”“图片明确标注”“文案提到”“证据表明”等分析口吻。证据说明只能写入 evidenceSummary，绝不能混入展示文案。',
    '合并重复卖点，每条保留可追溯的 sourceImageIndexes；模糊或缺乏证据的内容不要输出。',
    '同时把图片中清晰、完整、可作为生图参考的我方产品逐个识别为 productViews。每个视角记录所在图片、产品紧致裁剪区域、角度和可见面；排除严重遮挡、过小、模糊或仅有包装的画面。',
    'productViews.cropRegion 使用 0~1 归一化 x/y/width/height，只框产品主体并保留少量完整边缘，不要包含大段详情文案。相同图片中若有多个独立角度，可输出多条。',
    '同时识别我方品牌信息：品牌名、口号、主色，以及 Logo 在哪张图、哪个归一化区域。只有清晰可见时才填写，禁止猜测。',
    '另外建立 verifiedFacts 精确事实库。产品名称、型号、额定功率、电压、充电输入、接口、工作时间、温度、尺寸、重量、容量、档位、配件、装箱清单、认证、材质等必须逐字抄录原图；field 使用稳定语义字段，label 与 value 分开，normalizedValue 只做全半角和空格归一化，displayText 使用“label + 换行 + value”。',
    `verifiedFacts 只能收录清晰可辨、置信度不低于 ${DETAIL_REMIX_STRICT_FACT_MIN_CONFIDENCE}，并且能由 evidenceImageIndex/evidenceRegion 精确回看核验的事实。evidenceRegion 必须紧密框住该条参数证据，宽高都必须大于 0。数字、单位、型号、正负号、斜杠和大小写必须与原图一致；看不清、区域不明确或置信度不足就不要输出，绝不补全或推测。`,
    '营销卖点不得进入 verifiedFacts；严格参数也不得只凭营销文案、产品外观或常识推断。',
    '只输出合法 JSON，不要 Markdown。格式：',
    '{"brandIdentity":{"name":"","slogan":"","primaryColors":[],"logoDescription":"","logoSourceImageIndex":0,"logoRegion":{"x":0.05,"y":0.03,"width":0.2,"height":0.08}},"productViews":[{"sourceImageIndex":0,"cropRegion":{"x":0.2,"y":0.15,"width":0.6,"height":0.65},"viewAngle":"front-left","visibleSides":["front","left"],"description":"左前方约30度，产品完整清晰","quality":0.95}],"sellingPoints":[{"id":"sp-1","title":"短标题","description":"可直接上图的简短说明","evidenceSummary":"来源图片中可核验的依据","sourceImageIndexes":[0],"priority":1}],"verifiedFacts":[{"id":"fact-1","field":"power","label":"额定功率","value":"16W","normalizedValue":"16W","displayText":"额定功率\\n16W","evidenceImageIndex":0,"evidenceRegion":{"x":0.1,"y":0.55,"width":0.35,"height":0.1},"confidence":0.99}]}',
  ].join('\n');
}

export const MAX_DETAIL_REMIX_PRODUCT_SHEET_CELLS = 12;

/**
 * A hand-built contact sheet of the user's own product: one reference image
 * carrying many angles in a labelled grid. Providers cap reference images (five
 * on the ChatGPT image editor), so a sheet is the only way to give the model
 * every angle a multi-instance page needs without losing the layout, logo,
 * evidence and character slots.
 */
export function normalizeDetailRemixProductSheet(value) {
  const source = object(value);
  if (!array(source.cells).length) return null;
  const cells = array(source.cells)
    .map((entry, index) => {
      const cell = object(entry);
      const cellIndex = Number(cell.index ?? cell.cell ?? index + 1);
      return {
        index: Number.isInteger(cellIndex) && cellIndex > 0 ? cellIndex : index + 1,
        label: text(cell.label || cell.name || cell.description),
      };
    })
    .filter(cell => cell.label)
    .slice(0, MAX_DETAIL_REMIX_PRODUCT_SHEET_CELLS);
  if (!cells.length) return null;
  const seen = new Set();
  const unique = cells.filter(cell => {
    if (seen.has(cell.index)) return false;
    seen.add(cell.index);
    return true;
  }).sort((left, right) => left.index - right.index);
  // Guard the fallback before clamping: Math.max(1, …) is always truthy, so a
  // `|| default` after it can never fire and every sheet would be described as
  // a single row of one column no matter how it is actually laid out.
  const declaredColumns = Number(source.columns);
  const columns = Number.isFinite(declaredColumns) && declaredColumns > 0
    ? Math.floor(declaredColumns)
    : Math.min(3, unique.length);
  const declaredRows = Number(source.rows);
  const rows = Number.isFinite(declaredRows) && declaredRows > 0
    ? Math.floor(declaredRows)
    : Math.ceil(unique.length / columns);
  return { rows, columns, cells: unique };
}

export function buildProductSheetInstruction() {
  return [
    '你是电商产品参考图审阅员。所附只有一张图，它是我方自己的产品参考，不是竞品，也不是详情页版式。',
    '判断这张图是不是「产品角度板」：把同一台产品的多个角度按规则网格拼在一起、每格一个角度的索引图。',
    '只有确实呈现规则网格且每格是同一台产品的不同角度时，isSheet 才为 true。单张产品照、场景图、多个不同产品的合集、详情页截图一律 isSheet=false，此时 rows、columns 填 0，cells 留空。',
    'isSheet=true 时给出 rows 与 columns，并按从左到右、从上到下从 1 开始为每格编号。编号必须连续覆盖所有格子。',
    'label 写这一格拍的是什么，用简短中文名词短语，例如「正面整机」「左前 3/4」「背面」「内部机芯结构」「按键面板特写」「卡扣与材质特写」。只描述看得见的内容，不要编造用途、功效或参数。',
    '若某格模糊、过暗、被裁切、被遮挡或看不出角度，usable 填 false 并在 issue 里写明原因；其余情况 usable=true、issue 留空。',
    '不要输出图上的任何文字内容，也不要把格子里的编号数字当成产品标识。',
    '只输出符合 Schema 的 JSON，不要 Markdown。',
  ].join('\n');
}

export function parseProductSheetResponse(value) {
  const parsed = object(parseJsonPayload(value, '产品角度板识别结果'));
  const cells = array(parsed.cells).map((entry, index) => {
    const cell = object(entry);
    const cellIndex = Number(cell.index);
    return {
      index: Number.isInteger(cellIndex) && cellIndex > 0 ? cellIndex : index + 1,
      label: text(cell.label),
      usable: cell.usable !== false,
      issue: text(cell.issue),
    };
  });
  return {
    isSheet: parsed.isSheet === true,
    rows: Math.max(0, Number(parsed.rows) || 0),
    columns: Math.max(0, Number(parsed.columns) || 0),
    cells,
    summary: text(parsed.summary),
  };
}

/**
 * Turns a raw detection into a usable manifest, or null when the picture is not
 * actually a grid. Returning null is the point: the render prompt must never
 * announce cells that a plain product photo does not have.
 */
export function productSheetFromDetection(detection) {
  const report = object(detection);
  if (report.isSheet !== true) return null;
  const usable = array(report.cells).filter(cell => object(cell).usable !== false);
  return normalizeDetailRemixProductSheet({
    rows: report.rows,
    columns: report.columns,
    cells: usable,
  });
}

/** Human-readable grid description handed to both the planner and the renderer. */
export function describeDetailRemixProductSheet(sheet, referenceLabel = '该产品参考板') {
  const normalized = normalizeDetailRemixProductSheet(sheet);
  if (!normalized) return '';
  const cells = normalized.cells.map(cell => `${cell.index}=${cell.label}`).join('、');
  return `${referenceLabel}是同一台我方产品的 ${normalized.rows} 行 × ${normalized.columns} 列角度板，按从左到右、从上到下编号：${cells}。板上的编号数字与分格线只是索引，绝不能画进详情页。`;
}

export function buildCompetitorPageInstruction({
  ownSellingPoints = [],
  ownVerifiedFacts = [],
  ownBrandIdentity = {},
  ownProductViews = [],
  ownProductSheet = null,
  pageIndex = 0,
  pageCount = 1,
} = {}) {
  const productSheet = normalizeDetailRemixProductSheet(ownProductSheet);
  const clip = (value, maximum) => [...text(value)].slice(0, maximum).join('');
  const brand = {
    name: clip(ownBrandIdentity?.name, 40),
    slogan: clip(ownBrandIdentity?.slogan, 80),
    primaryColors: array(ownBrandIdentity?.primaryColors).map(value => clip(value, 30)).slice(0, 6),
    logoDescription: clip(ownBrandIdentity?.logoDescription, 120),
  };
  const sellingPoints = array(ownSellingPoints).map((point, index) => ({
    id: clip(point?.id || `sp-${index + 1}`, 40),
    title: clip(point?.title || point?.headline || point?.text, 60),
    description: clip(point?.description || point?.supportCopy, 120),
  })).filter(point => point.title || point.description);
  const productViews = array(ownProductViews).map((view, index) => ({
    id: clip(view?.id || `pv-${index + 1}`, 40),
    viewAngle: clip(view?.viewAngle, 60),
    visibleSides: array(view?.visibleSides).map(value => clip(value, 40)).slice(0, 6),
    description: clip(view?.description, 100),
  })).filter(view => view.id);
  const verifiedFacts = array(ownVerifiedFacts).map((fact, index) => ({
    id: clip(fact?.id || `fact-${index + 1}`, 40),
    field: clip(fact?.field || fact?.factType, 80),
    label: clip(fact?.label, 60),
    value: clip(fact?.value, 120),
    normalizedValue: clip(fact?.normalizedValue || fact?.value, 120),
    displayText: clip(fact?.displayText || [fact?.label, fact?.value].filter(Boolean).join('\n'), 180),
  })).filter(fact => fact.field && fact.label && fact.value);
  const totalPages = Math.max(1, Number(pageCount) || 1);
  const strictParameterModeEligible = detailRemixAllowsStrictParameterMode(pageIndex, totalPages);
  const firstTailPage = Math.max(1, totalPages - DETAIL_REMIX_STRICT_PARAMETER_TAIL_PAGE_COUNT + 1);
  const responseExample = strictParameterModeEligible
    ? `{"page":{"pageType":"specification","pageMode":"${DETAIL_REMIX_STRICT_PARAMETER_MODE}","strictPageCategory":"electrical","purpose":"","reversePrompt":"","layoutSpec":"","palette":"","lighting":"","hasPerson":false,"personaSpec":"","targetProductView":{"viewAngle":"front-left","visibleSides":["front","left"],"orientation":"upright","perspective":"three-quarter"},"selectedProductViewIds":["pv-1"],"productInstances":[{"instanceId":"product-1","x":0.5,"y":0.5,"width":0.3,"height":0.3,"viewAngle":"front-left","contactSurface":"","foregroundOcclusion":"","productSheetCell":0}],"brandSlots":[{"slotId":"brand-1","sourceText":"竞品品牌","visualDescription":"左上角白色品牌标识","x":0.05,"y":0.03,"width":0.2,"height":0.08,"align":"left","color":"#ffffff"}],"copySlots":[{"slotId":"power-label","role":"parameterLabel","field":"power","parameterPart":"label","sourceText":"额定功率","x":0.1,"y":0.08,"width":0.35,"height":0.06,"align":"left","color":"#ffffff","fontWeight":500,"maxChars":8},{"slotId":"power-value","role":"parameterValue","field":"power","parameterPart":"value","sourceText":"20W","x":0.5,"y":0.08,"width":0.2,"height":0.06,"align":"right","color":"#ffffff","fontWeight":500,"maxChars":8}],"mappedSellingPoints":[],"mappedFacts":[{"factId":"fact-1","slotId":"power-label","slotRole":"parameterLabel","displayPart":"label"},{"factId":"fact-1","slotId":"power-value","slotRole":"parameterValue","displayPart":"value"}],"forbiddenCompetitorElements":[]}}`
    : `{"page":{"pageType":"marketing","pageMode":"${DETAIL_REMIX_MARKETING_MODE}","strictPageCategory":"none","purpose":"","reversePrompt":"","layoutSpec":"","palette":"","lighting":"","hasPerson":false,"personaSpec":"","targetProductView":{"viewAngle":"front-left","visibleSides":["front","left"],"orientation":"upright","perspective":"three-quarter"},"selectedProductViewIds":["pv-1"],"productInstances":[{"instanceId":"product-1","x":0.5,"y":0.5,"width":0.3,"height":0.3,"viewAngle":"front-left","contactSurface":"","foregroundOcclusion":"","productSheetCell":0}],"brandSlots":[],"copySlots":[{"slotId":"headline-1","role":"headline","field":"","parameterPart":"none","sourceText":"竞品主标题","x":0.1,"y":0.08,"width":0.8,"height":0.08,"align":"center","color":"#ffffff","fontWeight":700,"maxChars":10}],"mappedSellingPoints":[{"sellingPointId":"sp-1","slotId":"headline-1","slotRole":"headline","replacementText":"我方真实卖点"}],"mappedFacts":[],"forbiddenCompetitorElements":[]}}`;
  return [
    '你是电商详情页视觉反推与语义槽位规划专家。所附仅一张“竞品详情图”。',
    '反推画面结构、镜头、背景、光线、色彩、人物需求、文字层级、商品区域及前后遮挡关系；完整保留版式位置关系，但不要保留竞品品牌、Logo、商品外观或竞品独有主张。',
    '逐个识别画面里所有竞品产品实例并输出 productInstances；每个实例使用 0~1 归一化 x/y/width/height，并说明观察角度、接触面与需要保留在商品前方的遮挡层。只有单个实例时仍必须输出一项。',
    '识别竞品品牌/Logo 原本占据的位置并输出 brandSlots，记录 sourceText 或 visualDescription，尤其写清原槽位的底色、容器形状、留白、对齐和呈现方式（独立标牌、角标、产品压印等）；后续只替换品牌身份，必须保留该槽位原有的视觉容器。',
    `当前文件夹共 ${totalPages} 张竞品详情，本页是第 ${pageIndex + 1} 张。业务硬规则：只有最后两张（第 ${firstTailPage} 至 ${totalPages} 张）有资格判断参数模式；此前页面一律填 ${DETAIL_REMIX_MARKETING_MODE} 且 strictPageCategory=none，即使出现型号、功率、温度、数字或对比表也不能把整页判成参数页。`,
    strictParameterModeEligible
      ? `本页位于最后两张候选范围内。只有画面主体确实是参数表、规格表、型号表、配件/装箱清单或电气参数表时才填 ${DETAIL_REMIX_STRICT_PARAMETER_MODE}；孤立型号或少量数字仍按 ${DETAIL_REMIX_MARKETING_MODE}。`
      : `本页已被程序锁定为 ${DETAIL_REMIX_MARKETING_MODE}。精确数字或型号只能作为单独的 mappedFacts 严格事实槽处理，不得改变整页模式。`,
    `允许进入参数模式时，strictPageCategory 使用 parameters/specifications/model/accessories/electrical/packing_list；普通卖点、场景和品牌页填 ${DETAIL_REMIX_MARKETING_MODE} 且 strictPageCategory=none。pageType 保留 marketing/scene/brand/specification 等简短类型。`,
    '逐个识别竞品原有可读文案并输出 copySlots；每个槽必须包含 slotId、role、field、parameterPart、sourceText、位置、对齐、颜色和字重。普通文案 field 为空且 parameterPart=none。',
    `当 pageMode=${DETAIL_REMIX_STRICT_PARAMETER_MODE} 时，参数名称和参数值必须拆成两个独立 copySlot：名称槽 parameterPart=label，数值槽 parameterPart=value，并填写同一个规范 field。禁止把“额定功率 20W”作为单个替换单元；即使视觉上相邻，也必须分别给出两个紧密区域。`,
    '严格参数模式只能把参数槽映射到 verifiedFacts 的事实 ID，写入 mappedFacts；禁止输出 mappedSellingPoints。displayPart 只允许 label 或 value，并且必须与目标 slot 的 parameterPart 一致；同一事实只有 label/value 两个位置都可靠识别并且 field 一致时才映射。没有我方事实证据的竞品参数槽不映射，后续会彻底删除。',
    `当 pageMode=${DETAIL_REMIX_MARKETING_MODE} 时，把营销文案槽映射到 mappedSellingPoints；只能选择已给卖点，不得新造参数或功效，也不得新造比较结论。页面中若混有精确数字/型号，只能通过 mappedFacts 使用我方证据，绝不能用营销卖点覆盖。`,
    '营销页中承担版式层级的所有可读槽都必须逐槽映射：包括胶囊标签/眉题、主标题及其拆分片段、副标题、功能标题、说明正文。若 competitorTrademark 实际占据主标题的一部分，也按主标题槽替换，不能删掉后破坏标题层级。只有水印、页码、法务脚注、免责声明、纯表头/对照栏目名，以及已由 brandSlots 单独承接的孤立品牌字样可以不映射并删除。',
    'mappedSellingPoints 中同一 slotId 恰好一项，每项都必须填写 replacementText。replacementText 必须是所选我方卖点 title/description 的忠实短写，适配该槽 maxChars，不得添加证据外功效；相邻的拆分标题允许选择同一卖点但要写成不同且连贯的片段。不同槽禁止机械重复同一句话。最终要保持原页“眉题/胶囊标签—大标题—副标题/说明”的数量、字号层级和留白节奏。',
    productViews.length
      ? '判断所有竞品产品实例的观察角度、朝向、可见面和透视要求，再从我方产品视角库中选择最匹配的 1~3 个 ID 写入 selectedProductViewIds。必须只选给定 ID；优先覆盖本页出现的不同角度和产品完整度。'
      : '本次没有我方产品视角库：产品外观全部来自商家直接提供的参考图。selectedProductViewIds 留空数组，不要编造任何 ID。仍然要照常判断并输出每个竞品产品实例的位置、观察角度、接触面与遮挡关系。',
    productSheet
      // Enumerate the legal cells instead of giving a range: unusable cells are
      // already dropped from the manifest, and a range would invite the planner
      // to assign one of them, leaving that instance with no binding at all.
      ? `${describeDetailRemixProductSheet(productSheet, '我方已提供一张产品角度板，生成时它就是产品参考图')}为每个 productInstance 判断它最该照抄哪一格，把该格编号写入 productSheetCell。只能使用这些编号：${productSheet.cells.map(cell => cell.index).join('、')}；其它编号一律无效。同一格可以被多个实例引用；实在无法判断时填最接近整机角度的那一格，不要填 0。`
      : '本次没有产品角度板，所有 productInstance 的 productSheetCell 一律填 0。',
    `页面序号：${pageIndex + 1}/${totalPages}。我方品牌：${JSON.stringify(brand)}。我方卖点库：${JSON.stringify(sellingPoints)}。我方精确事实库：${JSON.stringify(verifiedFacts)}。我方产品视角库：${JSON.stringify(productViews)}`,
    '只输出合法 JSON，不要 Markdown。格式：',
    responseExample,
    '营销映射项格式：{"sellingPointId":"sp-1","slotId":"headline-1","slotRole":"headline","replacementText":"仿人手深层揉捏"}',
  ].filter(Boolean).join('\n');
}

const displayCopy = value => text(value)
  .replace(/^(?:图片(?:中)?(?:明确)?(?:显示|标注|写明|说明)|页面(?:中)?(?:明确)?(?:显示|标注|写明|说明)|文案(?:中)?(?:明确)?(?:提到|写明|显示|说明)|证据(?:显示|表明)|可见文案证据)\s*[：:，,]?\s*/u, '')
  .trim();

const REMOVABLE_MARKETING_COPY_ROLE = /(?:watermark|page.?number|copyright|legal|disclaimer|fine.?print|footnote|table.?header|column.?label|comparison.?label|legend|navigation|二维码|水印|页码|版权|法务|免责声明|脚注|表头|栏目名|对照标签)/iu;

/** Marketing copy that visually carries the page hierarchy must never vanish. */
export function isDetailRemixMarketingLayoutSlot(value) {
  const slot = object(value);
  const role = text(slot.role);
  const sourceText = text(slot.sourceText || slot.originalText || slot.text);
  const parameterPart = text(slot.parameterPart).toLowerCase();
  if (!sourceText || ['label', 'value'].includes(parameterPart)) return false;
  return !REMOVABLE_MARKETING_COPY_ROLE.test(`${role} ${sourceText}`);
}

const safeNormalizedRegion = value => {
  const source = object(value);
  const region = {
    x: Number(source.x),
    y: Number(source.y),
    width: Number(source.width),
    height: Number(source.height),
  };
  return Object.values(region).every(Number.isFinite)
    && region.x >= 0 && region.y >= 0
    && region.width > 0 && region.height > 0
    ? region
    : null;
};

const strictFactEvidence = value => {
  const fact = object(value);
  // 商家在产品说明里手写的参数，来源就是那份说明本身，没有任何图片区域可指。
  // 在这里给它一条声明式证据，下游按证据长度过滤的地方就不必各自开特例；
  // 逐字白名单的约束一点没松——能写进图的仍然只有清单里出现过的值。
  if (fact.declared === true) {
    return [{
      declared: true,
      confidence: 1,
      sourceText: text(fact.displayText) || `${text(fact.label)}\n${text(fact.value)}`,
    }];
  }
  const explicit = array(fact.evidence);
  const legacy = explicit.length ? [] : [{
    evidenceImageIndex: fact.evidenceImageIndex ?? fact.sourceImageIndexes?.[0],
    evidenceImageId: fact.evidenceImageId ?? fact.sourceNodeIds?.[0],
    evidenceRegion: fact.evidenceRegion || fact.sourceRegion,
    confidence: fact.confidence,
    sourceText: fact.sourceText || fact.displayText,
  }];
  return [...explicit, ...legacy].flatMap(entry => {
    const item = object(entry);
    const evidenceImageIndex = Number(item.evidenceImageIndex ?? item.sourceImageIndex);
    const evidenceImageId = text(item.evidenceImageId || item.sourceNodeId);
    const evidenceRegion = safeNormalizedRegion(item.evidenceRegion || item.sourceRegion || item.region);
    const confidence = Number(item.confidence);
    if ((!Number.isInteger(evidenceImageIndex) || evidenceImageIndex < 0) && !evidenceImageId) return [];
    if (!evidenceRegion || !Number.isFinite(confidence) || confidence < DETAIL_REMIX_STRICT_FACT_MIN_CONFIDENCE) return [];
    return [{
      ...(Number.isInteger(evidenceImageIndex) && evidenceImageIndex >= 0 ? { evidenceImageIndex } : {}),
      ...(evidenceImageId ? { evidenceImageId } : {}),
      evidenceRegion,
      confidence,
      sourceText: text(item.sourceText || fact.displayText || `${fact.label || ''}\n${fact.value || ''}`),
    }];
  });
};

/** Build the exact, position-aware copy contract sent to the image model. */
export function buildDetailCopyReplacementPlan({
  pageAnalysis,
  mappedSellingPoints = [],
  mappedFacts = [],
} = {}) {
  const page = object(pageAnalysis);
  const slots = array(page.copySlots).map((slot, index) => ({
    ...object(slot),
    slotId: text(slot?.slotId || slot?.id) || `copy-${index + 1}`,
    role: text(slot?.role) || 'copy',
    field: canonicalDetailRemixFactField(slot?.field, slot?.sourceText),
    parameterPart: ['label', 'value'].includes(text(slot?.parameterPart).toLowerCase())
      ? text(slot?.parameterPart).toLowerCase()
      : /label/iu.test(text(slot?.role)) ? 'label' : /value/iu.test(text(slot?.role)) ? 'value' : 'none',
    sourceText: text(slot?.sourceText || slot?.originalText || slot?.text),
  }));
  const marketingMappings = array(mappedSellingPoints).map((point, index) => {
    const item = object(point);
    return {
      index,
      kind: 'selling-point',
      item,
      sellingPointId: text(item.id || item.sellingPointId),
      slotId: text(item.slotId),
      role: text(item.slotRole) || 'headline',
      explicitText: displayCopy(item.replacementText || item.displayText),
      title: displayCopy(item.displayTitle || item.title || item.headline || item.text),
      description: displayCopy(item.displayDescription || item.description || item.supportCopy),
    };
  });
  const factMappings = array(mappedFacts).map((fact, index) => {
    const item = object(fact);
    const label = displayCopy(item.label);
    const value = displayCopy(item.value);
    const displayPart = ['label', 'value'].includes(text(item.displayPart))
      ? text(item.displayPart)
      : '';
    const evidence = strictFactEvidence(item);
    return {
      index: marketingMappings.length + index,
      kind: 'verified-fact',
      item,
      sellingPointId: text(item.factId || item.id),
      factId: text(item.factId || item.id),
      slotId: text(item.slotId),
      role: text(item.slotRole) || 'specification',
      field: canonicalDetailRemixFactField(item.field || item.factType, label),
      displayPart,
      evidence,
      explicitText: displayCopy(item.replacementText)
        || (displayPart === 'label' ? label : displayPart === 'value' ? value : ''),
      title: label,
      description: value,
    };
  }).filter(mapping => (
    mapping.factId
    && mapping.field
    && mapping.displayPart
    && mapping.explicitText
    && mapping.evidence.length > 0
  ));
  // A specification page is a closed factual contract. Never let a marketing
  // selling point spill into a parameter cell just because both have text.
  const strictMode = isDetailRemixStrictParameterPage(page);
  const mappings = strictMode
    ? factMappings
    : [...factMappings, ...marketingMappings];
  const usage = new Map();
  const usedUnslottedMappings = new Set();
  const fitText = (value, maximum) => {
    const source = displayCopy(value);
    const limit = Math.max(0, Number(maximum) || 0);
    if (!source || !limit || [...source].length <= limit) return source;
    const segments = source.split(/[，,。；;、｜|&＆\s]+/u).map(text).filter(Boolean);
    const fitting = segments.filter(segment => [...segment].length <= limit)
      .sort((left, right) => [...right].length - [...left].length);
    return fitting[0] || [...source].slice(0, limit).join('');
  };
  const textFor = (mapping, slot) => {
    if (mapping.explicitText) return fitText(mapping.explicitText, slot?.maxChars);
    const count = usage.get(mapping.sellingPointId) || 0;
    const wantsSupport = ['support', 'description', 'body'].includes(String(slot?.role || '').toLowerCase());
    const choices = count > 0 || wantsSupport
      ? [mapping.description, mapping.title]
      : [mapping.title, mapping.description];
    return fitText(choices.find(Boolean), slot?.maxChars);
  };

  if (!slots.length) {
    if (strictMode) return [];
    return mappings.slice(0, 3).flatMap((mapping, index) => {
      const replacementText = textFor(mapping, null);
      if (!replacementText) return [];
      usage.set(mapping.sellingPointId, (usage.get(mapping.sellingPointId) || 0) + 1);
      return [{
        order: index + 1,
        sellingPointIds: [mapping.sellingPointId].filter(Boolean),
        factIds: [mapping.factId].filter(Boolean),
        sourceKind: mapping.kind,
        role: mapping.role,
        sourceText: '',
        originalText: '',
        replacementText,
        positionInstruction: `保持参考图1中第 ${index + 1} 个${mapping.role === 'headline' ? '标题' : '说明文字'}的位置和排版层级`,
      }];
    });
  }

  const plan = [];
  for (const slot of slots) {
    const exact = mappings.filter(mapping => (
      mapping.slotId === slot.slotId
      && (
        mapping.kind !== 'verified-fact'
        || (
          slot.parameterPart === mapping.displayPart
          && slot.field === mapping.field
        )
      )
    ));
    const roleMatches = mappings.filter(mapping => (
      !mapping.slotId
      && mapping.role === slot.role
      && !usedUnslottedMappings.has(mapping.index)
    ));
    // An unassigned competitor text slot is intentionally omitted from the
    // replacement plan. The final prompt already instructs the image model to
    // erase such text; filling it with an arbitrary selling point caused the
    // same phrase to be repeated across comparison labels and body copy.
    const candidates = exact.length
      ? (strictMode ? exact.slice(0, 1) : exact)
      : strictMode ? [] : roleMatches.slice(0, 1);
    if (!candidates.length) continue;
    const parts = [];
    const usedIds = [];
    const maximum = Math.max(0, Number(slot.maxChars) || 0);
    for (const mapping of candidates) {
      const candidate = textFor(mapping, slot);
      if (!candidate || parts.includes(candidate)) continue;
      const joined = [...parts, candidate].join('｜');
      if (maximum && [...joined].length > maximum) {
        if (!parts.length) parts.push(fitText(candidate, maximum));
        continue;
      }
      parts.push(candidate);
      usedIds.push(mapping.sellingPointId);
      if (parts.length >= 3) break;
    }
    const replacementText = parts.filter(Boolean).join('｜');
    if (!replacementText) continue;
    candidates.filter(mapping => !mapping.slotId)
      .forEach(mapping => usedUnslottedMappings.add(mapping.index));
    for (const id of usedIds) usage.set(id, (usage.get(id) || 0) + 1);
    const evidence = candidates.flatMap(mapping => mapping.evidence || []);
    const targetRegion = safeNormalizedRegion(slot);
    plan.push({
      order: plan.length + 1,
      sellingPointIds: [...new Set(usedIds.filter(Boolean))],
      factIds: [...new Set(candidates.map(mapping => mapping.factId).filter(Boolean))],
      sourceKind: candidates.some(mapping => mapping.kind === 'verified-fact')
        ? 'verified-fact'
        : 'selling-point',
      role: slot.role,
      sourceText: slot.sourceText,
      originalText: slot.sourceText,
      replacementText,
      targetRegion,
      targetSlotId: slot.slotId,
      sourceField: candidates.find(mapping => mapping.field)?.field || '',
      targetPart: candidates.find(mapping => mapping.displayPart)?.displayPart || 'none',
      evidence,
      evidenceImageId: evidence[0]?.evidenceImageId || '',
      evidenceRegion: evidence[0]?.evidenceRegion || undefined,
      confidence: evidence.length
        ? Math.min(...evidence.map(item => Number(item.confidence) || 0))
        : undefined,
      slot,
    });
  }
  return plan;
}

const safePageAnalysis = value => {
  const page = object(value);
  const productInstances = array(page.productInstances || page.productRegions);
  const productRegion = object(page.productRegion || page.blankProductRegion || productInstances[0]);
  const pageMode = detailRemixPageMode(page);
  return {
    pageType: text(page.pageType || page.type) || 'marketing',
    strictParameterModeEligible: page.strictParameterModeEligible !== false,
    pageMode,
    strictPageCategory: pageMode === DETAIL_REMIX_STRICT_PARAMETER_MODE
      ? detailRemixStrictPageCategory(page)
      : 'none',
    purpose: text(page.purpose),
    reversePrompt: text(page.reversePrompt || page.visualPrompt),
    layoutSpec: text(page.layoutSpec || page.composition),
    palette: text(page.palette),
    lighting: text(page.lighting),
    hasPerson: page.hasPerson === true,
    personaSpec: text(page.personaSpec),
    productRegion,
    productInstances: productInstances.length ? productInstances : (Object.keys(productRegion).length ? [productRegion] : []),
    targetProductView: object(page.targetProductView),
    selectedProductViewIds: array(page.selectedProductViewIds).map(text).filter(Boolean),
    brandSlots: array(page.brandSlots || page.logoSlots),
    copySlots: array(page.copySlots),
    mappedFacts: array(page.mappedFacts),
    forbiddenCompetitorElements: array(page.forbiddenCompetitorElements),
    foregroundOcclusion: text(page.foregroundOcclusion || page.productRegion?.foregroundOcclusion),
    sourceWidth: Number(page.sourceWidth) || undefined,
    sourceHeight: Number(page.sourceHeight) || undefined,
  };
};

const safePromptSlot = (slot, fallbackId) => {
  const source = object(slot);
  return {
    slotId: text(source.slotId || source.id) || fallbackId,
    role: text(source.role) || undefined,
    field: text(source.field) || undefined,
    parameterPart: text(source.parameterPart) || undefined,
    x: Number.isFinite(Number(source.x)) ? Number(source.x) : undefined,
    y: Number.isFinite(Number(source.y)) ? Number(source.y) : undefined,
    width: Number.isFinite(Number(source.width)) ? Number(source.width) : undefined,
    height: Number.isFinite(Number(source.height)) ? Number(source.height) : undefined,
    align: text(source.align) || undefined,
    color: text(source.color) || undefined,
    fontWeight: Number.isFinite(Number(source.fontWeight)) ? Number(source.fontWeight) : undefined,
    maxChars: Number.isFinite(Number(source.maxChars)) ? Number(source.maxChars) : undefined,
  };
};

/**
 * Reference image 1 still carries the competitor's pixels, but rejected OCR
 * text must never be repeated in the generation prompt. Only visual geometry
 * and own-side identifiers cross this boundary.
 */
const promptSafePageAnalysis = value => {
  const page = safePageAnalysis(value);
  const productInstances = array(page.productInstances).map((instance, index) => {
    const source = object(instance);
    return {
      instanceId: text(source.instanceId || source.id) || `product-${index + 1}`,
      x: Number(source.x) || 0,
      y: Number(source.y) || 0,
      width: Number(source.width) || 0,
      height: Number(source.height) || 0,
      viewAngle: text(source.viewAngle),
      contactSurface: text(source.contactSurface),
      foregroundOcclusion: text(source.foregroundOcclusion),
      productSheetCell: Math.max(0, Number(source.productSheetCell) || 0),
    };
  });
  return {
    pageType: page.pageType,
    pageMode: page.pageMode,
    strictPageCategory: page.strictPageCategory,
    palette: page.palette,
    lighting: page.lighting,
    hasPerson: page.hasPerson,
    productRegion: object(page.productRegion),
    productInstances,
    targetProductView: object(page.targetProductView),
    selectedProductViewIds: page.selectedProductViewIds,
    brandSlots: array(page.brandSlots).map((slot, index) => safePromptSlot(slot, `brand-${index + 1}`)),
    copySlots: array(page.copySlots).map((slot, index) => safePromptSlot(slot, `copy-${index + 1}`)),
    foregroundOcclusion: page.foregroundOcclusion,
    sourceWidth: page.sourceWidth,
    sourceHeight: page.sourceHeight,
  };
};

const promptSafeCopyPlan = value => array(value).map(item => {
  const source = object(item);
  const evidence = array(source.evidence).map(entry => {
    const item = object(entry);
    return {
      evidenceImageId: text(item.evidenceImageId) || undefined,
      evidenceImageIndex: Number.isInteger(Number(item.evidenceImageIndex))
        ? Number(item.evidenceImageIndex)
        : undefined,
      evidenceRegion: safeNormalizedRegion(item.evidenceRegion) || undefined,
      confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : undefined,
    };
  });
  return {
    order: Number(source.order) || undefined,
    sellingPointIds: array(source.sellingPointIds).map(text).filter(Boolean),
    factIds: array(source.factIds).map(text).filter(Boolean),
    sourceKind: text(source.sourceKind),
    role: text(source.role),
    originalText: text(source.originalText || source.sourceText),
    replacementText: text(source.replacementText),
    targetRegion: safeNormalizedRegion(source.targetRegion) || undefined,
    targetSlotId: text(source.targetSlotId) || undefined,
    sourceField: text(source.sourceField) || undefined,
    targetPart: text(source.targetPart) || undefined,
    evidenceImageId: text(source.evidenceImageId) || evidence[0]?.evidenceImageId || undefined,
    evidenceRegion: safeNormalizedRegion(source.evidenceRegion) || evidence[0]?.evidenceRegion || undefined,
    confidence: Number.isFinite(Number(source.confidence)) ? Number(source.confidence) : undefined,
    evidence,
    positionInstruction: text(source.positionInstruction),
    slot: safePromptSlot(
      source.slot,
      text(source.slotId) || `copy-${Number(source.order) || 1}`,
    ),
  };
});

export function buildFinalDetailPrompt({
  pageAnalysis,
  mappedSellingPoints = [],
  mappedFacts = [],
  pageIndex = 0,
  productImageCount = 1,
  selectedProductViews = [],
  ownBrandIdentity = {},
  hasBrandLogoReference = false,
  ownEvidenceReferenceCount = 0,
  useCharacterReference = false,
  productSheet = null,
} = {}) {
  const page = safePageAnalysis(pageAnalysis);
  const promptPage = promptSafePageAnalysis(page);
  const productCount = Math.max(1, Number(productImageCount) || 1);
  const productRange = productCount === 1 ? '参考图2' : `参考图2至参考图${productCount + 1}`;
  const sheet = normalizeDetailRemixProductSheet(productSheet);
  const sheetCells = new Set(array(sheet?.cells).map(cell => cell.index));
  // Binding the planner's per-instance choice into the render prompt is what
  // stops the model from picking an angle itself on a page full of small tiles.
  const sheetBindings = sheet
    ? array(promptPage.productInstances)
      .map(instance => ({
        instanceId: instance.instanceId,
        cell: Number(instance.productSheetCell) || 0,
      }))
      .filter(binding => sheetCells.has(binding.cell))
    : [];
  const brandReferenceIndex = productCount + 2;
  const evidenceStart = brandReferenceIndex + (hasBrandLogoReference ? 1 : 0);
  const evidenceEnd = evidenceStart + Math.max(0, Number(ownEvidenceReferenceCount) || 0) - 1;
  const characterStart = evidenceEnd + 1;
  const copyPlan = buildDetailCopyReplacementPlan({
    pageAnalysis: page,
    mappedSellingPoints,
    mappedFacts,
  });
  const strictMode = isDetailRemixStrictParameterPage(page);
  const safeCopyPlan = promptSafeCopyPlan(copyPlan);
  const marketingLayoutSlots = strictMode
    ? []
    : array(page.copySlots)
      .filter(isDetailRemixMarketingLayoutSlot)
      .map((slot, index) => safePromptSlot(slot, `marketing-layout-${index + 1}`));
  const brandPlan = {
    brandIdentity: object(ownBrandIdentity),
    sourceSlots: promptPage.brandSlots,
    logoReference: hasBrandLogoReference ? `参考图${brandReferenceIndex}` : '',
  };
  return [
    `直接编辑参考图1，生成第 ${pageIndex + 1} 张可立即交付的电商详情页最终图。这次模型输出就是最终成品，后续不会再叠加产品、文字或 Logo。`,
    `目标尺寸继承竞品原图：${page.sourceWidth || '自动'} × ${page.sourceHeight || '自动'} 像素；不得改成统一画幅。`,
    `视觉反推规格（仅含版式坐标，不含任何竞品原文）：${JSON.stringify(promptPage)}`,
    `精确逐位置替换清单（originalText 只用于定位并擦除，replacementText 才是唯一允许写入的文字）：${JSON.stringify(safeCopyPlan)}`,
    `必须完成的品牌与 Logo 替换清单：${JSON.stringify(brandPlan)}`,
    sheet
      ? describeDetailRemixProductSheet(sheet, '参考图2')
      // 全部参考都由商家直接提供时，说成「从我的详情自动挑选」是假话——
      // 这时根本没有我的详情。一句自信的错误说明比不说明更有害。
      : array(selectedProductViews).length
        && array(selectedProductViews).every(view => object(view).supplemental === true)
        ? `${productRange}是商家直接提供的我方产品实拍参考，没有其它角度库可选；产品外观完全以这些图为准。`
        : `系统已从“我的详情”自动挑选与本页角度最匹配的产品参考：${JSON.stringify(selectedProductViews)}`,
    // Only the first supplied image carries a declared grid. Any further product
    // references must still be named, or they arrive as undescribed pixels.
    sheet && productCount > 1
      ? `参考图3${productCount > 2 ? `至参考图${productCount + 1}` : ''}是同一台产品的补充实拍，用于补齐角度板没有拍到的结构；它们不是角度板，没有分格编号，也不改变上面的板格指派。`
      : '',
    sheetBindings.length
      ? `本页每个产品实例必须使用的板格已经指定，不得自行改用其它格：${JSON.stringify(sheetBindings)}。指定格里没有拍到的结构，从相邻格补全，禁止凭空发明。`
      : '',
    '参考图1是需要直接修改的竞品原图，不是只供自由发挥的风格参考。锁定它的画布、构图、背景、区域边界、人物姿势、商品位置、文字位置与视觉层级；除明确要求替换的区域外，不得重新设计页面。',
    `${sheet ? '参考图2 的各个分格' : productRange}是同一款我方真实产品的角度参考。逐个用我方产品替换参考图1中 productInstances 列出的全部竞品产品实例；${sheet ? '每个实例使用上面指定的板格' : '为每个实例选择最接近的我方角度'}，保持我方产品真实结构、材质、颜色、比例和产品自身标识，并匹配原位置的透视、接触面、阴影、反射、肢体交互与前景遮挡。不得遗漏重复出现的小产品或混入竞品外形。`,
    sheet
      ? '参考图2 是角度索引板，不是版式参考：禁止把它的网格、分格线、编号数字、背景底色或多格并排的布局搬进详情页，每个产品实例只呈现单一产品本身。'
      : '',
    hasBrandLogoReference
      ? `参考图${brandReferenceIndex}只提供我方 Logo 的身份、拼写和图形结构，不提供 Logo 容器样式。严禁把该裁剪图周围的产品材质、压印底纹、深色背景、光影或矩形裁剪边界复制到页面。删除参考图1全部竞品 Logo 和品牌字样，再在 brandSlots 原位置生成我方 Logo；每个槽位的底色、容器形状、尺寸、留白、对齐与呈现方式严格继承参考图1，例如独立白色标牌仍是干净白色标牌，产品表面压印仍是自然压印，不能把一种呈现方式套到所有位置。`
      : `删除参考图1全部竞品 Logo 和品牌字样，并根据 brandIdentity 在 brandSlots 指定的原位置生成我方品牌；品牌名必须逐字正确。若 brandIdentity 为空，则该位置保持干净，不得保留或猜测竞品品牌。`,
    ownEvidenceReferenceCount > 0
      ? `参考图${evidenceStart}${evidenceEnd > evidenceStart ? `至参考图${evidenceEnd}` : ''}是“我的详情”中与本页文案直接对应的事实证据页。参数、型号、数字、单位、正负号和大小写必须同时服从这些证据图与文案替换清单；不得从竞品原图抄回任何参数。`
      : '本页没有额外事实证据图；只能生成文案替换清单中已经核验的文字，其它竞品文字必须删除，禁止猜测补全。',
    strictMode
      ? `本页已由程序锁定为 ${DETAIL_REMIX_STRICT_PARAMETER_MODE}：每个 replacementText 都是不可改写的事实，sourceField、targetPart、targetRegion、evidenceImageId、evidenceRegion 与 confidence 构成证据链。参数名只能写入 label 位置，参数值只能写入 value 位置。禁止把营销卖点填入参数栏；没有证据映射的竞品参数栏必须连标签和值一起删除并自然修复背景。`
      : `本页是营销/场景详情页：只能使用已经映射的我方卖点，不得擅自添加型号、功率、电压、认证或效果数据。以下槽位共同承担原页的核心文案层级，必须与替换清单逐槽对应、全部保留，任何一个都不得消失或合并：${JSON.stringify(marketingLayoutSlots)}。`,
    '先彻底擦除参考图1的全部竞品文案，再依据“文案替换清单”在对应 slot 原位置直接生成 replacementText。中文必须逐字一致，不得改写、缩写、增字、漏字、重复、错别字或乱码；保持原槽位的字号层级、对齐、颜色和留白，不得让新旧文字重叠。没有分配替换文案的竞品文字槽必须删除并自然修复背景。',
    '保留参考图1原有的“眉题/胶囊标签—主标题—副标题/说明”视觉层级：主标题仍然是视觉中心，副标题不得抢级，胶囊标签不得变成散落小字；禁止把多级文案压成同字号的两行文字，也禁止随意改变字体区域宽度、基线、行距和组间距。',
    '在不改变原版式骨架的前提下完成高级感精修：Logo 边缘清晰、文字字形干净、字距行距稳定、光学对齐准确、留白克制、色彩和圆角一致；不得出现贴图感、脏底色、廉价描边、发光滥用、粗糙阴影或突兀矩形补丁。高级感只用于提高完成度，不允许自由改版。',
    '展示文案中禁止出现“图片显示”“图片明确标注”“文案提到”“证据表明”等分析过程用语。不得把 sellingPointId、坐标、JSON、提示词或任何内部说明画进图片。',
    '必须彻底移除竞品产品、包装、品牌、Logo、文案、水印与竞品独有主张；不得残留、变形、混合或臆造竞品元素，也不得生成额外产品。',
    useCharacterReference
      ? `参考图${characterStart}及之后是人物完整外观的最高权威。必须把参考图1中的竞品人物完整替换成参考人物：脸型五官、肤色、发际线、发色、发型结构、服装款式、领口袖型、服装颜色材质、可见配饰和身体比例都以人物参考图为准。绝不允许只换脸后保留竞品人物的发型、衣服或配饰。只保留参考图1的人物位置、动作、姿势、视线、构图尺度、与产品的交互及前后遮挡；被产品遮住的衣物区域无需臆造，但所有可见衣物必须属于参考造型。若人物参考是多视图造型板，所有分栏代表同一个人物与同一套造型，应选取和本页角度最接近的分栏。`
      : '不使用人物身份参考；若规格 hasPerson=false，禁止凭空增加人物；若原图有人物，也不得保留可识别的竞品人物身份。',
    '只允许出现替换清单中的我方文案、我方品牌/Logo，以及我方产品自身不可分离的真实标识；不得出现其它文字、乱码、商标或水印。',
    '输出单张完整最终图，不要解释，不要输出中间底图、无字底图、蒙版或排版稿。',
  ].filter(Boolean).join('\n');
}

export function parseFinalDetailValidationResponse(value) {
  const parsed = object(parseJsonPayload(value, '最终详情质检结果'));
  return {
    ...parsed,
    passed: parsed.passed === true,
    copyExact: parsed.copyExact === true,
    brandCorrect: parsed.brandCorrect === true,
    productCorrect: parsed.productCorrect === true,
    logoCorrect: parsed.logoCorrect === true,
    logoPresentationCorrect: parsed.logoPresentationCorrect === true,
    layoutHierarchyCorrect: parsed.layoutHierarchyCorrect === true,
    visualPolishCorrect: parsed.visualPolishCorrect === true,
    layoutIssues: array(parsed.layoutIssues).map(text).filter(Boolean),
    productPlacementCorrect: parsed.productPlacementCorrect === true,
    parameterAlignmentCorrect: parsed.parameterAlignmentCorrect === true,
    unsupportedStrictFactsAbsent: parsed.unsupportedStrictFactsAbsent === true,
    characterIdentityCorrect: parsed.characterIdentityCorrect === true,
    characterHairstyleCorrect: parsed.characterHairstyleCorrect === true,
    characterOutfitCorrect: parsed.characterOutfitCorrect === true,
    characterAccessoriesCorrect: parsed.characterAccessoriesCorrect === true,
    characterIssues: array(parsed.characterIssues).map(text).filter(Boolean),
    competitorRemoved: parsed.competitorRemoved === true,
    gibberishDetected: parsed.gibberishDetected === true,
    missingTexts: array(parsed.missingTexts).map(text).filter(Boolean),
    wrongTexts: array(parsed.wrongTexts).map(text).filter(Boolean),
    unexpectedTexts: array(parsed.unexpectedTexts).map(text).filter(Boolean),
    summary: text(parsed.summary),
  };
}

/**
 * Facts a page must get right to be deliverable at all. Every one of these is a
 * verifiable claim about the image — a wrong model number or a competitor logo
 * is wrong no matter who looks at it — so a single judge report is enough to
 * block, and no amount of re-judging may waive them.
 */
const DETAIL_REMIX_BLOCKING_VALIDATION_KEYS = Object.freeze([
  'copyExact',
  'brandCorrect',
  'productCorrect',
  'logoCorrect',
  'logoPresentationCorrect',
  'productPlacementCorrect',
  'parameterAlignmentCorrect',
  'unsupportedStrictFactsAbsent',
  'characterIdentityCorrect',
  'characterHairstyleCorrect',
  'characterOutfitCorrect',
  'characterAccessoriesCorrect',
  'competitorRemoved',
]);

/**
 * Aesthetic judgments. These are real quality signals, but one picky judge call
 * should not permanently destroy a paid page over them, so they are confirmed by
 * a second look and — only after the repair budget is spent — may ship as a
 * warning instead of a discarded result.
 */
export const DETAIL_REMIX_ADVISORY_VALIDATION_KEYS = Object.freeze([
  'visualPolishCorrect',
  'layoutHierarchyCorrect',
]);

export const DETAIL_REMIX_VALIDATION_FAILURE_LABELS = Object.freeze({
  copyExact: '文案未逐字一致',
  brandCorrect: '品牌不正确',
  productCorrect: '产品不正确',
  logoCorrect: 'Logo 身份不正确',
  logoPresentationCorrect: 'Logo 呈现方式不正确',
  productPlacementCorrect: '产品位置或透视不正确',
  parameterAlignmentCorrect: '参数名值错栏',
  unsupportedStrictFactsAbsent: '出现无证据参数',
  characterIdentityCorrect: '人物身份不符',
  characterHairstyleCorrect: '人物发型不符',
  characterOutfitCorrect: '人物服装不符',
  characterAccessoriesCorrect: '人物配饰不符',
  competitorRemoved: '竞品元素残留',
  gibberishDetected: '出现乱码或伪字',
  missingTexts: '缺少应有文案',
  wrongTexts: '文案写错',
  unexpectedTexts: '出现多余文案',
  characterIssues: '人物问题',
  visualPolishCorrect: '视觉精修不足',
  layoutHierarchyCorrect: '文案层级被压缩',
  layoutIssues: '版式问题',
  selfReportedFailure: '质检未说明原因的整体不通过',
});

/**
 * Splits a judge report into what must block delivery and what merely warrants a
 * second look. `passed` keeps today's meaning: nothing at all was reported.
 */
export function classifyFinalDetailValidation(validation = {}) {
  const report = object(validation);
  const blocking = [];
  const advisory = [];
  for (const key of DETAIL_REMIX_BLOCKING_VALIDATION_KEYS) {
    if (report[key] !== true) blocking.push(key);
  }
  if (report.gibberishDetected === true) blocking.push('gibberishDetected');
  for (const key of ['missingTexts', 'wrongTexts', 'unexpectedTexts', 'characterIssues']) {
    if (array(report[key]).length) blocking.push(key);
  }
  for (const key of DETAIL_REMIX_ADVISORY_VALIDATION_KEYS) {
    if (report[key] !== true) advisory.push(key);
  }
  if (array(report.layoutIssues).length) advisory.push('layoutIssues');
  // A judge that rejects the page without naming a single concrete defect gets a
  // second look rather than the last word.
  if (report.passed !== true && !blocking.length && !advisory.length) {
    advisory.push('selfReportedFailure');
  }
  return {
    blocking,
    advisory,
    passed: blocking.length === 0 && advisory.length === 0,
    advisoryOnly: blocking.length === 0 && advisory.length > 0,
  };
}

export function describeFinalDetailValidationFailures(keys = []) {
  return array(keys)
    .map(key => DETAIL_REMIX_VALIDATION_FAILURE_LABELS[text(key)] || text(key))
    .filter(Boolean);
}

export function buildFinalDetailValidationInstruction({
  pageAnalysis,
  copyPlan = [],
  ownBrandIdentity = {},
  productReferenceCount = 0,
  hasBrandLogoReference = false,
  evidenceReferenceCount = 0,
  characterReferenceCount = 0,
  productSheet = null,
} = {}) {
  const page = safePageAnalysis(pageAnalysis);
  const sheet = normalizeDetailRemixProductSheet(productSheet);
  const safeCopyPlan = promptSafeCopyPlan(copyPlan);
  const strictMode = isDetailRemixStrictParameterPage(page);
  const productCount = Math.max(0, Number(productReferenceCount) || 0);
  const evidenceCount = Math.max(0, Number(evidenceReferenceCount) || 0);
  const characterCount = Math.max(0, Number(characterReferenceCount) || 0);
  const productStart = 3;
  const brandReferenceIndex = productCount + productStart;
  const evidenceStart = brandReferenceIndex + (hasBrandLogoReference ? 1 : 0);
  const characterStart = evidenceStart + evidenceCount;
  const marketingLayoutSlots = strictMode
    ? []
    : array(page.copySlots)
      .filter(isDetailRemixMarketingLayoutSlot)
      .map((slot, index) => safePromptSlot(slot, `marketing-layout-${index + 1}`));
  return [
    '你是电商详情最终交付质检员。参考图1是待验收成图；参考图2是原始竞品页，只能用于比对画布、构图、品牌容器和文案版式，绝不能把其中的竞品品牌、产品或文案判为应保留内容。参考图3及之后才是我方产品、Logo、事实证据或人物完整造型。',
    characterCount > 0
      ? `参考图${characterStart}${characterCount > 1 ? `至参考图${characterStart + characterCount - 1}` : ''}是人物完整造型参考；必须分别核对人脸身份、发型、服装和可见配饰，不能只核对脸。`
      : '本页没有人物参考图；人物四项检查字段填 true，characterIssues 留空。',
    sheet
      ? `${describeDetailRemixProductSheet(sheet, `参考图${productStart}`)}它只是角度索引，成图里本来就不该出现网格、分格线或编号；只有当成图真的把网格或编号画了进去，才判 productCorrect=false。核对产品时用各分格逐一比对成图中每一处产品的结构、比例与材质。`
      : '',
    `页面类型：${page.pageType}；运行模式：${page.pageMode}。必须逐字、逐位置出现的文案清单：${JSON.stringify(safeCopyPlan)}。营销页必须保留的核心文案层级槽：${JSON.stringify(marketingLayoutSlots)}。我方品牌：${JSON.stringify(object(ownBrandIdentity))}。`,
    '所有不在上述我方文案与品牌白名单中的可读内容，都必须按竞品残留或模型臆造内容报告。',
    '逐项检查：1) replacementText 是否逐字正确，数字、型号、单位、正负号与大小写均一致；2) 参数名是否仍在 label 区、参数值是否仍在 value 区，不能错栏、合并或串行；3) 是否出现乱码、伪字、重复卖点、提示词或 JSON；4) 品牌与 Logo 身份是否正确且无竞品残留；5) 对照参考图2，Logo 是否只替换标识身份而保留原槽位容器，不能把 Logo 参考图的深色产品材质、压印纹理或矩形裁剪底复制成贴片；6) 对照参考图2，营销页的胶囊标签、主标题、副标题/说明是否逐层保留，不能缺层、合并、缩成同字号小字或大幅漂移；7) 产品是否仍是我方产品、位置透视是否正确；8) 有人物参考时，成图人物的脸型五官、发际线与发型结构、服装款式领口袖型与颜色材质、可见配饰是否都来自人物参考。只换脸、仍保留竞品发型或竞品衣服必须判失败，并在 characterIssues 写明。',
    '视觉完成度检查：只有 Logo 清晰、字体层级明确、字距行距稳定、对齐与留白统一，并且没有贴图方块、脏底、廉价描边、滥用发光、粗糙阴影或明显 AI 排版破损时，visualPolishCorrect 才能为 true。不要因正常风格差异苛刻判错，但任何肉眼明显不专业的排版都必须判失败并写入 layoutIssues。',
    strictMode
      ? `这是 ${DETAIL_REMIX_STRICT_PARAMETER_MODE}。没有列入替换清单的型号、数字、单位、材质、认证、配件或清单内容必须完全不存在；发现一个即 unsupportedStrictFactsAbsent=false，并写入 unexpectedTexts。`
      : '没有列入替换清单的新增参数或功效一律写入 unexpectedTexts。',
    '只要 missingTexts、wrongTexts、unexpectedTexts、characterIssues 或 layoutIssues 任一非空，passed 必须为 false。参数页只要有一个错误数字、单位、型号、参数错栏或乱码，passed 必须为 false。营销页核心文案层级缺失，或 Logo 出现深色纹理方块/裁剪贴片，必须为 false。',
    'passed 只有在 copyExact、brandCorrect、productCorrect、logoCorrect、logoPresentationCorrect、layoutHierarchyCorrect、visualPolishCorrect、productPlacementCorrect、parameterAlignmentCorrect、unsupportedStrictFactsAbsent、characterIdentityCorrect、characterHairstyleCorrect、characterOutfitCorrect、characterAccessoriesCorrect、competitorRemoved 全为 true，gibberishDetected=false，且所有异常数组都为空时才能为 true。只输出符合 Schema 的 JSON。',
  ].filter(Boolean).join('\n');
}

export function buildFinalDetailRepairPrompt({
  pageAnalysis,
  copyPlan = [],
  ownBrandIdentity = {},
  validation = {},
  evidenceReferenceCount = 0,
  hasBrandLogoReference = false,
  characterReferenceCount = 0,
} = {}) {
  const page = safePageAnalysis(pageAnalysis);
  const safeCopyPlan = promptSafeCopyPlan(copyPlan);
  const evidenceStart = 3;
  const evidenceEnd = evidenceStart + Math.max(0, Number(evidenceReferenceCount) || 0) - 1;
  const characterCount = Math.max(0, Number(characterReferenceCount) || 0);
  const brandReferenceIndex = evidenceEnd + 1;
  const characterStart = brandReferenceIndex + (hasBrandLogoReference ? 1 : 0);
  return [
    '直接编辑参考图1，输出修复后的完整最终详情图。参考图2是原始竞品页，只用于恢复画布、构图、品牌容器和文案层级，严禁恢复其中的竞品品牌、产品或文案。只修复质检报告中失败的区域；产品、正确文字和其它已通过区域保持不变。',
    `页面类型：${page.pageType}；运行模式：${page.pageMode}。质检发现：${JSON.stringify(object(validation))}。`,
    `必须逐字生成的最终文案：${JSON.stringify(safeCopyPlan)}。我方品牌：${JSON.stringify(object(ownBrandIdentity))}。`,
    evidenceReferenceCount > 0
      ? `参考图${evidenceStart}${evidenceEnd > evidenceStart ? `至参考图${evidenceEnd}` : ''}是我方事实证据，必须据此核对型号、数字、单位、符号和品牌。`
      : '没有额外事实证据图，严禁在清单之外猜测或新增文字。',
    hasBrandLogoReference
      ? `参考图${brandReferenceIndex}只提供我方 Logo 的身份、拼写和图形结构；不得复制其产品材质、压印底纹、深色背景或矩形裁剪边界。修复品牌时必须恢复参考图2原品牌槽的底色、容器形状、尺寸、留白和对齐，只替换 Logo 身份。`
      : '没有独立 Logo 参考时只允许使用品牌清单中的准确名称，不得臆造 Logo 图形。',
    characterCount > 0
      ? `参考图${characterStart}${characterCount > 1 ? `至参考图${characterStart + characterCount - 1}` : ''}是人物完整造型参考。若 characterIdentityCorrect、characterHairstyleCorrect、characterOutfitCorrect 或 characterAccessoriesCorrect 任一为 false，必须换掉参考图1中对应的脸、发型、服装或配饰，完整服从人物参考；只保留原人物的位置、动作、视线、与产品交互和遮挡关系，禁止只换脸。`
      : '本次没有人物造型参考，不要凭空改动人物。',
    '先擦除所有错误文字、乱码、重复文案、竞品参数和竞品品牌，再严格按 targetRegion/targetPart 在原槽位写入清单中的 replacementText。参数名不得进入 value 区，参数值不得进入 label 区；没有替换项的竞品文字区域保持干净。',
    '若 layoutHierarchyCorrect=false，按参考图2逐层恢复胶囊标签、主标题、副标题/说明的原位置、字号比例、对齐和留白，禁止把多级文案压成同字号小字。若 logoPresentationCorrect=false，去掉贴图方块和脏底，只保留干净、清晰且适配原容器的我方 Logo。若 visualPolishCorrect=false，修正字距、行距、光学对齐、边缘、底色与阴影，使页面精致高级，但不得自由改版。',
    '中文、数字、型号、单位、正负号、斜杠和大小写必须逐字一致；不得解释，不得输出蒙版或中间稿，只输出单张完整图片。',
  ].join('\n');
}

/**
 * A fresh generation for a page whose targeted repair could not save it. The base
 * prompt is unchanged — it already encodes the whole contract — and the judge's
 * findings are appended as a do-not-repeat list so the same damage is not redrawn.
 */
export function buildFinalDetailRegenerationPrompt({
  basePrompt = '',
  validation = {},
  attempt = 1,
} = {}) {
  const report = object(validation);
  const failures = describeFinalDetailValidationFailures([
    ...array(report.blockingFailures),
    ...array(report.advisoryFailures),
  ]);
  const findings = [
    ...array(report.missingTexts).map(item => `缺少文案：${item}`),
    ...array(report.wrongTexts).map(item => `文案写错：${item}`),
    ...array(report.unexpectedTexts).map(item => `多余文案：${item}`),
    ...array(report.characterIssues).map(item => `人物问题：${item}`),
    ...array(report.layoutIssues).map(item => `版式问题：${item}`),
  ];
  return [
    basePrompt,
    `本页上一版成品经过一次定向修复后仍未通过质检（第 ${attempt} 次整页重新生成）。这一次必须整张重新生成，不要延续上一版的错误结构。`,
    failures.length ? `上一版失败类别：${failures.join('、')}。` : '',
    findings.length ? `上一版的具体问题（必须全部消除）：${JSON.stringify(findings.slice(0, 20))}。` : '',
    report.summary ? `质检结论原文：${text(report.summary)}` : '',
    '重点复查：文字必须是清晰可读的真实汉字与数字，不得出现乱码、伪字或重复段落；竞品品牌、产品、文案与水印必须完全消失；胶囊标签、主标题、副标题的字号层级与位置必须按竞品原图逐层保留，不得压成同字号小字。',
  ].filter(Boolean).join('\n');
}
