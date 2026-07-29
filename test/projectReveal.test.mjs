import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  revealProjectById,
  revealProjectDirectory,
  resolveProjectDirectory,
  resolveWorkflowFile,
} from '../electron/projectReveal.js';

test('默认、自定义与旧版项目都通过 Electron openPath 打开真实项目根目录', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-reveal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const defaultRoot = path.join(root, 'library', 'projects', '默认项目');
  const customRoot = path.join(root, 'external', '自定义项目');
  const legacyRoot = path.join(root, 'library', 'images', '旧项目素材');
  fs.mkdirSync(defaultRoot, { recursive: true });
  fs.mkdirSync(customRoot, { recursive: true });
  fs.mkdirSync(legacyRoot, { recursive: true });
  const opened = [];
  const openPath = async directory => { opened.push(directory); return ''; };

  assert.deepEqual(
    await revealProjectDirectory({ projectDirName: '默认项目' }, { dataDir: root, openPath }),
    { ok: true, path: defaultRoot }
  );
  assert.deepEqual(
    await revealProjectDirectory({ projectDirName: 'alias', projectPath: customRoot }, { dataDir: root, openPath }),
    { ok: true, path: customRoot }
  );
  assert.deepEqual(
    await revealProjectDirectory({ assetsDirName: '旧项目素材' }, { dataDir: root, openPath }),
    { ok: true, path: legacyRoot }
  );
  assert.deepEqual(opened, [defaultRoot, customRoot, legacyRoot]);
});

test('项目被移动或路径失效时不重建目录并返回明确错误', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-reveal-missing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let openCalls = 0;
  const result = await revealProjectDirectory(
    { projectDirName: '已经移走' },
    { dataDir: root, openPath: async () => { openCalls += 1; return ''; } }
  );
  assert.deepEqual(result, { ok: false, error: '项目目录不存在' });
  assert.equal(openCalls, 0);
  assert.equal(fs.existsSync(path.join(root, 'library', 'projects', '已经移走')), false);
});

test('无效目录字段不能逃出项目数据目录', () => {
  assert.throws(() => resolveProjectDirectory({ projectDirName: '../outside' }, '/data'), /路径无效/);
  assert.throws(() => resolveProjectDirectory({ assetsDirName: '../outside' }, '/data'), /路径无效/);
  assert.throws(() => resolveProjectDirectory({ projectDirName: 'x', projectPath: 'relative/path' }, '/data'), /路径无效/);
  assert.throws(() => resolveWorkflowFile('../outside', '/data'), /ID 无效/);
  assert.equal(
    resolveWorkflowFile('workflow-1', '/data'),
    path.join('/data', 'library', 'workflows', 'workflow-1.json')
  );
});

test('Electron 主进程只读项目 JSON，不调用会整理或重建目录的项目加载 API', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-reveal-by-id-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workflowId = 'workflow-1';
  const projectRoot = path.join(root, 'library', 'projects', '项目一');
  fs.mkdirSync(path.join(root, 'library', 'workflows'), { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(
    resolveWorkflowFile(workflowId, root),
    JSON.stringify({ id: workflowId, projectDirName: '项目一' })
  );
  const opened = [];
  const result = await revealProjectById(workflowId, {
    dataDir: root,
    openPath: async directory => { opened.push(directory); return ''; },
  });
  assert.deepEqual(result, { ok: true, path: projectRoot });
  assert.deepEqual(opened, [projectRoot]);

  fs.rmSync(projectRoot, { recursive: true, force: true });
  assert.deepEqual(
    await revealProjectById(workflowId, { dataDir: root, openPath: async () => '' }),
    { ok: false, error: '项目目录不存在' }
  );
  assert.equal(fs.existsSync(projectRoot), false);
});
