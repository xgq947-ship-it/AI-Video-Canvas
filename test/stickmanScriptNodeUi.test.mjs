import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflowNodes = fs.readFileSync(
  new URL('../src/features/stickman-director/StickmanWorkflowNodes.tsx', import.meta.url),
  'utf8'
);
const scriptNode = workflowNodes.slice(
  workflowNodes.indexOf('export const ScriptInputNode'),
  workflowNodes.indexOf('export const ReferenceVideoNode')
);
const directorNode = workflowNodes.slice(
  workflowNodes.indexOf('export const StickmanDirectorNode'),
  workflowNodes.indexOf('const ShotCard')
);
const storyboardNode = workflowNodes.slice(
  workflowNodes.indexOf('export const StoryboardNode'),
  workflowNodes.indexOf('export const FlowBatchVideoNode')
);
const flowNode = workflowNodes.slice(
  workflowNodes.indexOf('export const FlowBatchVideoNode'),
  workflowNodes.indexOf('export const VideoMergeNode')
);

test('剧本输入节点不再提供导演分镜参数，导演节点保留唯一配置入口', () => {
  for (const [scriptLabel, directorLabel] of [
    ['默认比例', '比例'],
    ['总时长(s)', '总时长(s)'],
    ['镜头数量', '镜头数量'],
    ['单镜头(s)', '单镜头(s)'],
  ]) {
    const scriptPattern = new RegExp(scriptLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const directorPattern = new RegExp(directorLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    assert.doesNotMatch(scriptNode, scriptPattern);
    assert.match(directorNode, directorPattern);
  }
});

test('分镜列表只负责镜头管理，Flow 节点负责批量执行', () => {
  assert.doesNotMatch(storyboardNode, /批量生成/);
  assert.doesNotMatch(storyboardNode, /重试失败/);
  assert.match(flowNode, /生成待处理镜头/);
  assert.match(flowNode, /只重试失败项/);
  assert.match(workflowNodes, /重新生成此镜头/);
  assert.match(workflowNodes, /ShotPreviewModal/);
});

test('Flow 节点只展示继承的画幅和时长，不再提供重复编辑入口', () => {
  assert.match(flowNode, /继承自火柴人导演的生成规格/);
  assert.doesNotMatch(flowNode, /label="比例"/);
  assert.doesNotMatch(flowNode, /label="尺寸"/);
  assert.doesNotMatch(flowNode, /label="时长\(s\)"/);
  assert.doesNotMatch(flowNode, /update\(\{ duration:/);
  assert.match(flowNode, /label="模型档位"/);
});

test('Flow 节点直接展示生成视频，并支持预览和逐镜头重新生成', () => {
  assert.match(flowNode, /生成结果/);
  assert.match(flowNode, /setPreviewShotId/);
  assert.match(flowNode, /ShotPreviewModal/);
  assert.match(flowNode, /onGenerateShot\(storyboardNode\.id, shot\.id\)/);
  assert.match(flowNode, /重生成/);
});

test('分镜展开高度使用统一自适应估算，选框和连线不再复制旧硬编码公式', () => {
  assert.match(workflowNodes, /getStickmanStoryboardNodeHeight/);
  assert.doesNotMatch(workflowNodes, /470 \+ state\.shots\.length \* 180/);
});

test('Flow 结果区高度随生成结果增长并设置滚动上限', () => {
  assert.match(workflowNodes, /getFlowBatchVideoNodeHeight/);
  assert.match(flowNode, /FLOW_BATCH_RESULT_LIST_MAX_HEIGHT/);
});
