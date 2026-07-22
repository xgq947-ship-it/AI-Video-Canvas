import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildGoogleFlowWorkflowArgs,
    GOOGLE_FLOW_SUPPORTED_ASPECT_RATIOS,
    GOOGLE_FLOW_SUPPORTED_DURATIONS,
    GOOGLE_FLOW_VEO_3_1_LITE_WORKFLOW_MODEL_ID,
    GOOGLE_FLOW_WORKFLOW_MODEL_ID,
    isGoogleFlowWorkflowModelId,
    resolveGoogleFlowModelLabel
} from '../server/services/googleFlowWorkflow.js';
import { extractOpsJson } from '../server/services/opsCliRunner.js';

test('Google Flow workflow 原样传递输入框提示词与真实生成参数', () => {
    const args = buildGoogleFlowWorkflowArgs({
        prompt: '  镜头缓慢推进，人物保持红色礼服  ',
        firstFrame: '/tmp/first-frame.png',
        duration: 10,
        aspectRatio: '9:16',
        outputDir: '/tmp/output',
        timeoutMinutes: 15
    });

    assert.deepEqual(args, [
        '--prompt', '镜头缓慢推进，人物保持红色礼服',
        '--first-frame', '/tmp/first-frame.png',
        '--duration', '10',
        '--aspect-ratio', '9:16',
        '--model', 'Omni Flash',
        '--output-dir', '/tmp/output',
        '--timeout-minutes', '15',
        '--execute'
    ]);
});

test('Google Flow workflow 多参考图走 Ingredients（--reference-image ×N，无 --first-frame）', () => {
    const args = buildGoogleFlowWorkflowArgs({
        prompt: '  多参考图合成  ',
        firstFrame: null,
        referenceImages: ['/tmp/a.png', '/tmp/b.png', '/tmp/c.png'],
        duration: 8,
        aspectRatio: '16:9',
        outputDir: '/tmp/output',
        timeoutMinutes: 15
    });

    assert.deepEqual(args, [
        '--prompt', '多参考图合成',
        '--reference-image', '/tmp/a.png',
        '--reference-image', '/tmp/b.png',
        '--reference-image', '/tmp/c.png',
        '--duration', '8',
        '--aspect-ratio', '16:9',
        '--model', 'Omni Flash',
        '--output-dir', '/tmp/output',
        '--timeout-minutes', '15',
        '--execute'
    ]);
    assert.ok(!args.includes('--first-frame'));
});

test('Google Flow workflow 使用稳定的前端模型 ID 与能力范围', () => {
    assert.equal(GOOGLE_FLOW_WORKFLOW_MODEL_ID, 'google-flow-omni-flash');
    assert.deepEqual(GOOGLE_FLOW_SUPPORTED_DURATIONS, [4, 6, 8, 10]);
    assert.deepEqual(GOOGLE_FLOW_SUPPORTED_ASPECT_RATIOS, ['16:9', '9:16']);
});

test('Google Flow 视频支持 Veo 3.1 Lite 精确模型映射', () => {
    assert.equal(GOOGLE_FLOW_VEO_3_1_LITE_WORKFLOW_MODEL_ID, 'google-flow-veo-3-1-lite');
    assert.equal(isGoogleFlowWorkflowModelId(GOOGLE_FLOW_WORKFLOW_MODEL_ID), true);
    assert.equal(isGoogleFlowWorkflowModelId(GOOGLE_FLOW_VEO_3_1_LITE_WORKFLOW_MODEL_ID), true);
    assert.equal(isGoogleFlowWorkflowModelId('google-flow-unknown'), false);
    assert.equal(resolveGoogleFlowModelLabel(GOOGLE_FLOW_WORKFLOW_MODEL_ID), 'Omni Flash');
    assert.equal(resolveGoogleFlowModelLabel(GOOGLE_FLOW_VEO_3_1_LITE_WORKFLOW_MODEL_ID), 'Veo 3.1 - Lite');

    const args = buildGoogleFlowWorkflowArgs({
        prompt: '人物向镜头走来',
        firstFrame: '/tmp/first-frame.png',
        duration: 6,
        aspectRatio: '16:9',
        model: resolveGoogleFlowModelLabel(GOOGLE_FLOW_VEO_3_1_LITE_WORKFLOW_MODEL_ID),
        outputDir: '/tmp/output',
        timeoutMinutes: 15
    });
    assert.equal(args[args.indexOf('--model') + 1], 'Veo 3.1 - Lite');
});

test('ops_cli 输出能从附带日志的 stdout 提取运行结果', () => {
    // 结构与 ops_cli --json 真实输出一致：success / platform / command / data。
    const payload = extractOpsJson(`
状态提示
{
  "success": true,
  "platform": "image_to_video",
  "command": "google-flow.generate",
  "data": {
    "video_path": "/tmp/result.mp4",
    "prompt": "人物说：{开始}"
  }
}

日志：/tmp/workflow.json
`);

    assert.equal(payload.success, true);
    assert.equal(payload.data.video_path, '/tmp/result.mp4');
    // 提示词里的花括号不得干扰括号配对扫描。
    assert.equal(payload.data.prompt, '人物说：{开始}');
});

test('ops_cli 输出缺少 JSON 时返回明确错误', () => {
    assert.throws(() => extractOpsJson('只有普通日志'), /未能解析浏览器自动化 CLI 的 JSON 输出/);
});
