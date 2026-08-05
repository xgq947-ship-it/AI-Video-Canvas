import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  reconcileDismissedProjectVideos,
  recoverProjectVideoNodes,
} from '../server/services/projectMediaRecovery.js';

const makeProject = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-project-media-recovery-'));
  const projectsDir = path.join(root, 'projects');
  const projectRoot = path.join(projectsDir, '火柴人-拖延症');
  const videosDir = path.join(projectRoot, 'videos');
  fs.mkdirSync(videosDir, { recursive: true });
  return { root, projectsDir, projectRoot, videosDir };
};

test('opens a project with orphaned videos by restoring deterministic canvas nodes', () => {
  const fixture = makeProject();
  fs.writeFileSync(path.join(fixture.videosDir, 'vid-shot-1.mp4'), 'video-1');
  fs.writeFileSync(path.join(fixture.videosDir, 'shot-1.json'), JSON.stringify({
    id: 'shot-1',
    filename: 'vid-shot-1.mp4',
    prompt: '镜头一提示词',
    model: 'google-flow-omni-flash',
    aspectRatio: '9:16',
    resolution: '自动',
    duration: 8,
  }));
  fs.writeFileSync(path.join(fixture.videosDir, 'final_火柴人_拖延症.mp4'), 'final');

  const workflow = { id: 'workflow-1', projectDirName: '火柴人-拖延症', nodes: [] };
  const result = recoverProjectVideoNodes(workflow, { projectsDir: fixture.projectsDir });

  assert.equal(result.changed, true);
  assert.equal(result.recovered.length, 2);
  assert.equal(workflow.nodes.length, 2);
  assert.equal(workflow.nodes[0].title, '镜头 1');
  assert.equal(workflow.nodes[0].prompt, '镜头一提示词');
  assert.equal(workflow.nodes[0].videoDuration, 8);
  assert.equal(workflow.nodes[0].resultUrl, '/library/projects/%E7%81%AB%E6%9F%B4%E4%BA%BA-%E6%8B%96%E5%BB%B6%E7%97%87/videos/vid-shot-1.mp4');
  assert.equal(workflow.nodes[1].title, '最终成片');
  assert.equal(workflow.nodes[1].status, 'success');
  assert.equal(workflow.nodes[1].type, 'Video');
});

test('recovery is idempotent and does not duplicate an already referenced project video', () => {
  const fixture = makeProject();
  fs.writeFileSync(path.join(fixture.videosDir, 'shot.mp4'), 'video');

  const workflow = {
    id: 'workflow-2',
    projectDirName: '火柴人-拖延症',
    nodes: [{
      id: 'existing',
      type: 'Video',
      resultUrl: '/library/projects/%E7%81%AB%E6%9F%B4%E4%BA%BA-%E6%8B%96%E5%BB%B6%E7%97%87/videos/shot.mp4',
    }],
  };

  const first = recoverProjectVideoNodes(workflow, { projectsDir: fixture.projectsDir });
  const second = recoverProjectVideoNodes(workflow, { projectsDir: fixture.projectsDir });

  assert.equal(first.changed, false);
  assert.equal(second.changed, false);
  assert.equal(workflow.nodes.length, 1);
});

test('a user-deleted project video stays deleted after save and reopen', () => {
  const fixture = makeProject();
  fs.writeFileSync(path.join(fixture.videosDir, 'deleted.mp4'), 'video');
  const resultUrl = '/library/projects/%E7%81%AB%E6%9F%B4%E4%BA%BA-%E6%8B%96%E5%BB%B6%E7%97%87/videos/deleted.mp4';
  const previous = {
    id: 'workflow-deleted',
    projectDirName: '火柴人-拖延症',
    nodes: [{ id: 'video-node', type: 'Video', resultUrl }],
  };
  const saved = {
    id: previous.id,
    projectDirName: previous.projectDirName,
    nodes: [],
  };

  reconcileDismissedProjectVideos(previous, saved);
  const reopened = recoverProjectVideoNodes(saved, { projectsDir: fixture.projectsDir });

  assert.deepEqual(saved.dismissedProjectVideoFiles, ['deleted.mp4']);
  assert.equal(reopened.changed, false);
  assert.deepEqual(saved.nodes, []);
});

test('re-adding a dismissed project video clears its dismissal', () => {
  const resultUrl = '/library/projects/%E7%81%AB%E6%9F%B4%E4%BA%BA-%E6%8B%96%E5%BB%B6%E7%97%87/videos/restored.mp4';
  const previous = {
    id: 'workflow-restored',
    projectDirName: '火柴人-拖延症',
    dismissedProjectVideoFiles: ['restored.mp4'],
    nodes: [],
  };
  const saved = {
    id: previous.id,
    projectDirName: previous.projectDirName,
    nodes: [{ id: 'restored-video', type: 'Video', resultUrl }],
  };

  reconcileDismissedProjectVideos(previous, saved);

  assert.equal('dismissedProjectVideoFiles' in saved, false);
});
