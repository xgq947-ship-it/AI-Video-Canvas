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
]);

export const DETAIL_REMIX_PORT_LABELS = Object.freeze({
  'competitor-detail': '竞品详情（可多张）',
  'own-detail': '我的详情（可多张）',
  'character-reference': '人物参考（可选）',
  'product-reference': '产品补充图（可选）',
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
        'pageType', 'purpose', 'reversePrompt', 'layoutSpec', 'palette', 'lighting',
        'hasPerson', 'personaSpec', 'targetProductView', 'selectedProductViewIds',
        'productInstances', 'brandSlots', 'copySlots', 'mappedSellingPoints', 'mappedFacts',
        'forbiddenCompetitorElements',
      ],
      properties: {
        pageType: { type: 'string' },
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
              'contactSurface', 'foregroundOcclusion',
            ],
            properties: {
              instanceId: { type: 'string' },
              ...normalizedRegionSchema.properties,
              viewAngle: { type: 'string' },
              contactSurface: { type: 'string' },
              foregroundOcclusion: { type: 'string' },
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
              'slotId', 'role', 'sourceText', 'x', 'y', 'width', 'height',
              'align', 'color', 'fontWeight', 'maxChars',
            ],
            properties: {
              slotId: { type: 'string' },
              role: { type: 'string' },
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
            required: ['sellingPointId', 'slotId', 'slotRole'],
            properties: {
              sellingPointId: { type: 'string' },
              slotId: { type: 'string' },
              slotRole: { type: 'string' },
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
              displayPart: { type: 'string', enum: ['label', 'value', 'displayText'] },
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
          'id', 'factType', 'label', 'value', 'displayText',
          'sourceImageIndexes', 'sourceRegion', 'confidence',
        ],
        properties: {
          id: { type: 'string' },
          factType: { type: 'string' },
          label: { type: 'string' },
          value: { type: 'string' },
          displayText: { type: 'string' },
          sourceImageIndexes: { type: 'array', items: { type: 'integer', minimum: 0 } },
          sourceRegion: optionalNormalizedRegionSchema,
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
});

/** AI-only delivery gate. It never draws pixels; it decides whether the page is deliverable. */
export const DETAIL_REMIX_FINAL_VALIDATION_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'passed', 'copyExact', 'brandCorrect', 'productCorrect',
    'competitorRemoved', 'gibberishDetected', 'missingTexts',
    'wrongTexts', 'unexpectedTexts', 'summary',
  ],
  properties: {
    passed: { type: 'boolean' },
    copyExact: { type: 'boolean' },
    brandCorrect: { type: 'boolean' },
    productCorrect: { type: 'boolean' },
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
  }) !== JSON.stringify({
    competitor: previousRefs.competitorDetailNodeIds,
    own: previousRefs.ownDetailNodeIds,
    character: activeCharacter(previousRefs.characterReference),
    product: previousRefs.productNodeIds,
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
  if (!own.length) return { ok: false, error: '请至少提供一张我的详情图' };
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
  return {
    ...object(parsed),
    brandIdentity: object(parsed?.brandIdentity || parsed?.brand),
    productViews: array(parsed?.productViews || parsed?.productAngles || parsed?.productCrops),
    verifiedFacts: array(
      parsed?.verifiedFacts || parsed?.productFacts || parsed?.specifications || parsed?.facts,
    ),
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
  return {
    ...object(parsed),
    page: {
      ...page,
      hasPerson: page.hasPerson === true,
      pageType: text(page.pageType || page.type) || 'marketing',
      mappedSellingPoints: array(page.mappedSellingPoints || page.sellingPointMapping),
      mappedFacts: array(page.mappedFacts || page.factMapping),
      copySlots: array(page.copySlots),
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
    '另外建立 verifiedFacts 精确事实库。产品名称、型号、额定功率、电压、充电电压、接口、工作时间、温度、尺寸、重量、容量、装箱清单等必须逐字抄录原图；label 与 value 分开，displayText 是最终可直接印在详情页上的“label + 换行 + value”。',
    'verifiedFacts 只能收录清晰可辨且可在 sourceImageIndexes/sourceRegion 回看核验的事实。数字、单位、型号、正负号、斜杠和大小写必须与原图一致；看不清就不要输出，绝不补全或推测。',
    '只输出合法 JSON，不要 Markdown。格式：',
    '{"brandIdentity":{"name":"","slogan":"","primaryColors":[],"logoDescription":"","logoSourceImageIndex":0,"logoRegion":{"x":0.05,"y":0.03,"width":0.2,"height":0.08}},"productViews":[{"sourceImageIndex":0,"cropRegion":{"x":0.2,"y":0.15,"width":0.6,"height":0.65},"viewAngle":"front-left","visibleSides":["front","left"],"description":"左前方约30度，产品完整清晰","quality":0.95}],"sellingPoints":[{"id":"sp-1","title":"短标题","description":"可直接上图的简短说明","evidenceSummary":"来源图片中可核验的依据","sourceImageIndexes":[0],"priority":1}],"verifiedFacts":[{"id":"fact-1","factType":"rated_power","label":"额定功率","value":"16W","displayText":"额定功率\\n16W","sourceImageIndexes":[0],"sourceRegion":{"x":0.1,"y":0.55,"width":0.35,"height":0.1},"confidence":0.99}]}',
  ].join('\n');
}

export function buildCompetitorPageInstruction({
  ownSellingPoints = [],
  ownVerifiedFacts = [],
  ownBrandIdentity = {},
  ownProductViews = [],
  pageIndex = 0,
} = {}) {
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
    factType: clip(fact?.factType, 50),
    label: clip(fact?.label, 60),
    value: clip(fact?.value, 120),
    displayText: clip(fact?.displayText || [fact?.label, fact?.value].filter(Boolean).join('\n'), 180),
  })).filter(fact => fact.label && fact.value);
  return [
    '你是电商详情页视觉反推与语义槽位规划专家。所附仅一张“竞品详情图”。',
    '反推画面结构、镜头、背景、光线、色彩、人物需求、文字层级、商品区域及前后遮挡关系；完整保留版式位置关系，但不要保留竞品品牌、Logo、商品外观或竞品独有主张。',
    '逐个识别画面里所有竞品产品实例并输出 productInstances；每个实例使用 0~1 归一化 x/y/width/height，并说明观察角度、接触面与需要保留在商品前方的遮挡层。只有单个实例时仍必须输出一项。',
    '识别竞品品牌/Logo 原本占据的位置并输出 brandSlots，记录 sourceText 或 visualDescription，后续 AI 会在相同位置直接换成我方品牌。',
    '先判断页面类型 pageType：参数/规格/型号/电气信息表必须填 specification；普通卖点页填 marketing；场景页填 scene；品牌页填 brand。',
    '逐个识别竞品原有可读文案并输出 copySlots；每个槽必须包含 slotId、role、sourceText、位置、对齐、颜色和字重。',
    '当 pageType=specification 时，只能把参数槽映射到 verifiedFacts 的事实 ID，写入 mappedFacts；禁止用营销卖点填参数栏。每个映射必须填写 displayPart：参数名独立槽用 label，参数值独立槽用 value，单槽同时承载名称和值才用 displayText。同一事实允许分别映射一次 label 和 value。只有语义一致或可合理承载的参数槽才映射，没有我方事实证据的竞品参数槽不映射，后续会彻底删除。',
    '非参数页可把槽映射到 mappedSellingPoints；只能选择已给卖点，不得新造参数或功效，也不得新造比较结论。',
    'mappedSellingPoints 只映射确实适合承载我方卖点的文案槽：同一 slotId 最多选择一个卖点，尽量把不同卖点分配给不同槽；纯栏目标签、竞品对照说明或无法可靠替换的槽不要强行映射，后续会直接删除其竞品文字。',
    '判断所有竞品产品实例的观察角度、朝向、可见面和透视要求，再从我方产品视角库中选择最匹配的 1~3 个 ID 写入 selectedProductViewIds。必须只选给定 ID；优先覆盖本页出现的不同角度和产品完整度。',
    `页面序号：${pageIndex + 1}。我方品牌：${JSON.stringify(brand)}。我方卖点库：${JSON.stringify(sellingPoints)}。我方精确事实库：${JSON.stringify(verifiedFacts)}。我方产品视角库：${JSON.stringify(productViews)}`,
    '只输出合法 JSON，不要 Markdown。格式：',
    '{"page":{"pageType":"specification","purpose":"","reversePrompt":"","layoutSpec":"","palette":"","lighting":"","hasPerson":false,"personaSpec":"","targetProductView":{"viewAngle":"front-left","visibleSides":["front","left"],"orientation":"upright","perspective":"three-quarter"},"selectedProductViewIds":["pv-1"],"productInstances":[{"instanceId":"product-1","x":0.5,"y":0.5,"width":0.3,"height":0.3,"viewAngle":"front-left","contactSurface":"","foregroundOcclusion":""}],"brandSlots":[{"slotId":"brand-1","sourceText":"竞品品牌","visualDescription":"左上角白色品牌标识","x":0.05,"y":0.03,"width":0.2,"height":0.08,"align":"left","color":"#ffffff"}],"copySlots":[{"slotId":"copy-1","role":"specification","sourceText":"额定功率 20W","x":0.1,"y":0.08,"width":0.8,"height":0.12,"align":"left","color":"#ffffff","fontWeight":500,"maxChars":20}],"mappedSellingPoints":[],"mappedFacts":[{"factId":"fact-1","slotId":"copy-1","slotRole":"specification","displayPart":"displayText"}],"forbiddenCompetitorElements":[]}}',
  ].join('\n');
}

const displayCopy = value => text(value)
  .replace(/^(?:图片(?:中)?(?:明确)?(?:显示|标注|写明|说明)|页面(?:中)?(?:明确)?(?:显示|标注|写明|说明)|文案(?:中)?(?:明确)?(?:提到|写明|显示|说明)|证据(?:显示|表明)|可见文案证据)\s*[：:，,]?\s*/u, '')
  .trim();

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
    return {
      index: marketingMappings.length + index,
      kind: 'verified-fact',
      item,
      sellingPointId: text(item.factId || item.id),
      factId: text(item.factId || item.id),
      slotId: text(item.slotId),
      role: text(item.slotRole) || 'specification',
      explicitText: displayCopy(item.replacementText || item.displayText)
        || [label, value].filter(Boolean).join('\n'),
      title: label,
      description: value,
    };
  }).filter(mapping => mapping.factId && mapping.explicitText);
  // A specification page is a closed factual contract. Never let a marketing
  // selling point spill into a parameter cell just because both have text.
  const mappings = text(page.pageType).toLowerCase() === 'specification'
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
        replacementText,
        positionInstruction: `保持参考图1中第 ${index + 1} 个${mapping.role === 'headline' ? '标题' : '说明文字'}的位置和排版层级`,
      }];
    });
  }

  const plan = [];
  for (const slot of slots) {
    const exact = mappings.filter(mapping => mapping.slotId === slot.slotId);
    const roleMatches = mappings.filter(mapping => (
      !mapping.slotId
      && mapping.role === slot.role
      && !usedUnslottedMappings.has(mapping.index)
    ));
    // An unassigned competitor text slot is intentionally omitted from the
    // replacement plan. The final prompt already instructs the image model to
    // erase such text; filling it with an arbitrary selling point caused the
    // same phrase to be repeated across comparison labels and body copy.
    const candidates = exact.length ? exact : roleMatches.slice(0, 1);
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
    plan.push({
      order: plan.length + 1,
      sellingPointIds: [...new Set(usedIds.filter(Boolean))],
      factIds: [...new Set(candidates.map(mapping => mapping.factId).filter(Boolean))],
      sourceKind: candidates.some(mapping => mapping.kind === 'verified-fact')
        ? 'verified-fact'
        : 'selling-point',
      role: slot.role,
      sourceText: slot.sourceText,
      replacementText,
      slot,
    });
  }
  return plan;
}

const safePageAnalysis = value => {
  const page = object(value);
  const productInstances = array(page.productInstances || page.productRegions);
  const productRegion = object(page.productRegion || page.blankProductRegion || productInstances[0]);
  return {
    pageType: text(page.pageType || page.type) || 'marketing',
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
    };
  });
  return {
    pageType: page.pageType,
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
  return {
    order: Number(source.order) || undefined,
    sellingPointIds: array(source.sellingPointIds).map(text).filter(Boolean),
    factIds: array(source.factIds).map(text).filter(Boolean),
    sourceKind: text(source.sourceKind),
    role: text(source.role),
    replacementText: text(source.replacementText),
    positionInstruction: text(source.positionInstruction),
    slot: safePromptSlot(
      source.slot,
      text(source.slotId) || `copy-${Number(source.order) || 1}`,
    ),
  };
});

export function buildBlankDetailPrompt({
  pageAnalysis,
  mappedSellingPoints = [],
  pageIndex = 0,
  useCharacterReference = false,
} = {}) {
  const page = safePageAnalysis(pageAnalysis);
  return [
    `以参考图1为版式母版，生成第 ${pageIndex + 1} 张电商详情页底图。`,
    `目标尺寸继承竞品原图：${page.sourceWidth || '自动'} × ${page.sourceHeight || '自动'} 像素；不得改成统一画幅。`,
    `视觉反推规格：${JSON.stringify(page)}`,
    `后续确定性排版将使用的我方卖点（现在不要画字）：${JSON.stringify(mappedSellingPoints)}`,
    '参考图1只提供构图、版式、场景、光线、色彩节奏、人物位置和各视觉区域坐标；尽量保持相同的空间关系与视觉层级。',
    '必须彻底移除参考图1中的竞品产品、竞品人物身份、全部竞品文案、品牌和 Logo；不得把这些元素残留、变形或重绘回来。',
    '必须按 productRegion 留出真实、干净、可合成的商品空间；保留接触面、投影条件和正确的前后遮挡层。该区域不得出现任何产品、产品轮廓、包装、占位模型或水印。',
    '整张图暂时不得出现任何可读文字、乱码、字母、数字、商标或 Logo；我方卖点和品牌稍后由程序精确叠加到原版式槽位。',
    useCharacterReference
      ? '参考图2及之后的人物图只用于替换竞品人物身份：锁定同一人的脸部、发型和服装特征；人物的位置、姿势、视线和遮挡关系服从竞品版式。'
      : '不使用人物身份参考；若规格 hasPerson=false，禁止凭空增加人物。',
    '输出单张完整成图，不要解释。',
  ].join('\n');
}

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
} = {}) {
  const page = safePageAnalysis(pageAnalysis);
  const promptPage = promptSafePageAnalysis(page);
  const productCount = Math.max(1, Number(productImageCount) || 1);
  const productRange = productCount === 1 ? '参考图2' : `参考图2至参考图${productCount + 1}`;
  const brandReferenceIndex = productCount + 2;
  const evidenceStart = brandReferenceIndex + (hasBrandLogoReference ? 1 : 0);
  const evidenceEnd = evidenceStart + Math.max(0, Number(ownEvidenceReferenceCount) || 0) - 1;
  const characterStart = evidenceEnd + 1;
  const copyPlan = buildDetailCopyReplacementPlan({
    pageAnalysis: page,
    mappedSellingPoints,
    mappedFacts,
  });
  const safeCopyPlan = promptSafeCopyPlan(copyPlan);
  const brandPlan = {
    brandIdentity: object(ownBrandIdentity),
    sourceSlots: promptPage.brandSlots,
    logoReference: hasBrandLogoReference ? `参考图${brandReferenceIndex}` : '',
  };
  return [
    `直接编辑参考图1，生成第 ${pageIndex + 1} 张可立即交付的电商详情页最终图。这次模型输出就是最终成品，后续不会再叠加产品、文字或 Logo。`,
    `目标尺寸继承竞品原图：${page.sourceWidth || '自动'} × ${page.sourceHeight || '自动'} 像素；不得改成统一画幅。`,
    `视觉反推规格（仅含版式坐标，不含任何竞品原文）：${JSON.stringify(promptPage)}`,
    `必须逐字生成的文案替换清单：${JSON.stringify(safeCopyPlan)}`,
    `必须完成的品牌与 Logo 替换清单：${JSON.stringify(brandPlan)}`,
    `系统已从“我的详情”自动挑选与本页角度最匹配的产品参考：${JSON.stringify(selectedProductViews)}`,
    '参考图1是需要直接修改的竞品原图，不是只供自由发挥的风格参考。锁定它的画布、构图、背景、区域边界、人物姿势、商品位置、文字位置与视觉层级；除明确要求替换的区域外，不得重新设计页面。',
    `${productRange}是同一款我方真实产品的角度参考。逐个用我方产品替换参考图1中 productInstances 列出的全部竞品产品实例；为每个实例选择最接近的我方角度，保持我方产品真实结构、材质、颜色、比例和产品自身标识，并匹配原位置的透视、接触面、阴影、反射、肢体交互与前景遮挡。不得遗漏重复出现的小产品或混入竞品外形。`,
    hasBrandLogoReference
      ? `参考图${brandReferenceIndex}是我方真实 Logo 参考。删除参考图1全部竞品 Logo 和品牌字样，再在 brandSlots 指定的原位置生成该我方 Logo；保持 Logo 的拼写、图形比例和识别特征，不得用普通文字假冒 Logo。`
      : `删除参考图1全部竞品 Logo 和品牌字样，并根据 brandIdentity 在 brandSlots 指定的原位置生成我方品牌；品牌名必须逐字正确。若 brandIdentity 为空，则该位置保持干净，不得保留或猜测竞品品牌。`,
    ownEvidenceReferenceCount > 0
      ? `参考图${evidenceStart}${evidenceEnd > evidenceStart ? `至参考图${evidenceEnd}` : ''}是“我的详情”中与本页文案直接对应的事实证据页。参数、型号、数字、单位、正负号和大小写必须同时服从这些证据图与文案替换清单；不得从竞品原图抄回任何参数。`
      : '本页没有额外事实证据图；只能生成文案替换清单中已经核验的文字，其它竞品文字必须删除，禁止猜测补全。',
    page.pageType === 'specification'
      ? '本页是严格参数页：每个 replacementText 都是不可改写的事实。禁止把营销卖点填入参数栏；没有 mappedFacts 的竞品参数栏必须连标签和值一起删除并自然修复背景。'
      : '本页是营销/场景详情页：只能使用已经映射的我方卖点，不得擅自添加型号、功率、电压、认证或效果数据。',
    '先彻底擦除参考图1的全部竞品文案，再依据“文案替换清单”在对应 slot 原位置直接生成 replacementText。中文必须逐字一致，不得改写、缩写、增字、漏字、重复、错别字或乱码；保持原槽位的字号层级、对齐、颜色和留白，不得让新旧文字重叠。没有分配替换文案的竞品文字槽必须删除并自然修复背景。',
    '展示文案中禁止出现“图片显示”“图片明确标注”“文案提到”“证据表明”等分析过程用语。不得把 sellingPointId、坐标、JSON、提示词或任何内部说明画进图片。',
    '必须彻底移除竞品产品、包装、品牌、Logo、文案、水印与竞品独有主张；不得残留、变形、混合或臆造竞品元素，也不得生成额外产品。',
    useCharacterReference
      ? `参考图${characterStart}及之后只用于替换竞品人物身份：保持同一人的脸部、发型和服装特征；人物的位置、姿势、视线和遮挡关系服从参考图1。`
      : '不使用人物身份参考；若规格 hasPerson=false，禁止凭空增加人物；若原图有人物，也不得保留可识别的竞品人物身份。',
    '只允许出现替换清单中的我方文案、我方品牌/Logo，以及我方产品自身不可分离的真实标识；不得出现其它文字、乱码、商标或水印。',
    '输出单张完整最终图，不要解释，不要输出中间底图、无字底图、蒙版或排版稿。',
  ].join('\n');
}

export function parseFinalDetailValidationResponse(value) {
  const parsed = object(parseJsonPayload(value, '最终详情质检结果'));
  return {
    ...parsed,
    passed: parsed.passed === true,
    copyExact: parsed.copyExact === true,
    brandCorrect: parsed.brandCorrect === true,
    productCorrect: parsed.productCorrect === true,
    competitorRemoved: parsed.competitorRemoved === true,
    gibberishDetected: parsed.gibberishDetected === true,
    missingTexts: array(parsed.missingTexts).map(text).filter(Boolean),
    wrongTexts: array(parsed.wrongTexts).map(text).filter(Boolean),
    unexpectedTexts: array(parsed.unexpectedTexts).map(text).filter(Boolean),
    summary: text(parsed.summary),
  };
}

export function buildFinalDetailValidationInstruction({
  pageAnalysis,
  copyPlan = [],
  ownBrandIdentity = {},
} = {}) {
  const page = safePageAnalysis(pageAnalysis);
  const safeCopyPlan = promptSafeCopyPlan(copyPlan);
  return [
    '你是电商详情最终交付质检员。参考图1是待验收成图；其余参考图依次是我方产品、Logo 或事实证据，只能用于比对。',
    `页面类型：${page.pageType}。必须逐字出现的文案清单：${JSON.stringify(safeCopyPlan)}。我方品牌：${JSON.stringify(object(ownBrandIdentity))}。`,
    '所有不在上述我方文案与品牌白名单中的可读内容，都必须按竞品残留或模型臆造内容报告。',
    '逐项检查：1) replacementText 是否逐字正确，数字、型号、单位、正负号与大小写均一致；2) 是否出现乱码、伪字、重复卖点、提示词或 JSON；3) 品牌/Logo 是否正确且无竞品残留；4) 产品是否仍是我方产品而非混合竞品外形。',
    '没有列入替换清单的新增参数或功效一律视为 unexpectedTexts。参数页只要有一个错误数字、单位、型号或乱码，passed 必须为 false。',
    'passed 只有在 copyExact、brandCorrect、productCorrect、competitorRemoved 全为 true 且 gibberishDetected=false 时才能为 true。只输出符合 Schema 的 JSON。',
  ].join('\n');
}

export function buildFinalDetailRepairPrompt({
  pageAnalysis,
  copyPlan = [],
  ownBrandIdentity = {},
  validation = {},
  evidenceReferenceCount = 0,
  hasBrandLogoReference = false,
} = {}) {
  const page = safePageAnalysis(pageAnalysis);
  const safeCopyPlan = promptSafeCopyPlan(copyPlan);
  const evidenceEnd = 1 + Math.max(0, Number(evidenceReferenceCount) || 0);
  return [
    '直接编辑参考图1，输出修复后的完整最终详情图。参考图1中的产品、人物、背景、构图、颜色、阴影、边界和全部正确区域都必须保持不变，只修复文字与品牌问题。',
    `页面类型：${page.pageType}。质检发现：${JSON.stringify(object(validation))}。`,
    `必须逐字生成的最终文案：${JSON.stringify(safeCopyPlan)}。我方品牌：${JSON.stringify(object(ownBrandIdentity))}。`,
    evidenceReferenceCount > 0
      ? `参考图2${evidenceEnd > 2 ? `至参考图${evidenceEnd}` : ''}是我方事实证据，必须据此核对型号、数字、单位、符号和品牌。`
      : '没有额外事实证据图，严禁在清单之外猜测或新增文字。',
    hasBrandLogoReference
      ? `参考图${evidenceEnd + 1}是我方真实 Logo；需要修复品牌时必须保持其拼写、图形比例和识别特征。`
      : '没有独立 Logo 参考时只允许使用品牌清单中的准确名称，不得臆造 Logo 图形。',
    '先擦除所有错误文字、乱码、重复文案、竞品参数和竞品品牌，再在原槽位写入清单中的 replacementText。没有替换项的竞品文字区域保持干净。',
    '中文、数字、型号、单位、正负号、斜杠和大小写必须逐字一致；不得解释，不得输出蒙版或中间稿，只输出单张完整图片。',
  ].join('\n');
}

export function buildProductComposePrompt({ pageAnalysis, mappedSellingPoints = [], productImageCount = 1 } = {}) {
  const page = safePageAnalysis(pageAnalysis);
  return [
    '参考图1是已经生成好的无文字详情底图；其余参考图全部是我方真实产品。',
    `只把我方产品自然合成到参考图1预留的 productRegion 中（产品参考共 ${productImageCount} 张）。`,
    `区域与遮挡规格：${JSON.stringify(page.productRegion)}；前景遮挡：${page.foregroundOcclusion || '按底图现有关系保持' }。`,
    '严格保持底图的构图、人物身份、姿势、环境、光线、色彩和所有非商品像素；匹配透视、真实尺寸感、接触阴影与反射。',
    '保留我方产品的真实结构、材质、颜色和标识，不得混入竞品产品、包装或品牌元素。',
    `后续程序将重新叠加这些我方卖点，现在不要生成文字：${JSON.stringify(mappedSellingPoints)}`,
    '不得出现任何新增可读文字、乱码、水印或额外产品。输出单张完整成图，不要解释。',
  ].join('\n');
}
