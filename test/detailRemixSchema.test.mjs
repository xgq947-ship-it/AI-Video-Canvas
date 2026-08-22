import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA,
  DETAIL_REMIX_OWN_KNOWLEDGE_OUTPUT_SCHEMA,
  DETAIL_REMIX_FINAL_VALIDATION_OUTPUT_SCHEMA,
  DETAIL_REMIX_MARKETING_MODE,
  DETAIL_REMIX_STRICT_PARAMETER_MODE,
  activeDetailRemixInputRefs,
  buildProductSheetInstruction,
  describeDetailRemixProductSheet,
  isDetailRemixCopyOnlyPage,
  normalizeDetailRemixProductSheet,
  assignDetailRemixInputPort,
  buildCompetitorPageInstruction,
  buildDetailCopyReplacementPlan,
  buildDetailRemixInputMapping,
  buildDetailScenePlatePrompt,
  buildFinalDetailPrompt,
  buildFinalDetailRepairPrompt,
  buildFinalDetailValidationInstruction,
  buildOwnSellingPointsInstruction,
  classifyFinalDetailValidation,
  createDetailRemixNodeData,
  detailRemixAllowsStrictParameterMode,
  detailRemixInputFingerprint,
  detailRemixPageMode,
  canonicalDetailRemixFactField,
  isDetailRemixStrictParameterPage,
  markDetailRemixDependentsStale,
  normalizeDetailRemixGenerationMode,
  parseCompetitorPageResponse,
  parseFinalDetailValidationResponse,
  parseOwnSellingPointsResponse,
  syncDetailRemixInputRefs,
  validateDetailRemixPreflight,
} from '../shared/detailRemix.js';

const image = (id, x, y, url = `/${id}.png`) => ({ id, type: 'Image', x, y, resultUrl: url });

test('新节点人物参考默认关闭；关闭仍保留选择，active refs 与 fingerprint 排除人物图', () => {
  const empty = createDetailRemixNodeData();
  assert.equal(empty.schemaVersion, 1);
  assert.equal(empty.lockProductIdentity, true);
  assert.equal(empty.generationMode, 'identity-locked');
  assert.deepEqual(empty.inputRefs.characterReference, { enabled: false, nodeIds: [] });
  assert.equal(createDetailRemixNodeData({ lockProductIdentity: false }).lockProductIdentity, false);
  assert.equal(createDetailRemixNodeData({ lockProductIdentity: false }).generationMode, 'direct-replacement');
  assert.equal(
    createDetailRemixNodeData({ generationMode: 'same-mold-recolor' }).generationMode,
    'same-mold-recolor',
  );
  assert.equal(normalizeDetailRemixGenerationMode('invalid', false), 'direct-replacement');

  const off = createDetailRemixNodeData({
    inputRefs: { characterReference: { enabled: false, nodeIds: ['person-1'] } },
  });
  assert.deepEqual(off.inputRefs.characterReference.nodeIds, ['person-1']);
  assert.deepEqual(activeDetailRemixInputRefs(off).characterReference.activeNodeIds, []);
  assert.doesNotMatch(detailRemixInputFingerprint(off), /person-1/);

  const on = createDetailRemixNodeData({
    inputRefs: { characterReference: { enabled: true, nodeIds: ['person-1'] } },
  });
  assert.deepEqual(activeDetailRemixInputRefs(on).characterReference.activeNodeIds, ['person-1']);
  assert.match(detailRemixInputFingerprint(on), /person-1/);
});

test('早期草稿只有人物 nodeIds 时按已启用迁移，非法数组与重复值被归一化', () => {
  const migrated = createDetailRemixNodeData({
    inputRefs: {
      competitorNodeIds: ['c1', 'c1', '', null],
      ownNodeIds: ['o1'],
      characterNodeIds: ['p1'],
      productReferenceNodeIds: ['sku1', 'sku1'],
    },
  });
  assert.deepEqual(migrated.inputRefs.competitorDetailNodeIds, ['c1']);
  assert.deepEqual(migrated.inputRefs.ownDetailNodeIds, ['o1']);
  assert.deepEqual(migrated.inputRefs.characterReference, { enabled: true, nodeIds: ['p1'] });
  assert.deepEqual(migrated.inputRefs.productNodeIds, ['sku1']);
});

test('文件夹导入与批量队列进度可持久化 roundtrip，非法计数会被收敛', () => {
  const state = createDetailRemixNodeData({
    folderImports: {
      competitor: {
        folderName: '竞品详情', status: 'completed', total: 12, uploaded: 12, failed: 0,
        nodeIds: ['c1', 'c1', 'c2'],
      },
      own: {
        folderName: '我的详情', status: 'partial_failed', total: 10, uploaded: 9, failed: 99,
        nodeIds: ['o1'],
      },
    },
    queueProgress: {
      ownKnowledge: { status: 'completed', total: 10, completed: 12, failed: 0, sellingPointCount: 8 },
      competitor: { status: 'processing', total: 12, completed: 4, failed: 1, currentIndex: 5 },
    },
  });
  assert.deepEqual(state.folderImports.competitor.nodeIds, ['c1', 'c2']);
  assert.equal(state.folderImports.own.failed, 10);
  assert.equal(state.queueProgress.ownKnowledge.completed, 10);
  assert.equal(state.queueProgress.ownKnowledge.sellingPointCount, 8);
  assert.equal(state.queueProgress.competitor.currentIndex, 5);
  assert.deepEqual(createDetailRemixNodeData(JSON.parse(JSON.stringify(state))), state);
});

test('控制节点页面快照保留分析与结果节点 ID，但不持久化嵌套媒体 URL', () => {
  const state = createDetailRemixNodeData({
    analysis: { pages: [{
      index: 0,
      plateNodeId: 'plate-1',
      compositeNodeId: 'composite-1',
      sourceImage: '/library/projects/old/images/source.png',
      rawPlateUrl: '/library/projects/old/images/raw.png',
      plateUrl: '/library/projects/old/images/plate.png',
      compositeUrl: '/library/projects/old/images/composite.png',
      analysis: { layoutSpec: '左文右商品' },
    }] },
  });
  const page = state.analysis.pages[0];
  assert.equal(page.plateNodeId, 'plate-1');
  assert.equal(page.compositeNodeId, 'composite-1');
  assert.equal(page.analysis.layoutSpec, '左文右商品');
  assert.equal(page.plateReady, true);
  assert.equal(page.compositeReady, true);
  assert.equal(page.sourceImage, undefined);
  assert.equal(page.rawPlateUrl, undefined);
  assert.equal(page.plateUrl, undefined);
  assert.equal(page.compositeUrl, undefined);
});

test('显式端口映射决定角色且保持 parentIds 稳定顺序，断边不会靠数组位置复活角色', () => {
  const controller = {
    id: 'control',
    type: 'Detail Page Remix',
    parentIds: ['own-2', 'comp-1', 'own-1', 'person'],
    detailRemix: createDetailRemixNodeData({
      inputRefs: { characterReference: { enabled: false, nodeIds: [] } },
    }),
  };
  const mapping = {
    'comp-1': 'competitor-detail',
    'own-1': 'own-detail',
    'own-2': 'own-detail',
    person: 'character-reference',
  };
  const synced = syncDetailRemixInputRefs(controller, mapping);
  assert.deepEqual(synced.detailRemix.inputRefs.competitorDetailNodeIds, ['comp-1']);
  assert.deepEqual(synced.detailRemix.inputRefs.ownDetailNodeIds, ['own-2', 'own-1']);
  assert.deepEqual(synced.detailRemix.inputRefs.characterReference, { enabled: false, nodeIds: ['person'] });
  assert.deepEqual(buildDetailRemixInputMapping(synced.detailRemix.inputRefs), {
    'comp-1': 'competitor-detail',
    'own-2': 'own-detail',
    'own-1': 'own-detail',
    person: 'character-reference',
  });

  const reassigned = assignDetailRemixInputPort(synced, image('sku', 0, 0), 'product-reference');
  assert.deepEqual(reassigned.detailRemix.inputRefs.productNodeIds, ['sku']);

  const completedWithDormantCharacter = {
    ...synced,
    parentIds: ['comp-1', 'own-2', 'own-1'],
    detailRemix: createDetailRemixNodeData({ ...synced.detailRemix, status: 'completed' }),
  };
  const disconnectedWhileOff = syncDetailRemixInputRefs(completedWithDormantCharacter, {
    'comp-1': 'competitor-detail',
    'own-2': 'own-detail',
    'own-1': 'own-detail',
  });
  assert.equal(disconnectedWhileOff.detailRemix.status, 'completed');
  assert.notEqual(disconnectedWhileOff.detailRemix.needsRegeneration, true);
});

test('preflight 只要求两组详情，产品补充图可选，并兼容人物开关', () => {
  const nodes = [image('c', 0, 0), image('o', 0, 500), image('p', 800, 0), image('sku', 800, 500)];
  const base = createDetailRemixNodeData({
    inputRefs: {
      competitorDetailNodeIds: ['c'],
      ownDetailNodeIds: ['o'],
      characterReference: { enabled: false, nodeIds: ['p'] },
      productNodeIds: ['sku'],
    },
  });
  const off = validateDetailRemixPreflight(base, nodes, { phase: 'final' });
  assert.equal(off.ok, true);
  assert.deepEqual(off.refs.characterNodeIds, []);

  const onMissing = validateDetailRemixPreflight(createDetailRemixNodeData({
    ...base,
    inputRefs: { ...base.inputRefs, characterReference: { enabled: true, nodeIds: [] } },
  }), nodes, { phase: 'final' });
  assert.equal(onMissing.ok, false);
  assert.match(onMissing.error, /人物参考/);

  const productMissing = validateDetailRemixPreflight(createDetailRemixNodeData({
    ...base,
    inputRefs: { ...base.inputRefs, productNodeIds: [] },
  }), nodes, { phase: 'final' });
  assert.equal(productMissing.ok, true);
  assert.deepEqual(productMissing.refs.productNodeIds, []);

  const sameMoldMissingProduct = validateDetailRemixPreflight(createDetailRemixNodeData({
    ...base,
    generationMode: 'same-mold-recolor',
    inputRefs: { ...base.inputRefs, productNodeIds: [] },
  }), nodes, { phase: 'final', generationMode: 'same-mold-recolor' });
  assert.equal(sameMoldMissingProduct.ok, false);
  assert.match(sameMoldMissingProduct.error, /同模换色.*产品参考图/);

  const composeNeedsOnlyProduct = validateDetailRemixPreflight(createDetailRemixNodeData({
    inputRefs: {
      competitorDetailNodeIds: ['deleted-competitor'],
      ownDetailNodeIds: ['deleted-own-detail'],
      characterReference: { enabled: true, nodeIds: [] },
      productNodeIds: ['sku'],
    },
  }), nodes, { phase: 'composition' });
  assert.equal(composeNeedsOnlyProduct.ok, true);
  assert.deepEqual(composeNeedsOnlyProduct.refs.characterNodeIds, []);
});

test('结构化识图解析产品角度与竞品选角，同时禁止编造竞品主张', () => {
  const points = parseOwnSellingPointsResponse('```json\n{"productViews":[{"sourceImageIndex":0,"cropRegion":{"x":0.1,"y":0.2,"width":0.5,"height":0.6},"viewAngle":"front"}],"sellingPoints":[{"headline":"深层舒缓","supportCopy":"可见文案证据"}]}\n```');
  assert.deepEqual({
    id: points.sellingPoints[0].id,
    title: points.sellingPoints[0].title,
    description: points.sellingPoints[0].description,
    sourceImageIndexes: points.sellingPoints[0].sourceImageIndexes,
  }, {
    id: 'sp-1', title: '深层舒缓', description: '可见文案证据', sourceImageIndexes: [],
  });
  assert.equal(points.productViews[0].viewAngle, 'front');
  const page = parseCompetitorPageResponse(JSON.stringify({
    page: { hasPerson: true, mappedSellingPoints: [{ sellingPointId: 'sp-1' }], productRegion: { x: 0.5 } },
  }));
  assert.equal(page.page.hasPerson, true);
  assert.equal(page.page.productRegion.x, 0.5);
  const productSurfaceBrand = parseCompetitorPageResponse(JSON.stringify({
    page: { brandSlots: [{ visualDescription: '产品皮革表面白色压印 Logo' }] },
  }));
  assert.equal(productSurfaceBrand.page.brandSlots[0].placement, 'product_surface');
  assert.throws(() => parseCompetitorPageResponse('not json'), /不是有效 JSON/);
  assert.equal(parseCompetitorPageResponse('{"page":{"hasPerson":false,},}').page.hasPerson, false);
  assert.throws(
    () => parseCompetitorPageResponse('{"page":{"hasPerson":false "copySlots":[]}}'),
    error => error?.code === 'DETAIL_REMIX_JSON_FORMAT',
  );

  assert.match(buildOwnSellingPointsInstruction({ imageCount: 2 }), /禁止编造/);
  assert.match(buildOwnSellingPointsInstruction({ imageCount: 2 }), /Logo 在哪张图/);
  assert.match(buildOwnSellingPointsInstruction({ imageCount: 2 }), /productViews/);
  const competitorInstruction = buildCompetitorPageInstruction({
    ownSellingPoints: points.sellingPoints,
    ownProductViews: [{ id: 'pv-1', viewAngle: 'front' }],
  });
  assert.match(competitorInstruction, /不得新造参数或功效/);
  assert.match(competitorInstruction, /selectedProductViewIds/);
  assert.match(competitorInstruction, /product_surface.*只用于清除竞品/);
  assert.match(competitorInstruction, /竞品产品.*材质、纹理、缝线/);
  assert.doesNotMatch(competitorInstruction, /evidenceSummary|sourceNodeIds/);
  assert.equal(DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA.additionalProperties, false);
  assert.ok(DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA.properties.page.required.includes('copySlots'));
  assert.ok(
    DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA.properties.page.properties.brandSlots.items.required
      .includes('placement'),
  );
  assert.equal(DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA.properties.page.properties.copySlots.items.additionalProperties, false);
  assert.ok(DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA.properties.page.required.includes('mappedFacts'));
  assert.ok(
    DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA.properties.page.properties.mappedSellingPoints.items.required
      .includes('replacementText'),
  );
  assert.ok(DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA.properties.page.properties.mappedFacts.items.required.includes('displayPart'));
  assert.deepEqual(
    DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA.properties.page.properties.mappedFacts.items.properties.displayPart.enum,
    ['label', 'value'],
  );
  assert.ok(DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA.properties.page.required.includes('pageMode'));
  assert.ok(DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA.properties.page.properties.copySlots.items.required.includes('field'));
  assert.ok(DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA.properties.page.properties.copySlots.items.required.includes('parameterPart'));
  assert.ok(DETAIL_REMIX_OWN_KNOWLEDGE_OUTPUT_SCHEMA.required.includes('verifiedFacts'));
  assert.ok(DETAIL_REMIX_OWN_KNOWLEDGE_OUTPUT_SCHEMA.properties.verifiedFacts.items.required.includes('evidenceRegion'));
  assert.equal(DETAIL_REMIX_FINAL_VALIDATION_OUTPUT_SCHEMA.additionalProperties, false);
  assert.ok(DETAIL_REMIX_FINAL_VALIDATION_OUTPUT_SCHEMA.required.includes('parameterAlignmentCorrect'));
  assert.ok(DETAIL_REMIX_FINAL_VALIDATION_OUTPUT_SCHEMA.required.includes('unsupportedStrictFactsAbsent'));
  assert.ok(DETAIL_REMIX_FINAL_VALIDATION_OUTPUT_SCHEMA.required.includes('characterHairstyleCorrect'));
  assert.ok(DETAIL_REMIX_FINAL_VALIDATION_OUTPUT_SCHEMA.required.includes('characterOutfitCorrect'));
  assert.ok(DETAIL_REMIX_FINAL_VALIDATION_OUTPUT_SCHEMA.required.includes('characterIssues'));
  assert.ok(DETAIL_REMIX_FINAL_VALIDATION_OUTPUT_SCHEMA.required.includes('layoutHierarchyCorrect'));
  assert.ok(DETAIL_REMIX_FINAL_VALIDATION_OUTPUT_SCHEMA.required.includes('logoPresentationCorrect'));
  assert.ok(DETAIL_REMIX_FINAL_VALIDATION_OUTPUT_SCHEMA.required.includes('visualPolishCorrect'));
  assert.ok(DETAIL_REMIX_FINAL_VALIDATION_OUTPUT_SCHEMA.required.includes('layoutIssues'));
});

test('参数页只使用有来源的精确事实，营销卖点和无证据竞品参数不会填入槽位', () => {
  const parsed = parseOwnSellingPointsResponse(JSON.stringify({
    verifiedFacts: [{
      id: 'fact-1',
      field: 'power',
      label: '额定功率',
      value: '16W',
      normalizedValue: '16W',
      displayText: '额定功率\n16W',
      evidenceImageIndex: 2,
      evidenceRegion: { x: 0.1, y: 0.5, width: 0.4, height: 0.1 },
      confidence: 0.99,
    }],
    sellingPoints: [{ id: 'sp-1', title: '模拟虎口抓捏', description: '舒缓肩颈' }],
  }));
  assert.equal(parsed.verifiedFacts[0].value, '16W');

  const pageAnalysis = {
    pageType: 'specification',
    pageMode: DETAIL_REMIX_STRICT_PARAMETER_MODE,
    strictPageCategory: 'electrical',
    copySlots: [
      { slotId: 'power-label', role: 'parameterLabel', field: 'power', parameterPart: 'label', sourceText: '工作功率', x: 0.1, y: 0.1, width: 0.3, height: 0.05 },
      { slotId: 'power-value', role: 'parameterValue', field: 'power', parameterPart: 'value', sourceText: '20W', x: 0.5, y: 0.1, width: 0.2, height: 0.05 },
      { slotId: 'capacity-label', role: 'parameterLabel', field: 'battery_capacity', parameterPart: 'label', sourceText: '电池容量', x: 0.1, y: 0.2, width: 0.3, height: 0.05 },
      { slotId: 'capacity-value', role: 'parameterValue', field: 'battery_capacity', parameterPart: 'value', sourceText: '2500mAh', x: 0.5, y: 0.2, width: 0.2, height: 0.05 },
    ],
  };
  const evidence = [{
    evidenceImageIndex: 2,
    evidenceImageId: 'own-parameter-page',
    evidenceRegion: { x: 0.1, y: 0.5, width: 0.4, height: 0.1 },
    confidence: 0.99,
    sourceText: '额定功率\n16W',
  }];
  const plan = buildDetailCopyReplacementPlan({
    pageAnalysis,
    mappedSellingPoints: [{ id: 'sp-1', slotId: 'power-label', title: '模拟虎口抓捏' }],
    mappedFacts: [
      { ...parsed.verifiedFacts[0], evidence, factId: 'fact-1', slotId: 'power-label', slotRole: 'parameterLabel', displayPart: 'label', replacementText: '额定功率' },
      { ...parsed.verifiedFacts[0], evidence, factId: 'fact-1', slotId: 'power-value', slotRole: 'parameterValue', displayPart: 'value', replacementText: '16W' },
    ],
  });
  assert.deepEqual(plan.map(item => [item.originalText, item.replacementText, item.sourceField, item.targetPart]), [
    ['工作功率', '额定功率', 'power', 'label'],
    ['20W', '16W', 'power', 'value'],
  ]);
  assert.equal(plan[0].evidenceImageId, 'own-parameter-page');
  assert.deepEqual(plan[1].targetRegion, { x: 0.5, y: 0.1, width: 0.2, height: 0.05 });
  assert.doesNotMatch(JSON.stringify(plan), /模拟虎口|2500mAh/);

  const prompt = buildFinalDetailPrompt({
    pageAnalysis,
    mappedSellingPoints: [{ id: 'sp-1', slotId: 'power-label', title: '模拟虎口抓捏' }],
    mappedFacts: [
      { ...parsed.verifiedFacts[0], evidence, factId: 'fact-1', slotId: 'power-label', slotRole: 'parameterLabel', displayPart: 'label', replacementText: '额定功率' },
      { ...parsed.verifiedFacts[0], evidence, factId: 'fact-1', slotId: 'power-value', slotRole: 'parameterValue', displayPart: 'value', replacementText: '16W' },
    ],
    ownEvidenceReferenceCount: 1,
    productImageCount: 1,
  });
  assert.match(prompt, /STRICT_PARAMETER_MODE/);
  assert.match(prompt, /"replacementText":"额定功率"/);
  assert.match(prompt, /"replacementText":"16W"/);
  assert.match(prompt, /"evidenceImageId":"own-parameter-page"/);
  assert.match(prompt, /事实证据页/);
  assert.doesNotMatch(prompt, /"replacementText":"模拟虎口抓捏"/);
});

test('参数、型号、配件、电气与装箱页面自动进入 STRICT_PARAMETER_MODE', () => {
  for (const pageType of ['参数页', '规格页', '型号页', '配件页', '电气参数页', '包装清单页', 'packing-list']) {
    assert.equal(detailRemixPageMode({ pageType }), DETAIL_REMIX_STRICT_PARAMETER_MODE);
    assert.equal(isDetailRemixStrictParameterPage({ pageType }), true);
  }
  assert.equal(detailRemixPageMode({ pageType: 'marketing' }), 'MARKETING_MODE');
  assert.equal(canonicalDetailRemixFactField('rated_power', '额定功率'), 'power');
  assert.equal(canonicalDetailRemixFactField('', '充电输入'), 'charging_input');
});

test('只有文件夹最后两张允许参数模式，前序页面即使出现型号也锁定为营销页', () => {
  assert.equal(detailRemixAllowsStrictParameterMode(0, 22), false);
  assert.equal(detailRemixAllowsStrictParameterMode(19, 22), false);
  assert.equal(detailRemixAllowsStrictParameterMode(20, 22), true);
  assert.equal(detailRemixAllowsStrictParameterMode(21, 22), true);
  assert.equal(detailRemixAllowsStrictParameterMode(0, 1), true);
  assert.equal(detailRemixPageMode({
    pageType: '型号页',
    pageMode: DETAIL_REMIX_STRICT_PARAMETER_MODE,
    strictPageCategory: 'model',
    strictParameterModeEligible: false,
  }), DETAIL_REMIX_MARKETING_MODE);

  const earlyInstruction = buildCompetitorPageInstruction({ pageIndex: 1, pageCount: 22 });
  assert.match(earlyInstruction, /只有最后两张/);
  assert.match(earlyInstruction, /本页是第 2 张/);
  assert.match(earlyInstruction, /锁定为 MARKETING_MODE/);
  assert.match(earlyInstruction, /"pageMode":"MARKETING_MODE"/);
});

test('低置信度、无证据区域、字段错配或参数名值错栏都不能进入替换计划', () => {
  const basePage = {
    pageType: 'specification',
    pageMode: DETAIL_REMIX_STRICT_PARAMETER_MODE,
    copySlots: [
      { slotId: 'power-label', role: 'parameterLabel', field: 'power', parameterPart: 'label', sourceText: '功率', x: 0.1, y: 0.1, width: 0.2, height: 0.05 },
    ],
  };
  const baseFact = {
    id: 'fact-1', factId: 'fact-1', field: 'power', label: '额定功率', value: '16W',
    slotId: 'power-label', displayPart: 'label', replacementText: '额定功率',
  };
  assert.deepEqual(buildDetailCopyReplacementPlan({
    pageAnalysis: basePage,
    mappedFacts: [{
      ...baseFact,
      evidence: [{ evidenceImageId: 'own-1', evidenceRegion: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 }, confidence: 0.89 }],
    }],
  }), []);
  assert.deepEqual(buildDetailCopyReplacementPlan({
    pageAnalysis: basePage,
    mappedFacts: [{ ...baseFact, evidence: [{ evidenceImageId: 'own-1', confidence: 0.99 }] }],
  }), []);
  assert.deepEqual(buildDetailCopyReplacementPlan({
    pageAnalysis: basePage,
    mappedFacts: [{
      ...baseFact,
      field: 'voltage',
      evidence: [{ evidenceImageId: 'own-1', evidenceRegion: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 }, confidence: 0.99 }],
    }],
  }), []);
  assert.deepEqual(buildDetailCopyReplacementPlan({
    pageAnalysis: basePage,
    mappedFacts: [{
      ...baseFact,
      displayPart: 'value', replacementText: '16W',
      evidence: [{ evidenceImageId: 'own-1', evidenceRegion: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 }, confidence: 0.99 }],
    }],
  }), []);
});

test('苏泊尔参数证据页只生成已确认字段，2500mAh、1.2kg 与无证据清单保持删除', () => {
  const facts = [
    ['product_name', '产品名称', '苏泊尔颈部按摩器'],
    ['model', '型号', 'PJA4001 / PJA4101'],
    ['power', '额定功率', '16W'],
    ['voltage', '额定电压', 'DC 7.4V'],
    ['charging_input', '充电输入', 'DC 5V'],
    ['work_time', '单次工作时间', '10分钟'],
    ['interface', '接口', 'TYPE-C'],
    ['temperature', 'L档温度', '45°C ± 3°C'],
    ['temperature', 'H档温度', '50°C ± 3°C'],
  ].map(([field, label, value], index) => ({
    id: `fact-${index + 1}`,
    factId: `fact-${index + 1}`,
    field,
    label,
    value,
    evidence: [{
      evidenceImageIndex: 0,
      evidenceImageId: 'own-parameter-page',
      evidenceRegion: { x: 0.05, y: 0.05 + index * 0.08, width: 0.9, height: 0.06 },
      confidence: 0.99,
    }],
  }));
  const copySlots = facts.flatMap((fact, index) => [
    { slotId: `${fact.id}-label`, role: 'parameterLabel', field: fact.field, parameterPart: 'label', sourceText: `竞品${fact.label}`, x: 0.05, y: 0.05 + index * 0.08, width: 0.4, height: 0.03 },
    { slotId: `${fact.id}-value`, role: 'parameterValue', field: fact.field, parameterPart: 'value', sourceText: `竞品值${index + 1}`, x: 0.55, y: 0.05 + index * 0.08, width: 0.4, height: 0.03 },
  ]);
  copySlots.push(
    { slotId: 'unsupported-capacity', role: 'parameterValue', field: 'battery_capacity', parameterPart: 'value', sourceText: '2500mAh', x: 0.55, y: 0.8, width: 0.2, height: 0.03 },
    { slotId: 'unsupported-weight', role: 'parameterValue', field: 'weight', parameterPart: 'value', sourceText: '约1.2kg', x: 0.55, y: 0.84, width: 0.2, height: 0.03 },
    { slotId: 'unsupported-list', role: 'parameterLabel', field: 'package_contents', parameterPart: 'label', sourceText: '装箱清单', x: 0.05, y: 0.88, width: 0.3, height: 0.03 },
  );
  const mappedFacts = facts.flatMap(fact => [
    { ...fact, slotId: `${fact.id}-label`, slotRole: 'parameterLabel', displayPart: 'label', replacementText: fact.label },
    { ...fact, slotId: `${fact.id}-value`, slotRole: 'parameterValue', displayPart: 'value', replacementText: fact.value },
  ]);
  const plan = buildDetailCopyReplacementPlan({
    pageAnalysis: {
      pageType: '参数页',
      pageMode: DETAIL_REMIX_STRICT_PARAMETER_MODE,
      strictPageCategory: 'parameters',
      copySlots,
    },
    mappedSellingPoints: [{ id: 'sp-1', title: '深层按摩' }],
    mappedFacts,
  });
  assert.equal(plan.length, facts.length * 2);
  assert.deepEqual(plan.map(item => item.replacementText), facts.flatMap(fact => [fact.label, fact.value]));
  assert.ok(plan.every(item => item.evidenceImageId === 'own-parameter-page' && item.confidence === 0.99));
  assert.doesNotMatch(JSON.stringify(plan), /2500mAh|1\.2kg|装箱清单|深层按摩/);
});

test('成图质检与 AI 定向修复保持全 AI 路径，不产生本地叠字指令', () => {
  const validation = parseFinalDetailValidationResponse(JSON.stringify({
    passed: false,
    copyExact: false,
    brandCorrect: true,
    productCorrect: true,
    productGeometryPreserved: false,
    productAppearanceMatched: true,
    competitorProductBrandRemoved: true,
    logoCorrect: true,
    logoPresentationCorrect: false,
    layoutHierarchyCorrect: false,
    visualPolishCorrect: false,
    layoutIssues: ['主标题层级丢失', 'Logo 出现深色裁剪贴片'],
    productPlacementCorrect: true,
    parameterAlignmentCorrect: false,
    unsupportedStrictFactsAbsent: false,
    characterIdentityCorrect: true,
    characterHairstyleCorrect: false,
    characterOutfitCorrect: false,
    characterAccessoriesCorrect: true,
    characterIssues: ['仍保留竞品发型和服装'],
    competitorRemoved: true,
    gibberishDetected: true,
    missingTexts: ['额定功率 16W'],
    wrongTexts: ['额定功压 16V'],
    unexpectedTexts: ['2500mAh'],
    summary: '参数文字错误',
  }));
  assert.equal(validation.passed, false);
  assert.equal(validation.gibberishDetected, true);
  assert.equal(validation.characterOutfitCorrect, false);
  assert.deepEqual(validation.characterIssues, ['仍保留竞品发型和服装']);
  assert.equal(validation.layoutHierarchyCorrect, false);
  assert.equal(validation.productGeometryPreserved, false);
  assert.deepEqual(validation.layoutIssues, ['主标题层级丢失', 'Logo 出现深色裁剪贴片']);
  const instruction = buildFinalDetailValidationInstruction({
    pageAnalysis: { pageType: 'specification', forbiddenCompetitorElements: ['PHILIPS'] },
    copyPlan: [{ replacementText: '额定功率\n16W' }],
    ownBrandIdentity: { name: 'SUPOR 苏泊尔' },
    productReferenceCount: 1,
    hasBrandLogoReference: true,
    evidenceReferenceCount: 1,
    characterReferenceCount: 1,
  });
  assert.match(instruction, /参数页只要有一个错误数字/);
  assert.match(instruction, /参考图2是原始竞品页/);
  assert.match(instruction, /参考图6是人物完整造型参考/);
  assert.match(instruction, /只换脸、仍保留竞品发型或竞品衣服必须判失败/);
  assert.ok(DETAIL_REMIX_FINAL_VALIDATION_OUTPUT_SCHEMA.required.includes('productGeometryPreserved'));
  const repair = buildFinalDetailRepairPrompt({
    pageAnalysis: { pageType: 'specification' },
    copyPlan: [{ replacementText: '额定功率\n16W' }],
    validation,
    productReferenceCount: 1,
    evidenceReferenceCount: 1,
    hasBrandLogoReference: true,
    characterReferenceCount: 1,
  });
  assert.match(repair, /参考图2是原始竞品页/);
  assert.match(repair, /参考图3是我方产品身份的最高权威/);
  assert.match(repair, /参考图4.*事实证据/);
  assert.match(repair, /参考图5只提供页面图形槽所需的我方 Logo/);
  // 定向修复会重画品牌槽，字形约束必须跟着走，否则修一次多一个圆点。
  assert.match(repair, /重画品牌槽时必须逐字形复刻该参考图/);
  assert.match(repair, /参考图6是人物完整造型参考/);
  assert.match(repair, /恢复胶囊标签、主标题、副标题/);
  assert.match(repair, /禁止只换脸/);
  assert.doesNotMatch(repair, /本地|程序叠加/);
  const lockedRepair = buildFinalDetailRepairPrompt({
    pageAnalysis: { pageType: 'marketing' },
    validation: { productCorrect: false, logoPresentationCorrect: false },
    productReferenceCount: 1,
    identityLocked: true,
  });
  assert.match(lockedRepair, /本次修复不提供竞品原图/);
  assert.match(lockedRepair, /参考图2是我方产品身份的最高权威/);
  assert.match(lockedRepair, /参考中没有的标识必须删除/);
  assert.doesNotMatch(lockedRepair, /参考图2是原始竞品页/);
});

test('快速模式仍可单阶段生成，锁定模式先隔离竞品再只吃我方产品', () => {
  const analysis = {
    hasPerson: true,
    reversePrompt: '柔和家居光线，人物在左，商品区在右',
    productInstances: [
      { instanceId: 'product-1', x: 0.6, y: 0.4, width: 0.3, height: 0.4, material: '竞品鳄鱼皮纹理' },
      { instanceId: 'product-2', x: 0.1, y: 0.65, width: 0.2, height: 0.2 },
    ],
    copySlots: [
      { slotId: 'headline-1', role: 'headline', sourceText: '竞品原标题', x: 0.1, y: 0.08, width: 0.8, height: 0.1 },
      { slotId: 'support-1', role: 'support', sourceText: '竞品说明', x: 0.1, y: 0.2, width: 0.8, height: 0.12 },
    ],
    brandSlots: [
      { slotId: 'brand-1', sourceText: '竞品牌', placement: 'page_graphic', x: 0.05, y: 0.03, width: 0.2, height: 0.08 },
      { slotId: 'brand-on-product', sourceText: '竞品白色标', placement: 'product_surface', x: 0.62, y: 0.42, width: 0.08, height: 0.03 },
    ],
  };
  const mappedSellingPoints = [{
    id: 'sp-1',
    slotId: 'headline-1',
    slotRole: 'headline',
    title: '深层舒缓',
    description: '图片明确标注：双档热敷',
  }];
  const copyPlan = buildDetailCopyReplacementPlan({ pageAnalysis: analysis, mappedSellingPoints });
  assert.deepEqual(copyPlan.map(item => [item.sourceText, item.replacementText]), [
    ['竞品原标题', '深层舒缓'],
  ]);
  const off = buildFinalDetailPrompt({
    pageAnalysis: analysis,
    mappedSellingPoints,
    productImageCount: 1,
    selectedProductViews: [{ id: 'pv-1', viewAngle: 'front-left' }],
    ownBrandIdentity: { name: 'PHILIPS' },
    hasBrandLogoReference: true,
    useCharacterReference: false,
  });
  assert.match(off, /直接编辑参考图1/);
  assert.match(off, /目标尺寸继承竞品原图/);
  assert.match(off, /参考图2是同一款我方真实产品/);
  assert.match(off, /参考图3只允许用于 page_graphic 页面品牌槽/);
  assert.match(off, /front-left/);
  assert.match(off, /生成第.*最终图/);
  assert.match(off, /"originalText":"竞品原标题"/);
  assert.doesNotMatch(off, /竞品说明|竞品牌/);
  assert.match(off, /仅含版式坐标，不含任何竞品原文/);
  assert.match(off, /深层舒缓/);
  assert.doesNotMatch(off, /"replacementText":"双档热敷"/);
  assert.match(off, /PHILIPS/);
  assert.match(off, /productInstances 指定的空位/);
  assert.match(off, /"sourceSlots":\[\{"slotId":"brand-1","placement":"page_graphic"/);
  assert.match(off, /"removalOnlySlots":\[\{"slotId":"brand-on-product","placement":"product_surface"/);
  assert.match(off, /参考图相应位置没有就必须保持无标识/);
  assert.doesNotMatch(off, /稍后由程序/);
  assert.match(off, /不要输出中间底图/);
  const on = buildFinalDetailPrompt({
    pageAnalysis: analysis,
    productImageCount: 2,
    hasBrandLogoReference: true,
    useCharacterReference: true,
  });
  assert.match(on, /参考图2至参考图3/);
  assert.match(on, /参考图4只允许用于 page_graphic 页面品牌槽/);
  assert.match(on, /参考图5是人物完整外观的最高权威/);
  assert.match(on, /绝不允许只换脸后保留竞品人物的发型、衣服或配饰/);

  const scene = buildDetailScenePlatePrompt({
    pageAnalysis: analysis,
    pageIndex: 0,
    useCharacterReference: true,
  });
  assert.match(scene, /无产品场景底图/);
  assert.match(scene, /竞品产品本身不是参考素材/);
  assert.match(scene, /皮革颗粒、缝线、按钮细节/);
  assert.match(scene, /参考图2及之后是人物完整身份与造型的唯一依据/);
  assert.doesNotMatch(scene, /竞品鳄鱼皮纹理/);
  assert.doesNotMatch(scene, /竞品原标题|竞品说明/);

  const locked = buildFinalDetailPrompt({
    pageAnalysis: analysis,
    mappedSellingPoints,
    productImageCount: 1,
    ownBrandIdentity: { name: 'SUPOR' },
    hasBrandLogoReference: true,
    identityLocked: true,
  });
  assert.match(locked, /参考图1是已经隔离竞品产品后生成的无产品场景底图/);
  assert.match(locked, /不包含任何可供借鉴的竞品产品/);
  assert.match(locked, /本次修复不提供竞品原图|产品表面的 Logo/);
  assert.match(locked, /没有完全相同的实拍角度.*轻微调整场景适配/);
  assert.doesNotMatch(locked, /参考图1是需要直接修改的竞品原图/);
  assert.doesNotMatch(locked, /竞品鳄鱼皮纹理/);
  assert.doesNotMatch(locked, /竞品原标题|竞品说明/);

  const sameMold = buildFinalDetailPrompt({
    pageAnalysis: analysis,
    mappedSellingPoints,
    productImageCount: 1,
    ownBrandIdentity: { name: 'SUPOR' },
    hasBrandLogoReference: true,
    useCharacterReference: true,
    characterReferenceCount: 1,
    generationMode: 'same-mold-recolor',
  });
  assert.match(sameMold, /同模换色/);
  assert.match(sameMold, /产品几何冻结/);
  assert.match(sameMold, /不得把产品抹掉后重画/);
  assert.match(sameMold, /只改产品表面/);
  assert.match(sameMold, /基础色、分区配色、材质质感/);
  assert.match(sameMold, /参考图3是人物完整外观的最高权威/);
  assert.match(sameMold, /参考图4只允许用于 page_graphic 页面品牌槽/);
  assert.doesNotMatch(sameMold, /逐个在 productInstances 指定的空位生成我方产品/);

  const sameMoldValidationInstruction = buildFinalDetailValidationInstruction({
    pageAnalysis: analysis,
    productReferenceCount: 1,
    characterReferenceCount: 1,
    hasBrandLogoReference: true,
    generationMode: 'same-mold-recolor',
  });
  assert.match(sameMoldValidationInstruction, /产品几何母版/);
  assert.match(sameMoldValidationInstruction, /productGeometryPreserved=false/);
  assert.match(sameMoldValidationInstruction, /保留相同模具几何本身不算竞品残留/);

  // 几何冻结只锁产品。换人必然重画头发和衣物，遮挡面积随之改变；
  // 若生成端冻结遮挡、质检端又要求换发型，页面永远不可能同时满足两条。
  assert.doesNotMatch(sameMold, /手指\/衣物前后遮挡和阴影脚印必须逐像素级保持/);
  assert.match(sameMold, /几何冻结只约束产品本身/);
  assert.match(sameMold, /发长、束发\/披发状态、发缝与发型轮廓一律按人物参考重做/);
  assert.doesNotMatch(sameMold, /人物替换不得移动手指、手掌、衣物与产品的接触边界/);
  // 「前后遮挡」指层次关系，不是遮挡面积；同一段里两句话不能各说各的。
  assert.doesNotMatch(sameMold, /与产品的交互及前后遮挡/);
  assert.match(sameMold, /谁在前、谁在后不变/);
  assert.doesNotMatch(sameMoldValidationInstruction, /手部\/衣物遮挡和阴影脚印/);
  assert.match(sameMoldValidationInstruction, /这不算几何改变/);
  assert.match(sameMoldValidationInstruction, /头发与衣物的遮挡范围随参考造型变化属于正常/);
  // 换发型仍然是硬性要求，放宽的只是遮挡面积。
  assert.match(sameMoldValidationInstruction, /必须判 characterHairstyleCorrect=false/);

  // 角度板拍不到的机芯剖视图无从换色；生成端要求保留，质检端就不能按外观不符判失败。
  assert.match(sameMold, /产品内部结构剖视、透视爆炸或机芯特写/);
  assert.match(sameMold, /清除竞品品牌字样、竞品独有配色与表面标识/);
  assert.match(sameMoldValidationInstruction, /不参与外观比对/);

  // Logo 参考图此前从未被质检指令点名，多出来的圆点因此一路判成 logoCorrect=true。
  assert.match(sameMoldValidationInstruction, /参考图4是页面品牌槽 Logo 的唯一字形权威/);
  assert.match(sameMoldValidationInstruction, /必须判 logoCorrect=false/);
  assert.match(sameMold, /页面 Logo 必须逐字形复刻该参考图/);
  assert.match(sameMold, /参考图里没有的点、环、图形或装饰一律不得添加/);

  const directValidationInstruction = buildFinalDetailValidationInstruction({
    pageAnalysis: analysis,
    productReferenceCount: 1,
    hasBrandLogoReference: true,
  });
  assert.match(directValidationInstruction, /参考图4是页面品牌槽 Logo 的唯一字形权威/);
  assert.doesNotMatch(directValidationInstruction, /4\) 页面品牌与 Logo 身份是否正确且无竞品残留；/);

  // 没有 Logo 参考图时不能要求质检员去比对一张不存在的图。
  const noLogoValidationInstruction = buildFinalDetailValidationInstruction({
    pageAnalysis: analysis,
    productReferenceCount: 1,
    hasBrandLogoReference: false,
  });
  assert.match(noLogoValidationInstruction, /本页没有 Logo 参考图/);
  assert.doesNotMatch(noLogoValidationInstruction, /唯一字形权威/);

  const noLogoPrompt = buildFinalDetailPrompt({
    pageAnalysis: analysis,
    mappedSellingPoints,
    productImageCount: 1,
    ownBrandIdentity: { name: '苏泊尔' },
    hasBrandLogoReference: false,
  });
  assert.match(noLogoPrompt, /不得凭印象添加圆点、圆环、方块、图标、上标或任何图形装饰/);

  const failedGeometry = classifyFinalDetailValidation({
    passed: false,
    copyExact: true,
    brandCorrect: true,
    productCorrect: true,
    logoCorrect: true,
    logoPresentationCorrect: true,
    layoutHierarchyCorrect: true,
    visualPolishCorrect: true,
    productPlacementCorrect: true,
    parameterAlignmentCorrect: true,
    unsupportedStrictFactsAbsent: true,
    characterIdentityCorrect: true,
    characterHairstyleCorrect: true,
    characterOutfitCorrect: true,
    characterAccessoriesCorrect: true,
    competitorRemoved: true,
    productGeometryPreserved: false,
    productAppearanceMatched: true,
    competitorProductBrandRemoved: true,
  }, { generationMode: 'same-mold-recolor' });
  assert.deepEqual(failedGeometry.blocking, ['productGeometryPreserved']);

  // 剖视实例填 0 后必须真的不出现在板格指派里：硬绑一个整机格，
  // 成图会照着外壳去改机芯，质检又会按外观不符退回同一张图。
  const mixedCellPrompt = buildFinalDetailPrompt({
    pageAnalysis: {
      ...analysis,
      productInstances: [
        { instanceId: 'product-1', x: 0.3, y: 0.4, width: 0.3, height: 0.2, productSheetCell: 6 },
        { instanceId: 'product-2', x: 0.7, y: 0.4, width: 0.3, height: 0.2, productSheetCell: 0 },
      ],
    },
    mappedSellingPoints,
    productImageCount: 1,
    productSheet: {
      rows: 2,
      columns: 3,
      cells: [
        { index: 1, label: '正面整机' }, { index: 2, label: '左前 3/4 整机' },
        { index: 3, label: '侧面折叠' }, { index: 4, label: '背面整机' },
        { index: 5, label: '按键面板特写' }, { index: 6, label: '背部佩戴' },
      ],
    },
    generationMode: 'same-mold-recolor',
  });
  assert.match(mixedCellPrompt, /"instanceId":"product-1","cell":6/);
  assert.doesNotMatch(mixedCellPrompt, /"instanceId":"product-2","cell"/);
  assert.match(mixedCellPrompt, /产品内部结构剖视、透视爆炸或机芯特写/);
});

test('真实多卖点映射严格收敛为一个槽位一条文案，不产生无位置重复文字', () => {
  const pageAnalysis = {
    copySlots: [
      { slotId: 'copy-1', role: 'headline', sourceText: '抓揉肩颈斜方肌', maxChars: 10 },
      { slotId: 'copy-2', role: 'headline', sourceText: '重回轻松状态', maxChars: 8 },
      { slotId: 'copy-3', role: 'subheadline', sourceText: '竞品副标题', maxChars: 24 },
    ],
  };
  const sp1 = {
    id: 'sp-1', title: '颈肩斜方肌多部位按摩', description: '覆盖颈部、肩部与斜方肌，舒爽松筋多群放松',
  };
  const sp6 = {
    id: 'sp-6', title: '仿人手虎口揉捏', description: '4手联按，多手法放松肩颈与斜方肌',
  };
  const sp4 = {
    id: 'sp-4', title: '按摩头与后颈双效热敷', description: '加大热敷面积，后颈热敷2挡可调',
  };
  const plan = buildDetailCopyReplacementPlan({
    pageAnalysis,
    mappedSellingPoints: [
      { ...sp1, slotId: 'copy-1', slotRole: 'headline' },
      { ...sp6, slotId: 'copy-1', slotRole: 'headline' },
      { ...sp1, slotId: 'copy-2', slotRole: 'headline' },
      { ...sp6, slotId: 'copy-3', slotRole: 'subheadline' },
      { ...sp4, slotId: 'copy-3', slotRole: 'subheadline' },
    ],
  });
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map(item => item.slot.slotId), ['copy-1', 'copy-2', 'copy-3']);
  assert.deepEqual(plan.map(item => item.replacementText), [
    '颈肩斜方肌多部位按摩',
    '舒爽松筋多群放松',
    '仿人手虎口揉捏｜按摩头与后颈双效热敷',
  ]);
  assert.ok(plan.every(item => !item.positionInstruction));
});

test('未映射竞品槽保持删除，无槽位卖点按角色最多使用一次', () => {
  const plan = buildDetailCopyReplacementPlan({
    pageAnalysis: {
      copySlots: [
        { slotId: 'headline-1', role: 'headline', sourceText: '竞品标题' },
        { slotId: 'label-1', role: 'comparison-label', sourceText: '按摩部位' },
        { slotId: 'body-1', role: 'support', sourceText: '竞品说明一' },
        { slotId: 'body-2', role: 'support', sourceText: '竞品说明二' },
      ],
    },
    mappedSellingPoints: [
      { id: 'sp-1', slotId: 'headline-1', slotRole: 'headline', title: '我方标题' },
      { id: 'sp-2', slotRole: 'support', title: '我方说明' },
    ],
  });
  assert.deepEqual(plan.map(item => [item.slot.slotId, item.replacementText]), [
    ['headline-1', '我方标题'],
    ['body-1', '我方说明'],
  ]);
  assert.ok(!plan.some(item => item.slot.slotId === 'label-1' || item.slot.slotId === 'body-2'));
});

test('上游变化只标记详情输出 outdated，不自动启动任务；在途任务保持当前状态但记 needsRegeneration', () => {
  const terminal = {
    id: 'control', type: 'Detail Page Remix', detailRemix: createDetailRemixNodeData({
      status: 'completed', inputRefs: { competitorDetailNodeIds: ['c'] },
    }),
  };
  const stale = markDetailRemixDependentsStale([terminal], 'c')[0];
  assert.equal(stale.detailRemix.status, 'outdated');
  assert.equal(stale.detailRemix.needsRegeneration, true);

  const running = {
    ...terminal,
    detailRemix: createDetailRemixNodeData({
      status: 'generating-final', inputRefs: { competitorDetailNodeIds: ['c'] },
    }),
  };
  const duringRun = markDetailRemixDependentsStale([running], 'c')[0];
  assert.equal(duringRun.detailRemix.status, 'generating-final');
  assert.equal(duringRun.detailRemix.needsRegeneration, true);

  const characterOff = {
    id: 'character-off', type: 'Detail Page Remix', detailRemix: createDetailRemixNodeData({
      status: 'completed',
      inputRefs: { characterReference: { enabled: false, nodeIds: ['person'] } },
    }),
  };
  const dormantCharacterChange = markDetailRemixDependentsStale([characterOff], 'person')[0];
  assert.equal(dormantCharacterChange, characterOff);

  const productOnly = {
    id: 'product-only', type: 'Detail Page Remix', detailRemix: createDetailRemixNodeData({
      status: 'completed', inputRefs: { productNodeIds: ['sku'] },
    }),
  };
  const productStale = markDetailRemixDependentsStale([productOnly], 'sku')[0];
  assert.equal(productStale.detailRemix.status, 'outdated');
  assert.equal(productStale.detailRemix.needsRegeneration, true);
  assert.notEqual(productStale.detailRemix.compositionNeedsRegeneration, true);
});

test('角度板未声明行列时按格数推导，不得塌成 1 行 1 列', () => {
  const cells = Array.from({ length: 6 }, (_, index) => ({ index: index + 1, label: `角度${index + 1}` }));
  const derived = normalizeDetailRemixProductSheet({ cells });
  assert.equal(derived.columns, 3);
  assert.equal(derived.rows, 2);
  assert.match(describeDetailRemixProductSheet(derived, '参考图2'), /2 行 × 3 列/);

  const declared = normalizeDetailRemixProductSheet({ rows: 3, columns: 2, cells });
  assert.equal(declared.columns, 2);
  assert.equal(declared.rows, 3);

  assert.equal(normalizeDetailRemixProductSheet({ cells: [] }), null);
  assert.equal(normalizeDetailRemixProductSheet(null), null);
});

test('品牌 Logo 端口的连线必须在映射与回写中存活，否则保存一次就丢了', () => {
  const node = {
    id: 'remix-1',
    type: 'Detail Page Remix',
    parentIds: [],
    detailRemix: createDetailRemixNodeData({}),
  };
  const withLogo = assignDetailRemixInputPort(node, { id: 'logo-node' }, 'brand-logo');
  assert.deepEqual(withLogo.detailRemix.inputRefs.brandLogoNodeIds, ['logo-node']);
  assert.equal(withLogo.inputPortByParentId['logo-node'], 'brand-logo');

  // 存盘再读回：映射与 inputRefs 必须能互相推导。
  const mapping = buildDetailRemixInputMapping(withLogo.detailRemix.inputRefs);
  assert.equal(mapping['logo-node'], 'brand-logo');
  const restored = syncDetailRemixInputRefs(
    { ...withLogo, detailRemix: createDetailRemixNodeData({}) },
    mapping,
  );
  assert.deepEqual(restored.detailRemix.inputRefs.brandLogoNodeIds, ['logo-node']);

  // 换一张 Logo 必须让已有结果作废，否则会拿旧 Logo 的成图冒充新的。
  const before = detailRemixInputFingerprint(withLogo.detailRemix);
  const swapped = assignDetailRemixInputPort(
    { ...withLogo, detailRemix: createDetailRemixNodeData({}) },
    { id: 'logo-node-2' },
    'brand-logo',
  );
  assert.notEqual(detailRemixInputFingerprint(swapped.detailRemix), before);
});

test('没有我方详情时提示词不得声称角度来自「我的详情」', () => {
  const suppliedOnly = [{ id: 'supplement-1', viewAngle: 'user-supplied', supplemental: true }];
  const prompt = buildFinalDetailPrompt({
    pageAnalysis: {
      pageType: 'marketing',
      hasPerson: false,
      copySlots: [],
      productInstances: [{ instanceId: 'product-1', x: 0.5, y: 0.5, width: 0.3, height: 0.3, renderKind: 'product' }],
    },
    selectedProductViews: suppliedOnly,
    productImageCount: 1,
  });
  assert.doesNotMatch(prompt, /系统已从“我的详情”自动挑选/);
  assert.match(prompt, /商家直接提供的我方产品实拍参考/);

  // 规划识图同理：视角库为空时不能再要求「必须只选给定 ID」。
  const instruction = buildCompetitorPageInstruction({ ownProductViews: [], pageIndex: 0, pageCount: 3 });
  assert.match(instruction, /本次没有我方产品视角库/);
  assert.doesNotMatch(instruction, /必须只选给定 ID/);
});

test('机芯剖视实例只保留不重绘；整页没有产品外观时退化成只换文案', () => {
  const instance = (id, renderKind, cell = 0) => ({
    instanceId: id, x: 0.5, y: 0.5, width: 0.3, height: 0.3, renderKind, productSheetCell: cell,
  });
  const sheet = { rows: 1, columns: 2, cells: [{ index: 1, label: '正面整机' }, { index: 2, label: '背面整机' }] };

  assert.equal(isDetailRemixCopyOnlyPage({ productInstances: [] }), true);
  assert.equal(isDetailRemixCopyOnlyPage({ productInstances: [instance('a', 'illustration')] }), true);
  assert.equal(isDetailRemixCopyOnlyPage({
    productInstances: [instance('a', 'illustration'), instance('b', 'product', 1)],
  }), false);
  // 旧分析没有这个字段，只能按「是产品」处理——反向误判会把竞品外观留在成图里。
  assert.equal(isDetailRemixCopyOnlyPage({ productInstances: [{ instanceId: 'a' }] }), false);

  const copyOnly = buildFinalDetailPrompt({
    pageAnalysis: { pageType: 'marketing', hasPerson: true, copySlots: [], productInstances: [instance('m1', 'illustration')] },
    productImageCount: 0,
    hasBrandLogoReference: true,
    ownBrandIdentity: { name: '苏泊尔' },
    generationMode: 'same-mold-recolor',
  });
  assert.match(copyOnly, /本页只换文案/);
  assert.match(copyOnly, /严禁凭空新增任何产品/);
  // 同模换色的开场白会说「替换产品表面外观」，和上面那句直接打架。
  assert.doesNotMatch(copyOnly, /只能局部替换产品表面外观/);
  assert.doesNotMatch(copyOnly, /【只改产品表面】/);
  assert.doesNotMatch(copyOnly, /人物完整外观的最高权威/);
  // 不发产品参考时 Logo 就是参考图2；向下取整成 1 张产品会让它错位到参考图3。
  assert.match(copyOnly, /参考图2只允许用于 page_graphic/);

  const mixed = buildFinalDetailPrompt({
    pageAnalysis: {
      pageType: 'marketing',
      hasPerson: false,
      copySlots: [],
      productInstances: [instance('body-1', 'product', 1), instance('movement-1', 'illustration')],
    },
    productImageCount: 1,
    productSheet: sheet,
    generationMode: 'same-mold-recolor',
  });
  assert.doesNotMatch(mixed, /本页只换文案/);
  assert.match(mixed, /"instanceId":"body-1","cell":1/);
  assert.doesNotMatch(mixed, /"instanceId":"movement-1","cell"/);
  assert.match(mixed, /\["movement-1"\]/);
  assert.match(mixed, /这些区域整块原样保留/);

  const copyOnlyValidation = buildFinalDetailValidationInstruction({
    pageAnalysis: { productInstances: [instance('m1', 'illustration')] },
    productReferenceCount: 0,
    hasBrandLogoReference: true,
  });
  assert.match(copyOnlyValidation, /本页是“只换文案”页/);
  assert.match(copyOnlyValidation, /productPlacementCorrect 属于不适用字段/);
  // 反向误判（把竞品产品当插画留下）比多画一个产品严重得多，必须也能被抓住。
  assert.match(copyOnlyValidation, /必须判 competitorRemoved=false/);

  const instruction = buildCompetitorPageInstruction({ pageIndex: 0, pageCount: 3 });
  assert.match(instruction, /renderKind/);
  assert.match(instruction, /productInstances 直接给空数组/);
  assert.match(instruction, /判不准时填 product/);
});

test('自动识板把含人脸的格子判为不可用，避免污染人物身份', () => {
  const instruction = buildProductSheetInstruction();
  assert.match(instruction, /出现了可识别的人脸或人物身份/);
  assert.match(instruction, /含可识别人物，会与模特参考冲突/);
  // 只露颈肩、手部的中性佩戴格仍然可用，否则会误杀真正有价值的尺度参照。
  assert.match(instruction, /只露出颈肩、手部等中性躯体而看不到脸的佩戴格不受此限/);
});
