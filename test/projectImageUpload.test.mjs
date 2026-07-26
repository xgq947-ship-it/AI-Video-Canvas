import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { saveProjectImageUpload } from '../server/utils/projectAssets.js';

/**
 * 画布图片导入改成了二进制直传：请求体就是图片本身。
 *
 * 旧的 data URL 路径对大图非常伤 —— 一张 100MB 的图会在渲染进程里先变成 133MB
 * base64，JSON.stringify 再复制一份，后端还要解析出同样大的字符串。
 * 这里锁住两件事：新的 buffer 入参能正确落盘，旧的 data URL 入参继续可用。
 */

const PNG_BYTES = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);

function makeProject(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-image-upload-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const projectsDir = path.join(root, 'projects');
    fs.mkdirSync(projectsDir);
    return {
        projectsDir,
        workflow: {
            id: '11111111-2222-3333-4444-555555555555',
            title: '测试项目',
            nodes: []
        }
    };
}

test('二进制直传的图片会原样落盘并写出 sidecar 元数据', (t) => {
    const { projectsDir, workflow } = makeProject(t);

    const saved = saveProjectImageUpload(
        workflow,
        {
            buffer: PNG_BYTES,
            mimeType: 'image/png',
            originalFilename: '中文 文件名.png',
            prompt: '中文 文件名.png'
        },
        { projectsDir }
    );

    const imagePath = path.join(projectsDir, workflow.projectDirName, 'images', saved.filename);
    assert.ok(saved.filename.endsWith('.png'));
    assert.deepEqual(fs.readFileSync(imagePath), PNG_BYTES, '写盘的字节必须与上传的完全一致');
    assert.equal(saved.metadata.mimeType, 'image/png');
    assert.equal(saved.metadata.originalFilename, '中文 文件名.png');

    const sidecarPath = imagePath.replace(/\.png$/, '.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(sidecarPath, 'utf8')), saved.metadata);
});

test('旧的 data URL 入参继续可用', (t) => {
    const { projectsDir, workflow } = makeProject(t);

    const saved = saveProjectImageUpload(
        workflow,
        { data: `data:image/png;base64,${PNG_BYTES.toString('base64')}`, prompt: 'legacy.png' },
        { projectsDir }
    );

    const imagePath = path.join(projectsDir, workflow.projectDirName, 'images', saved.filename);
    assert.deepEqual(fs.readFileSync(imagePath), PNG_BYTES);
    assert.equal(saved.metadata.mimeType, 'image/png');
});

test('不支持的 MIME 被拒绝，不会写出任何文件', (t) => {
    const { projectsDir, workflow } = makeProject(t);

    assert.throws(
        () => saveProjectImageUpload(
            workflow,
            { buffer: PNG_BYTES, mimeType: 'application/pdf' },
            { projectsDir }
        ),
        error => error.code === 'UNSUPPORTED_IMAGE'
    );
});

test('空 body 被拒绝，不会留下 0 字节文件', (t) => {
    const { projectsDir, workflow } = makeProject(t);

    assert.throws(
        () => saveProjectImageUpload(
            workflow,
            { buffer: Buffer.alloc(0), mimeType: 'image/png' },
            { projectsDir }
        ),
        error => error.code === 'UNSUPPORTED_IMAGE'
    );
});

test('超过 100MB 的图片被拒绝', (t) => {
    const { projectsDir, workflow } = makeProject(t);

    assert.throws(
        () => saveProjectImageUpload(
            workflow,
            { buffer: Buffer.alloc(100 * 1024 * 1024 + 1), mimeType: 'image/png' },
            { projectsDir }
        ),
        error => error.code === 'IMAGE_TOO_LARGE'
    );
});
