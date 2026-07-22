import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    buildGoogleFlowImageWorkflowArgs,
    GOOGLE_FLOW_IMAGE_SUPPORTED_ASPECT_RATIOS,
    GOOGLE_FLOW_IMAGE_WORKFLOW_MODEL_ID,
    isGoogleFlowImageWorkflowModel,
    loadGoogleFlowImageResult,
    resolveGoogleFlowImageModelName,
    resolveGoogleFlowReferenceImages
} from '../server/services/googleFlowImageWorkflow.js';

test('Google Flow 文生图原样传递提示词和真实生成参数', () => {
    const args = buildGoogleFlowImageWorkflowArgs({
        prompt: '  电影感上海夜景，暖色灯光  ',
        aspectRatio: '9:16',
        referenceImages: ['/tmp/ref-1.png', '/tmp/ref-2.webp'],
        outputDir: '/tmp/output',
        timeoutMinutes: 10
    });

    assert.deepEqual(args, [
        '--prompt', '电影感上海夜景，暖色灯光',
        '--aspect-ratio', '9:16',
        '--count', '1',
        '--model', 'Nano Banana 2',
        '--output-dir', '/tmp/output',
        '--timeout-minutes', '10',
        '--reference-image', '/tmp/ref-1.png',
        '--reference-image', '/tmp/ref-2.webp',
        '--execute'
    ]);
});

test('Google Flow 文生图使用稳定模型 ID 与上游支持的画幅', () => {
    assert.equal(GOOGLE_FLOW_IMAGE_WORKFLOW_MODEL_ID, 'google-flow-nano-banana-2');
    assert.deepEqual(GOOGLE_FLOW_IMAGE_SUPPORTED_ASPECT_RATIOS, ['16:9', '4:3', '1:1', '3:4', '9:16']);
});

test('Google Flow 文生图支持页面全部三个模型映射', () => {
    assert.equal(isGoogleFlowImageWorkflowModel('google-flow-nano-banana-2'), true);
    assert.equal(isGoogleFlowImageWorkflowModel('google-flow-nano-banana-pro'), true);
    assert.equal(isGoogleFlowImageWorkflowModel('google-flow-nano-banana-2-lite'), true);
    assert.equal(isGoogleFlowImageWorkflowModel('gemini-pro'), false);
    assert.equal(resolveGoogleFlowImageModelName('google-flow-nano-banana-pro'), 'Nano Banana Pro');
    assert.equal(resolveGoogleFlowImageModelName('google-flow-nano-banana-2'), 'Nano Banana 2');
    assert.equal(resolveGoogleFlowImageModelName('google-flow-nano-banana-2-lite'), 'Nano Banana 2 Lite');
    assert.equal(resolveGoogleFlowImageModelName('unknown'), 'Nano Banana 2');

    const proArgs = buildGoogleFlowImageWorkflowArgs({
        prompt: 'p',
        aspectRatio: '1:1',
        outputDir: '/tmp/out',
        timeoutMinutes: 10,
        flowModel: 'Nano Banana Pro'
    });
    assert.equal(proArgs[proArgs.indexOf('--model') + 1], 'Nano Banana Pro');

    const liteArgs = buildGoogleFlowImageWorkflowArgs({
        prompt: 'p',
        aspectRatio: '1:1',
        outputDir: '/tmp/out',
        timeoutMinutes: 10,
        flowModel: 'Nano Banana 2 Lite'
    });
    assert.equal(liteArgs[liteArgs.indexOf('--model') + 1], 'Nano Banana 2 Lite');
});

test('Google Flow 文生图读取 workflow 返回的本地图片', async () => {
    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-google-flow-image-test-'));
    try {
        const imagePath = path.join(taskDir, 'result.webp');
        const expected = Buffer.from('workflow-image');
        fs.writeFileSync(imagePath, expected);

        const result = await loadGoogleFlowImageResult({
            images: [{ path: imagePath, url: null }],
            image_paths: [imagePath]
        });

        assert.deepEqual(result.buffer, expected);
        assert.equal(result.extension, 'webp');
        assert.equal(result.source, 'workflow-file');
    } finally {
        fs.rmSync(taskDir, { recursive: true, force: true });
    }
});

test('Google Flow 文生图把素材库 URL 与 Base64 参考图转换为本地文件', async () => {
    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-google-flow-reference-test-'));
    const libraryDir = path.join(taskDir, 'library');
    const libraryImage = path.join(libraryDir, 'images', '人物.png');
    fs.mkdirSync(path.dirname(libraryImage), { recursive: true });
    fs.writeFileSync(libraryImage, Buffer.from('library-image'));

    try {
        const dataUrl = `data:image/png;base64,${Buffer.from('data-image').toString('base64')}`;
        const references = await resolveGoogleFlowReferenceImages([
            '/library/images/%E4%BA%BA%E7%89%A9.png?t=123',
            dataUrl
        ], libraryDir, taskDir);

        assert.equal(references[0], libraryImage);
        assert.equal(path.basename(references[1]), 'reference-2.png');
        assert.deepEqual(fs.readFileSync(references[1]), Buffer.from('data-image'));
    } finally {
        fs.rmSync(taskDir, { recursive: true, force: true });
    }
});

// —— 回归：塌缩掉中间层后，Node 直接吃 ops_cli 的原始输出 ——
// 中间层曾额外派生过一个 image_paths 便利字段，删掉它之后这里必须仍能工作，
// 否则会退化成「没有可用的图片文件或下载地址」——而 dry-run 不产图，测不出来。
test('图片结果直接从 ops_cli 原生的 images[].path 读取（无 image_paths 兜底）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-image-shape-'));
    const file = path.join(dir, 'result.png');
    fs.writeFileSync(file, Buffer.from('89504e470d0a1a0a', 'hex'));
    try {
        // 与 ops_cli text-to-image 真实输出同构：只有 images，没有 image_paths。
        const result = await loadGoogleFlowImageResult({ images: [{ path: file, url: null }] });
        assert.equal(result.source, 'workflow-file');
        assert.equal(result.extension, 'png');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('图片结果在本地文件缺失时回退到 images[].url', async () => {
    const outputs = { images: [{ path: '/definitely/missing.png', url: 'not-a-url' }] };
    await assert.rejects(() => loadGoogleFlowImageResult(outputs), /没有可用的图片文件或下载地址/);
});
