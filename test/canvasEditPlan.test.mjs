import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCanvasEditService } from '../server/services/canvasEditPlan.js';

const fixture = () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twitcanva-edit-'));
  fs.mkdirSync(path.join(rootDir, 'library', 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'library', 'audio'), { recursive: true });
  const workflow = {
    id: 'source', title: '源画布', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    nodes: [
      { id: 'v1', type: 'Video', x: 0, y: 0, resultUrl: '/library/videos/a.mp4', videoDuration: 6, status: 'success' },
      { id: 'v2', type: 'Video', x: 100, y: 0, resultUrl: '/library/videos/b.mp4', videoDuration: 6, status: 'success' },
    ],
  };
  fs.writeFileSync(path.join(rootDir, 'library', 'workflows', 'source.json'), JSON.stringify(workflow));
  return { rootDir, workflow };
};

test('应用计划只创建副本，并生成完整配音和成片节点', () => {
  const { rootDir, workflow } = fixture();
  const service = createCanvasEditService({ rootDir });
  const planDir = path.join(rootDir, 'library', 'edit-plans');
  const plan = {
    id: 'plan1', version: 1, status: 'draft', sourceWorkflowId: 'source', title: '莫妮卡自我介绍',
    audio: { file: '/library/audio/voice.mp3', duration: 8 },
    segments: [
      { start: 0, end: 4, text: '第一句' },
      { start: 4, end: 8, text: '第二句' },
    ],
    shots: [
      { nodeId: 'v1', trimStart: 0, trimEnd: 4 },
      { nodeId: 'v2', trimStart: 0, trimEnd: 4 },
    ], createdAt: '', updatedAt: '', warnings: [],
  };
  fs.writeFileSync(path.join(planDir, 'plan1.json'), JSON.stringify(plan));
  assert.throws(() => service.applyEditPlan({ planId: 'plan1' }), /confirm=true/);

  const applied = service.applyEditPlan({ planId: 'plan1', confirm: true });
  assert.notEqual(applied.workflow.id, workflow.id);
  assert.equal(applied.workflow.nodes.find((node) => node.id === 'v1').shotVolume, 0);
  assert.equal(applied.workflow.nodes.filter((node) => node.type === 'Audio').length, 1);
  assert.equal(applied.workflow.nodes.filter((node) => node.type === 'Render').length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(rootDir, 'library', 'workflows', 'source.json'))), workflow);

  const built = service.getRenderManifest({ workflowId: applied.workflow.id, renderNodeId: applied.renderNodeId });
  assert.equal(built.manifest.shots.length, 2);
  assert.equal(built.manifest.audioTracks[0].file, '/library/audio/voice.mp3');
  assert.equal(built.duration, 8);

  const renderState = service.updateRenderNode({
    workflowId: applied.workflow.id, renderNodeId: applied.renderNodeId,
    job: { jobId: 'job1', status: 'success', stage: 'done', progress: 1, output: '/library/renders/test.mp4' },
  });
  assert.equal(renderState.output, '/library/renders/test.mp4');
  assert.equal(service.syncRenderJob({ jobId: 'job1', status: 'success', stage: 'done', progress: 1, output: '/library/renders/test.mp4' }).status, 'success');

  assert.throws(() => service.undoEditPlan({ planId: 'plan1' }), /confirm=true/);
  assert.equal(service.undoEditPlan({ planId: 'plan1', confirm: true }).removed, true);
});
