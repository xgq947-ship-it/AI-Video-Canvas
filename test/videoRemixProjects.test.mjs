import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createVideoRemixProject,
  migrateLegacyVideoRemixNodes,
  normalizeVideoRemixProjects,
  videoRemixProjectAsNode,
} from '../shared/videoRemixProjects.js';
import { createVideoRemixState } from '../shared/videoRemix.js';

const NOW = '2026-08-01T00:00:00.000Z';

test('旧视频复刻容器迁移为项目级记录并从画布移除', () => {
  const state = createVideoRemixState({
    remixId: 'remix_legacy',
    stage: 'analysis_ready',
    story: { summary: '旧项目故事', structure: ['开始'] },
  });
  const nodes = [{
    id: 'legacy_node',
    type: 'Video Remix',
    title: '旧复刻任务',
    x: 400,
    y: 200,
    parentIds: ['source_video'],
    videoRemix: state,
  }, {
    id: 'source_video',
    type: 'Video',
    resultUrl: '/source.mp4',
    parentIds: [],
  }, {
    id: 'final_video',
    type: 'Video',
    videoModel: 'video-remix-final',
    resultUrl: '/final.mp4',
    parentIds: ['legacy_node'],
  }];

  const migrated = migrateLegacyVideoRemixNodes(nodes, [], NOW);

  assert.equal(migrated.migrated, true);
  assert.deepEqual(migrated.legacyNodeIds, ['legacy_node']);
  assert.deepEqual(migrated.nodes.map(node => node.id), ['source_video', 'final_video']);
  assert.deepEqual(migrated.nodes[1].parentIds, []);
  assert.equal(migrated.videoRemixes.length, 1);
  assert.equal(migrated.videoRemixes[0].id, 'remix_legacy');
  assert.equal(migrated.videoRemixes[0].title, '旧复刻任务');
  assert.equal(migrated.videoRemixes[0].sourceCanvasNodeId, 'source_video');
  assert.equal(migrated.videoRemixes[0].finalCanvasNodeId, 'final_video');
  assert.equal(migrated.videoRemixes[0].state.story.summary, '旧项目故事');
});

test('已有项目级记录优先且重复迁移保持幂等', () => {
  const current = createVideoRemixProject({
    id: 'remix_same',
    title: '新结构中的任务',
    state: createVideoRemixState({ remixId: 'remix_same', stage: 'completed' }),
  }, NOW);
  const nodes = [{
    id: 'legacy_same',
    type: 'Video Remix',
    title: '过期节点标题',
    videoRemix: createVideoRemixState({ remixId: 'remix_same', stage: 'source' }),
  }];

  const first = migrateLegacyVideoRemixNodes(nodes, [current], NOW);
  const second = migrateLegacyVideoRemixNodes(first.nodes, first.videoRemixes, NOW);

  assert.equal(first.videoRemixes.length, 1);
  assert.equal(first.videoRemixes[0].title, '新结构中的任务');
  assert.equal(first.videoRemixes[0].state.stage, 'completed');
  assert.equal(second.migrated, false);
  assert.deepEqual(second.videoRemixes, first.videoRemixes);
});

test('项目级记录可适配现有工作台但不携带画布坐标', () => {
  const project = normalizeVideoRemixProjects([{
    id: 'remix_new',
    title: '产品广告复刻',
    state: createVideoRemixState({ remixId: 'remix_new' }),
  }], NOW)[0];
  const adapter = videoRemixProjectAsNode(project);

  assert.equal(adapter.id, 'remix_new');
  assert.equal(adapter.title, '产品广告复刻');
  assert.equal(adapter.videoRemix.remixId, 'remix_new');
  assert.equal(adapter.x, 0);
  assert.equal(adapter.y, 0);
});
