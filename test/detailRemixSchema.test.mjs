import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA,
  DETAIL_REMIX_OWN_KNOWLEDGE_OUTPUT_SCHEMA,
  DETAIL_REMIX_FINAL_VALIDATION_OUTPUT_SCHEMA,
  DETAIL_REMIX_STRICT_PARAMETER_MODE,
  activeDetailRemixInputRefs,
  assignDetailRemixInputPort,
  buildBlankDetailPrompt,
  buildCompetitorPageInstruction,
  buildDetailCopyReplacementPlan,
  buildDetailRemixInputMapping,
  buildFinalDetailPrompt,
  buildFinalDetailRepairPrompt,
  buildFinalDetailValidationInstruction,
  buildOwnSellingPointsInstruction,
  buildProductComposePrompt,
  createDetailRemixNodeData,
  detailRemixInputFingerprint,
  detailRemixPageMode,
  canonicalDetailRemixFactField,
  isDetailRemixStrictParameterPage,
  markDetailRemixDependentsStale,
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
  assert.deepEqual(empty.inputRefs.characterReference, { enabled: false, nodeIds: [] });

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
  assert.doesNotMatch(competitorInstruction, /evidenceSummary|sourceNodeIds/);
  assert.equal(DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA.additionalProperties, false);
  assert.ok(DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA.properties.page.required.includes('copySlots'));
  assert.equal(DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA.properties.page.properties.copySlots.items.additionalProperties, false);
  assert.ok(DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA.properties.page.required.includes('mappedFacts'));
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
    logoCorrect: true,
    productPlacementCorrect: true,
    parameterAlignmentCorrect: false,
    unsupportedStrictFactsAbsent: false,
    competitorRemoved: true,
    gibberishDetected: true,
    missingTexts: ['额定功率 16W'],
    wrongTexts: ['额定功压 16V'],
    unexpectedTexts: ['2500mAh'],
    summary: '参数文字错误',
  }));
  assert.equal(validation.passed, false);
  assert.equal(validation.gibberishDetected, true);
  const instruction = buildFinalDetailValidationInstruction({
    pageAnalysis: { pageType: 'specification', forbiddenCompetitorElements: ['PHILIPS'] },
    copyPlan: [{ replacementText: '额定功率\n16W' }],
    ownBrandIdentity: { name: 'SUPOR 苏泊尔' },
  });
  assert.match(instruction, /参数页只要有一个错误数字/);
  const repair = buildFinalDetailRepairPrompt({
    pageAnalysis: { pageType: 'specification' },
    copyPlan: [{ replacementText: '额定功率\n16W' }],
    validation,
    evidenceReferenceCount: 1,
    hasBrandLogoReference: true,
  });
  assert.match(repair, /只修复文字与品牌问题/);
  assert.match(repair, /参考图2.*事实证据/);
  assert.match(repair, /参考图3.*真实 Logo/);
  assert.doesNotMatch(repair, /本地|程序叠加/);
});

test('单阶段提示词一次传入版式、产品和可选人物，并直接要求最终图', () => {
  const analysis = {
    hasPerson: true,
    reversePrompt: '柔和家居光线，人物在左，商品区在右',
    productInstances: [
      { instanceId: 'product-1', x: 0.6, y: 0.4, width: 0.3, height: 0.4 },
      { instanceId: 'product-2', x: 0.1, y: 0.65, width: 0.2, height: 0.2 },
    ],
    copySlots: [
      { slotId: 'headline-1', role: 'headline', sourceText: '竞品原标题', x: 0.1, y: 0.08, width: 0.8, height: 0.1 },
      { slotId: 'support-1', role: 'support', sourceText: '竞品说明', x: 0.1, y: 0.2, width: 0.8, height: 0.12 },
    ],
    brandSlots: [{ slotId: 'brand-1', sourceText: '竞品牌', x: 0.05, y: 0.03, width: 0.2, height: 0.08 }],
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
  assert.match(off, /参考图3是我方真实 Logo 参考/);
  assert.match(off, /front-left/);
  assert.match(off, /生成第.*最终图/);
  assert.match(off, /"originalText":"竞品原标题"/);
  assert.doesNotMatch(off, /竞品说明|竞品牌/);
  assert.match(off, /仅含版式坐标，不含任何竞品原文/);
  assert.match(off, /深层舒缓/);
  assert.doesNotMatch(off, /"replacementText":"双档热敷"/);
  assert.match(off, /PHILIPS/);
  assert.match(off, /全部竞品产品实例/);
  assert.doesNotMatch(off, /稍后由程序/);
  assert.match(off, /不要输出中间底图/);
  const on = buildFinalDetailPrompt({
    pageAnalysis: analysis,
    productImageCount: 2,
    hasBrandLogoReference: true,
    useCharacterReference: true,
  });
  assert.match(on, /参考图2至参考图3/);
  assert.match(on, /参考图4是我方真实 Logo 参考/);
  assert.match(on, /参考图5及之后只用于替换竞品人物身份/);
  // Legacy prompt builders remain readable for projects created before the
  // single-generation migration.
  assert.match(buildBlankDetailPrompt({ pageAnalysis: analysis }), /商品空间/);
  assert.match(buildProductComposePrompt({ pageAnalysis: analysis }), /只把我方产品自然合成/);
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
