import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildJimengImageWorkflowArgs,
    isJimengImageWorkflowModel,
    JIMENG_IMAGE_MAX_COUNT,
    JIMENG_IMAGE_LITE_MODEL_ID,
    JIMENG_IMAGE_PRO_MODEL_ID,
    JIMENG_IMAGE_SUPPORTED_ASPECT_RATIOS,
    JIMENG_IMAGE_SUPPORTED_RESOLUTIONS,
    normalizeJimengImageCount,
    normalizeJimengImageResolution,
    resolveJimengImageModelLabel
} from '../server/services/jimengImageWorkflow.js';

test('即梦画板只接入图片 5.0 Pro 与图片 5.0 Lite', () => {
    assert.equal(JIMENG_IMAGE_PRO_MODEL_ID, 'jimeng-image-5-0-pro');
    assert.equal(JIMENG_IMAGE_LITE_MODEL_ID, 'jimeng-image-5-0-lite');
    assert.equal(resolveJimengImageModelLabel(JIMENG_IMAGE_PRO_MODEL_ID), '图片 5.0 Pro');
    assert.equal(resolveJimengImageModelLabel(JIMENG_IMAGE_LITE_MODEL_ID), '图片 5.0 Lite');
    assert.equal(isJimengImageWorkflowModel(JIMENG_IMAGE_PRO_MODEL_ID), true);
    assert.equal(isJimengImageWorkflowModel(JIMENG_IMAGE_LITE_MODEL_ID), true);
    assert.equal(isJimengImageWorkflowModel('jimeng-image-4-7'), false);
});

test('即梦生图参数完整映射到 Ops CLI 并保持参考图顺序', () => {
    const args = buildJimengImageWorkflowArgs({
        prompt: '  商业产品摄影，柔和顶光  ',
        referenceImages: ['/tmp/product.png', '/tmp/scene.webp'],
        aspectRatio: '3:2',
        resolution: '4k',
        outputDir: '/tmp/output',
        timeoutMinutes: 10,
        model: '图片 5.0 Pro',
        count: 4
    });

    assert.deepEqual(args, [
        '--prompt', '商业产品摄影，柔和顶光',
        '--aspect-ratio', '3:2',
        '--resolution', '4K',
        '--count', '4',
        '--model', '图片 5.0 Pro',
        '--output-dir', '/tmp/output',
        '--timeout-minutes', '10',
        '--reference-image', '/tmp/product.png',
        '--reference-image', '/tmp/scene.webp',
        '--execute'
    ]);
});

test('即梦图片比例和分辨率与实时页面一致', () => {
    assert.deepEqual(
        [...JIMENG_IMAGE_SUPPORTED_ASPECT_RATIOS],
        ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16']
    );
    assert.deepEqual([...JIMENG_IMAGE_SUPPORTED_RESOLUTIONS], ['2K', '4K']);
    assert.equal(normalizeJimengImageResolution('Auto'), '2K');
    assert.equal(normalizeJimengImageResolution('4k'), '4K');
    assert.throws(() => normalizeJimengImageResolution('8K'), /只支持 2K 或 4K/);
});

test('即梦图片单次生成数量限制为 1-4 张', () => {
    assert.equal(JIMENG_IMAGE_MAX_COUNT, 4);
    assert.equal(normalizeJimengImageCount(1), 1);
    assert.equal(normalizeJimengImageCount('4'), 4);
    assert.throws(() => normalizeJimengImageCount(0), /只支持 1-4/);
    assert.throws(() => normalizeJimengImageCount(5), /只支持 1-4/);
});
