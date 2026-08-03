import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ensureVideoRemixWorkspaceMigrationBackup,
  isVideoRemixWorkspaceMigration,
  videoRemixWorkspaceBackupPath,
} from '../server/utils/workflowVideoRemixMigration.js';

function legacyWorkflow() {
  return {
    id: 'workflow-remix',
    title: '旧项目',
    nodes: [{
      id: 'legacy-node',
      type: 'Video Remix',
      videoRemix: { remixId: 'remix-1', stage: 'analysis_ready' },
    }],
  };
}

test('只在旧容器已完整进入项目级记录时识别为迁移', () => {
  const existing = legacyWorkflow();
  assert.equal(isVideoRemixWorkspaceMigration(existing, {
    ...existing,
    nodes: [],
    videoRemixes: [{ id: 'remix-1', state: { remixId: 'remix-1' } }],
  }), true);
  assert.equal(isVideoRemixWorkspaceMigration(existing, {
    ...existing,
    nodes: [],
    videoRemixes: [],
  }), false, '没有项目级副本时不能把节点删除误判成安全迁移');
});

test('迁移前只创建一次原子备份并保留旧节点完整状态', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-remix-migration-'));
  try {
    const workflowPath = path.join(root, 'workflow-remix.json');
    const existing = legacyWorkflow();
    const next = {
      ...existing,
      nodes: [],
      videoRemixes: [{ id: 'remix-1', state: existing.nodes[0].videoRemix }],
    };
    fs.writeFileSync(workflowPath, JSON.stringify(existing));
    const backupPath = ensureVideoRemixWorkspaceMigrationBackup(existing, next, workflowPath);
    assert.equal(backupPath, videoRemixWorkspaceBackupPath(workflowPath));
    assert.deepEqual(JSON.parse(fs.readFileSync(backupPath, 'utf8')), existing);

    const changedExisting = { ...existing, title: '后来被修改的旧项目' };
    ensureVideoRemixWorkspaceMigrationBackup(changedExisting, next, workflowPath);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(backupPath, 'utf8')),
      existing,
      '一次性备份不能被后续保存覆盖'
    );
    assert.deepEqual(fs.readdirSync(root).filter(name => name.endsWith('.tmp')), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
