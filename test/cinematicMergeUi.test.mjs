import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const mergeNode = fs.readFileSync(new URL('../src/features/cinematic-director/CinematicWorkflowNodes.tsx', import.meta.url), 'utf8');

test('电影成片拼接节点提供字幕生成入口并复用自动字幕服务', () => {
  assert.match(mergeNode, /onGenerateSubtitles/);
  assert.match(mergeNode, /生成字幕/);
  assert.match(app, /handleGenerateCinematicSubtitles/);
  assert.match(app, /sourceNodeId: mergeNodeId/);
  assert.match(app, /fetch\('\/api\/auto-subtitles'/);
  assert.match(app, /title: '电影字幕成片'/);
});
