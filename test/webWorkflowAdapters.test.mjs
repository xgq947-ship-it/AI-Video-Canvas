/**
 * 三个平台适配器的「画布契约」回归测试。
 *
 * DOM 点击生成链路删除后，这些适配器只剩两件事：
 *   1. 画布模型 id ↔ 平台模型的映射；
 *   2. 比例 / 分辨率 / 时长 / 张数的取值校验。
 * 生成本身由各平台的 webhttp provider 负责，协议细节在 webHttpProtocol.test.mjs 里锁。
 *
 * 本文件取代原先按平台拆分的五个适配器测试 —— 它们大半在断言已删除的
 * `build*Args()`（拼 ops-cli 命令行参数），随 DOM 链路一起失去了意义。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    GEMINI_WEB_IMAGE_MODEL_ID,
    GEMINI_WEB_VIDEO_MODEL_ID,
    isGeminiWebImageModel,
    isGeminiWebVideoModel
} from '../server/services/geminiWebWorkflow.js';

import {
    GOOGLE_FLOW_SUPPORTED_ASPECT_RATIOS,
    GOOGLE_FLOW_SUPPORTED_DURATIONS,
    GOOGLE_FLOW_WORKFLOW_MODELS,
    isGoogleFlowWorkflowModelId,
    resolveGoogleFlowModelLabel
} from '../server/services/googleFlowWorkflow.js';

import {
    GOOGLE_FLOW_IMAGE_SUPPORTED_ASPECT_RATIOS,
    GOOGLE_FLOW_IMAGE_WORKFLOW_MODELS,
    isGoogleFlowImageWorkflowModel,
    normalizeGoogleFlowImageCount,
    resolveGoogleFlowImageModelName
} from '../server/services/googleFlowImageWorkflow.js';

import {
    JIMENG_IMAGE_MODELS,
    JIMENG_IMAGE_SUPPORTED_ASPECT_RATIOS,
    JIMENG_IMAGE_SUPPORTED_RESOLUTIONS,
    isJimengImageWorkflowModel,
    normalizeJimengImageCount,
    normalizeJimengImageResolution
} from '../server/services/jimengImageWorkflow.js';

import {
    JIMENG_MODEL_LABELS,
    JIMENG_SUPPORTED_ASPECT_RATIOS,
    JIMENG_SUPPORTED_DURATIONS,
    isJimengWorkflowModelId,
    normalizeJimengResolution,
    resolveJimengModelLabel
} from '../server/services/jimengVideoWorkflow.js';
import { isBrowserWorkflowVideoModel } from '../src/utils/videoModelCapabilities.js';

// ---------------------------------------------------------------------------
// 模型识别
// ---------------------------------------------------------------------------

test('Gemini Web 图片 / 视频模型识别互不串味', () => {
    assert.equal(isGeminiWebImageModel(GEMINI_WEB_IMAGE_MODEL_ID), true);
    assert.equal(isGeminiWebImageModel(GEMINI_WEB_VIDEO_MODEL_ID), false);
    assert.equal(isGeminiWebVideoModel(GEMINI_WEB_VIDEO_MODEL_ID), true);
    assert.equal(isGeminiWebVideoModel('seedance-2-0'), false);
});

test('即梦视频模型 id 不能撞上 ARK Seedance 的前缀路由', () => {
    // 路由用 videoModel.startsWith('seedance-') 分流到火山方舟。
    // 即梦的 id 一旦以 seedance- 开头，就会被错误地送去 ARK 并扣错账。
    for (const id of Object.keys(JIMENG_MODEL_LABELS)) {
        assert.equal(id.startsWith('seedance-'), false, `${id} 会被误判为 ARK 模型`);
        assert.equal(isJimengWorkflowModelId(id), true);
    }
    assert.equal(isJimengWorkflowModelId('seedance-2-0'), false);
});

test('即梦五个视频模型都映射到页面上的精确文案', () => {
    assert.equal(Object.keys(JIMENG_MODEL_LABELS).length, 5);
    assert.equal(resolveJimengModelLabel('jimeng-seedance-2-0-fast'), '即梦 Seedance 2.0 Fast VIP');
    assert.equal(resolveJimengModelLabel('jimeng-seedance-2-0-mini'), '即梦 Seedance 2.0 mini');
    // 未知 id 回落到默认，不抛错 —— 旧画布里可能存着已下线的 id。
    assert.equal(resolveJimengModelLabel('不存在的模型'), '即梦 Seedance 2.0 VIP');
});

test('Flow 模型映射稳定，未知 id 回落默认', () => {
    assert.equal(isGoogleFlowWorkflowModelId('google-flow-omni-flash'), true);
    assert.equal(resolveGoogleFlowModelLabel('google-flow-veo-3-1-lite'), 'Veo 3.1 - Lite');
    assert.equal(resolveGoogleFlowModelLabel('google-flow-veo-3-1-fast'), 'Veo 3.1 - Fast');
    assert.equal(resolveGoogleFlowModelLabel('google-flow-veo-3-1-quality'), 'Veo 3.1 - Quality');
    assert.equal(Object.keys(GOOGLE_FLOW_WORKFLOW_MODELS).length, 4);
    assert.equal(resolveGoogleFlowModelLabel('未知'), GOOGLE_FLOW_WORKFLOW_MODELS['google-flow-omni-flash']);

    assert.equal(isGoogleFlowImageWorkflowModel('google-flow-nano-banana-2'), true);
    assert.equal(Object.keys(GOOGLE_FLOW_IMAGE_WORKFLOW_MODELS).length, 3);
    assert.equal(resolveGoogleFlowImageModelName('未知'), 'Nano Banana 2');
});

test('Flow 四个视频档位都属于网页 HTTP 模型', () => {
    for (const modelId of [
        'google-flow-omni-flash',
        'google-flow-veo-3-1-lite',
        'google-flow-veo-3-1-fast',
        'google-flow-veo-3-1-quality'
    ]) {
        assert.equal(isBrowserWorkflowVideoModel(modelId), true, `${modelId} 未登记运行时能力`);
    }
});

test('即梦图片只接入 5.0 Pro 与 5.0 Lite', () => {
    assert.deepEqual(Object.keys(JIMENG_IMAGE_MODELS).sort(),
        ['jimeng-image-5-0-lite', 'jimeng-image-5-0-pro']);
    assert.equal(isJimengImageWorkflowModel('jimeng-image-5-0-pro'), true);
    assert.equal(isJimengImageWorkflowModel('gemini-web-image'), false);
});

// ---------------------------------------------------------------------------
// 参数取值
// ---------------------------------------------------------------------------

test('各平台的比例 / 时长取值与页面一致', () => {
    assert.deepEqual([...GOOGLE_FLOW_SUPPORTED_ASPECT_RATIOS], ['16:9', '9:16']);
    assert.deepEqual([...GOOGLE_FLOW_SUPPORTED_DURATIONS], [4, 6, 8, 10]);
    assert.deepEqual([...GOOGLE_FLOW_IMAGE_SUPPORTED_ASPECT_RATIOS], ['16:9', '4:3', '1:1', '3:4', '9:16']);
    assert.deepEqual([...JIMENG_SUPPORTED_DURATIONS], [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    assert.deepEqual([...JIMENG_SUPPORTED_ASPECT_RATIOS], ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
    assert.deepEqual([...JIMENG_IMAGE_SUPPORTED_RESOLUTIONS], ['2K', '4K']);
    assert.equal(JIMENG_IMAGE_SUPPORTED_ASPECT_RATIOS.length, 8);
});

test('即梦分辨率归一化：Auto 回落 720P，非法值报错', () => {
    assert.equal(normalizeJimengResolution('auto'), '720P');
    assert.equal(normalizeJimengResolution('自动'), '720P');
    assert.equal(normalizeJimengResolution(''), '720P');
    assert.equal(normalizeJimengResolution('1080p'), '1080P');
    assert.throws(() => normalizeJimengResolution('8K'), /只支持/);

    assert.equal(normalizeJimengImageResolution('auto'), '2K');
    assert.equal(normalizeJimengImageResolution('4k'), '4K');
    assert.throws(() => normalizeJimengImageResolution('1K'), /只支持/);
    assert.equal(normalizeJimengImageResolution('1K', 'jimeng-image-5-0-pro'), '1K');
});

test('单次生成张数按模型限制，越界直接报错而不是静默截断', () => {
    // 静默截断会让用户以为要 4 张却只拿到 1 张，还找不到原因。
    for (const count of [1, 2, 3, 4]) {
        assert.equal(normalizeJimengImageCount(count), count);
        assert.equal(normalizeGoogleFlowImageCount(count), count);
    }
    for (const count of [5, 6, 7, 8]) {
        assert.equal(normalizeJimengImageCount(count), count);
    }
    for (const bad of [0, 9, -1, 2.5]) {
        assert.throws(() => normalizeJimengImageCount(bad), /1-8/);
    }
    for (const bad of [0, 5, -1, 2.5]) {
        assert.throws(() => normalizeJimengImageCount(bad, 'jimeng-image-5-0-pro'), /1-4/);
        assert.throws(() => normalizeGoogleFlowImageCount(bad), /1-4/);
    }
});

// ---------------------------------------------------------------------------
// DOM 生成链路必须确实消失
// ---------------------------------------------------------------------------

test('适配器里不再有任何 DOM 点击生成的痕迹', () => {
    const files = [
        'geminiWebWorkflow', 'googleFlowWorkflow', 'googleFlowImageWorkflow',
        'jimengImageWorkflow', 'jimengVideoWorkflow'
    ];
    for (const name of files) {
        const source = fs.readFileSync(new URL(`../server/services/${name}.js`, import.meta.url), 'utf8');
        // 生成不再经由 ops-cli 子命令，也不再有浏览器兜底分支。
        assert.equal(/'text-to-image'|'image-to-video'/.test(source), false, `${name} 仍在拼生成子命令`);
        assert.equal(/browser:\s*\(\)/.test(source), false, `${name} 仍保留浏览器兜底分支`);
        assert.equal(/enqueue(Browser|GoogleFlow)Workflow/.test(source), false, `${name} 仍在往浏览器队列排生成任务`);
        assert.match(source, /runWithExecutionMode/, `${name} 应通过统一分发进入 HTTP 通道`);
    }
});

test('Python 侧的页面自动化 provider 目录已整体删除', () => {
    // fs.existsSync 不接受 URL 对象，必须转成路径。
    const platforms = fileURLToPath(new URL('../server/python/ops_cli/platforms', import.meta.url));
    assert.equal(fs.existsSync(platforms), false, 'platforms/ 应随 DOM 生成链路一起删除');
});

test('浏览器只剩登录 / 会话相关命令', () => {
    const cli = fs.readFileSync(new URL('../server/python/ops_cli/cli.py', import.meta.url), 'utf8');
    for (const kept of ['browser.open', 'browser.login', 'browser.close', 'browser.web-fetch', 'browser.web-context']) {
        assert.ok(cli.includes(kept), `应保留 ${kept}`);
    }
    // 生成类子命令与 DOM 识图命令都不该再注册。
    assert.equal(/text_to_image|image_to_video|gemini_web\.ask/.test(cli), false);
});
