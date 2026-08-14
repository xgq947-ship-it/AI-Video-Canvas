import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  DETAIL_REMIX_IMPORT_COLUMN_GAP,
  DETAIL_REMIX_IMPORT_CONTROLLER_GAP,
  DETAIL_REMIX_IMPORT_LAYOUT_VERSION,
  DETAIL_REMIX_IMPORT_NODE_WIDTH,
  DETAIL_REMIX_IMPORT_ROW_GAP,
  buildDetailRemixFolderRowPlacements,
  detailRemixFolderFilePath,
  detailRemixFolderName,
  migrateDetailRemixFolderLayouts,
  reflowDetailRemixFolderNodes,
  sortDetailRemixFolderFiles,
} from '../src/utils/detailRemixFolderImport.js';

const file = relativePath => ({
  name: relativePath.split('/').at(-1),
  webkitRelativePath: relativePath,
});

test('详情文件夹按相对路径自然排序，并忽略系统隐藏文件', () => {
  const sorted = sortDetailRemixFolderFiles([
    file('竞品详情/10.jpg'),
    file('竞品详情/.DS_Store'),
    file('竞品详情/2.jpg'),
    file('竞品详情/1.jpg'),
    file('竞品详情/__MACOSX/._1.jpg'),
    file('竞品详情/子目录/3.jpg'),
  ]);
  assert.deepEqual(sorted.map(detailRemixFolderFilePath), [
    '竞品详情/1.jpg',
    '竞品详情/2.jpg',
    '竞品详情/10.jpg',
    '竞品详情/子目录/3.jpg',
  ]);
  assert.equal(detailRemixFolderName(sorted), '竞品详情');
});

test('按每排最高图片留出安全距离，两组在控制节点上方水平展开', () => {
  const controller = { x: 1000, y: 1000 };
  const ownNodes = [
    { id: 'own-1', resultAspectRatio: '1/3' },
    { id: 'own-2', resultAspectRatio: '3/4' },
    { id: 'own-3', resultAspectRatio: '1/2' },
  ];
  const competitorNodes = [
    { id: 'competitor-1', resultAspectRatio: '1/2' },
    { id: 'competitor-2', resultAspectRatio: '9/16' },
  ];
  const { own, competitor } = buildDetailRemixFolderRowPlacements(controller, {
    own: ownNodes,
    competitor: competitorNodes,
  });

  assert.equal(competitor.length, 2);
  assert.equal(own.length, 3);
  assert.equal(new Set(competitor.map(item => item.y)).size, 1);
  assert.equal(new Set(own.map(item => item.y)).size, 1);
  const ownTallest = DETAIL_REMIX_IMPORT_NODE_WIDTH / (1 / 3);
  const competitorTallest = DETAIL_REMIX_IMPORT_NODE_WIDTH / (1 / 2);
  assert.equal(competitor[0].y + competitorTallest + DETAIL_REMIX_IMPORT_CONTROLLER_GAP, controller.y);
  assert.equal(own[0].y + ownTallest + DETAIL_REMIX_IMPORT_ROW_GAP, competitor[0].y);
  assert.equal(competitor[1].x - competitor[0].x, DETAIL_REMIX_IMPORT_NODE_WIDTH + DETAIL_REMIX_IMPORT_COLUMN_GAP);
  assert.equal(own[1].x - own[0].x, DETAIL_REMIX_IMPORT_NODE_WIDTH + DETAIL_REMIX_IMPORT_COLUMN_GAP);
});

test('图片真实比例陆续加载后会重排活动输入，旧图片位置保持不变', () => {
  const controller = {
    id: 'controller',
    x: 1000,
    y: 1800,
    detailRemix: {
      inputRefs: {
        ownDetailNodeIds: ['own-1', 'own-2'],
        competitorDetailNodeIds: ['competitor-1', 'competitor-2'],
      },
    },
  };
  const nodes = [
    controller,
    { id: 'own-1', x: 0, y: 0, resultAspectRatio: '1/4', detailRemixImport: { controllerNodeId: 'controller', role: 'own' } },
    { id: 'own-2', x: 0, y: 0, resultAspectRatio: '3/4', detailRemixImport: { controllerNodeId: 'controller', role: 'own' } },
    { id: 'competitor-1', x: 0, y: 0, resultAspectRatio: '1/3', detailRemixImport: { controllerNodeId: 'controller', role: 'competitor' } },
    { id: 'competitor-2', x: 0, y: 0, resultAspectRatio: '9/16', detailRemixImport: { controllerNodeId: 'controller', role: 'competitor' } },
    { id: 'archived-import', x: 71, y: 82, resultAspectRatio: '1/8' },
  ];

  const next = reflowDetailRemixFolderNodes(nodes, controller.id);
  const byId = new Map(next.map(node => [node.id, node]));
  const ownBottom = byId.get('own-1').y + DETAIL_REMIX_IMPORT_NODE_WIDTH / (1 / 4);
  const competitorTop = byId.get('competitor-1').y;
  const competitorBottom = competitorTop + DETAIL_REMIX_IMPORT_NODE_WIDTH / (1 / 3);
  assert.ok(competitorTop - ownBottom >= DETAIL_REMIX_IMPORT_ROW_GAP);
  assert.ok(controller.y - competitorBottom >= DETAIL_REMIX_IMPORT_CONTROLLER_GAP);
  assert.equal(byId.get('own-1').detailRemixImport.layoutVersion, DETAIL_REMIX_IMPORT_LAYOUT_VERSION);
  assert.deepEqual(
    { x: byId.get('archived-import').x, y: byId.get('archived-import').y },
    { x: 71, y: 82 },
  );
});

test('打开旧项目时只迁移旧版文件夹布局，已经整理过的用户位置不会反复移动', () => {
  const controller = {
    id: 'controller',
    x: 1000,
    y: 1800,
    detailRemix: {
      inputRefs: {
        ownDetailNodeIds: ['own-1'],
        competitorDetailNodeIds: ['competitor-1', 'manual-1'],
      },
    },
  };
  const oldNodes = [
    controller,
    { id: 'own-1', x: 0, y: 0, resultAspectRatio: '1/4', detailRemixImport: { controllerNodeId: 'controller', role: 'own' } },
    { id: 'competitor-1', x: 0, y: 0, resultAspectRatio: '1/3', detailRemixImport: { controllerNodeId: 'controller', role: 'competitor' } },
    { id: 'manual-1', x: 33, y: 44, resultAspectRatio: '1/6' },
  ];
  const migrated = migrateDetailRemixFolderLayouts(oldNodes);
  const byId = new Map(migrated.map(node => [node.id, node]));
  assert.notEqual(byId.get('own-1').y, 0);
  assert.deepEqual({ x: byId.get('manual-1').x, y: byId.get('manual-1').y }, { x: 33, y: 44 });

  const userMoved = migrated.map(node => node.id === 'own-1' ? { ...node, x: 777, y: 888 } : node);
  const reopened = migrateDetailRemixFolderLayouts(userMoved);
  assert.deepEqual(
    { x: reopened.find(node => node.id === 'own-1').x, y: reopened.find(node => node.id === 'own-1').y },
    { x: 777, y: 888 },
  );
});

test('控制节点提供两个文件夹入口，无必填产品选择器且执行链路不包含坐标角色推断', () => {
  const detailNode = fs.readFileSync(new URL('../src/features/detail-remix/DetailRemixNode.tsx', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.equal((detailNode.match(/webkitdirectory/g) || []).length, 2);
  assert.match(detailNode, /handleFolderFiles\('competitor'/);
  assert.match(detailNode, /handleFolderFiles\('own'/);
  assert.match(detailNode, /无需单独上传产品图/);
  assert.doesNotMatch(detailNode, /生成时必选/);
  assert.match(detailNode, /GenerationCancelButton/);
  assert.match(detailNode, /label="取消生成"/);
  assert.match(app, /onImportDetailRemixFolder/);
});

test('整批导入由单个历史事务提交，导入中撤销会中止上传并回到导入前', () => {
  const hook = fs.readFileSync(new URL('../src/hooks/useCanvasImageImport.ts', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const topBar = fs.readFileSync(new URL('../src/components/TopBar.tsx', import.meta.url), 'utf8');

  assert.match(hook, /beginHistoryTransaction/);
  assert.match(hook, /commitHistoryTransaction/);
  assert.match(hook, /rollbackHistoryTransaction/);
  assert.match(hook, /session\.controller\.abort\(\)/);
  assert.match(hook, /body:\s*file,\s*signal,/);
  assert.match(hook, /replaceableFolderNodeIds/);
  assert.match(hook, /finishImport\(session, committedNodes, \[controller\.id\]\)/);
  assert.match(app, /activeCanvasHistoryTransactionRef/);
  assert.match(app, /if \(cancelActiveImportRef\.current\?\.\(\)\) return/);
  assert.match(app, /commitHistoryTransition\(transaction\.before, \{/);
  assert.match(app, /selectedNodeIds: finalSelectedNodeIds \|\| selectedNodeIdsRef\.current/);
  assert.match(app, /setSelectedNodeIds\(transaction\.before\.selectedNodeIds\)/);
  assert.match(app, /setSelectedNodeIds\(historyState\.selectedNodeIds\.filter/);
  assert.match(topBar, /aria-label="撤销"/);
  assert.match(topBar, /aria-label="重做"/);
  assert.match(topBar, /⌘\/Ctrl\+Z/);
});
