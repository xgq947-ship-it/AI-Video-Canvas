import assert from 'node:assert/strict';
import test from 'node:test';

import {
    extractWorkflowJson,
    GOOGLE_FLOW_SUPPORTED_ASPECT_RATIOS,
    GOOGLE_FLOW_SUPPORTED_DURATIONS,
    GOOGLE_FLOW_WORKFLOW_MODEL_ID
} from '../server/services/googleFlowWorkflow.js';

test('Google Flow workflow 使用稳定的前端模型 ID 与能力范围', () => {
    assert.equal(GOOGLE_FLOW_WORKFLOW_MODEL_ID, 'google-flow-omni-flash');
    assert.deepEqual(GOOGLE_FLOW_SUPPORTED_DURATIONS, [4, 6, 8, 10]);
    assert.deepEqual(GOOGLE_FLOW_SUPPORTED_ASPECT_RATIOS, ['16:9', '9:16']);
});

test('Google Flow workflow 能从附带日志的 stdout 提取运行结果', () => {
    const payload = extractWorkflowJson(`
状态提示
{
  "run_id": "run_123",
  "status": "success",
  "outputs": {
    "video_path": "/tmp/result.mp4",
    "prompt": "人物说：{开始}"
  }
}

日志：/tmp/workflow.json
`);

    assert.equal(payload.run_id, 'run_123');
    assert.equal(payload.status, 'success');
    assert.equal(payload.outputs.video_path, '/tmp/result.mp4');
});

test('Google Flow workflow 缺少 JSON 时返回明确错误', () => {
    assert.throws(() => extractWorkflowJson('只有普通日志'), /未返回可解析的 JSON/);
});
