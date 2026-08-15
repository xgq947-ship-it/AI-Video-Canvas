import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createDetailRemixExportDirectory,
  exportDetailRemixFiles,
  findDetailRemixExportCollisions,
  planDetailRemixExport,
} from '../electron/detailRemixExport.js';

test('选择保存位置后始终新建独立结果文件夹，同秒重复导出也不会覆盖', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detail-remix-export-folder-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const now = new Date(2026, 7, 14, 9, 8, 7);
  const first = createDetailRemixExportDirectory(root, {
    projectName: '制作新详情',
    now,
  });
  const second = createDetailRemixExportDirectory(root, {
    projectName: '制作新详情',
    now,
  });
  assert.equal(path.basename(first), '制作新详情_最终详情_20260814_090807');
  assert.equal(path.basename(second), '制作新详情_最终详情_20260814_090807_02');
  assert.ok(fs.statSync(first).isDirectory());
  assert.ok(fs.statSync(second).isDirectory());
});

test('最终详情按页面顺序连续编号为 01、02…并导出到新建结果文件夹', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detail-remix-export-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sources = path.join(root, 'sources');
  const destination = path.join(root, 'destination');
  fs.mkdirSync(sources);
  fs.mkdirSync(destination);
  const first = path.join(sources, 'random-a.png');
  const second = path.join(sources, 'random-b.png');
  fs.writeFileSync(first, 'page-one');
  fs.writeFileSync(second, 'page-two');

  const files = [
    { order: 1, pageIndex: 1, sourcePath: second },
    { order: 0, pageIndex: 0, sourcePath: first },
  ];
  const plan = planDetailRemixExport(files, destination);
  assert.deepEqual(plan.map(item => item.filename), ['01.png', '02.png']);
  assert.deepEqual(findDetailRemixExportCollisions(plan), []);

  const result = exportDetailRemixFiles(files, destination);
  assert.equal(result.count, 2);
  assert.deepEqual(result.filenames, ['01.png', '02.png']);
  assert.equal(fs.readFileSync(path.join(destination, '01.png'), 'utf8'), 'page-one');
  assert.equal(fs.readFileSync(path.join(destination, '02.png'), 'utf8'), 'page-two');
  assert.deepEqual(findDetailRemixExportCollisions(plan).map(item => item.filename), ['01.png', '02.png']);
});

test('导出至少保留两位编号，超过 99 张时自动扩大位数', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detail-remix-export-width-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.png');
  fs.writeFileSync(source, 'pixel');
  const files = Array.from({ length: 101 }, (_, index) => ({ order: index, pageIndex: index, sourcePath: source }));
  const plan = planDetailRemixExport(files, root);
  assert.equal(plan[0].filename, '001.png');
  assert.equal(plan.at(-1).filename, '101.png');
});

test('未过检候选保留页码顺序，但文件名带「待确认」以免被当成已验收成品', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detail-remix-export-candidate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sources = path.join(root, 'sources');
  const destination = path.join(root, 'destination');
  fs.mkdirSync(sources);
  fs.mkdirSync(destination);
  const delivered = path.join(sources, 'ok.png');
  const candidate = path.join(sources, 'rejected.png');
  fs.writeFileSync(delivered, 'page-one');
  fs.writeFileSync(candidate, 'page-two-candidate');

  const files = [
    { order: 0, pageIndex: 0, sourcePath: delivered },
    { order: 1, pageIndex: 1, sourcePath: candidate, candidate: true, candidateReason: 'AI 成图质检未通过' },
  ];
  const result = exportDetailRemixFiles(files, destination);
  assert.deepEqual(result.filenames, ['01.png', '02_待确认.png']);
  assert.equal(fs.readFileSync(path.join(destination, '02_待确认.png'), 'utf8'), 'page-two-candidate');
});
