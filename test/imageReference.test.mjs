import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveImageToBase64 } from '../server/utils/imageHelpers.js';

test('支持读取 URL 编码的项目图片路径', () => {
    const tempLibrary = fs.mkdtempSync(path.join(os.tmpdir(), 'twitcanva-image-'));
    const projectImagesDir = path.join(tempLibrary, 'projects', '未命名项目', 'images');
    const previousLibraryDir = process.env.LIBRARY_DIR;

    try {
        fs.mkdirSync(projectImagesDir, { recursive: true });
        fs.writeFileSync(path.join(projectImagesDir, 'reference.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        process.env.LIBRARY_DIR = tempLibrary;

        const encodedProject = encodeURIComponent('未命名项目');
        assert.equal(
            resolveImageToBase64(`/library/projects/${encodedProject}/images/reference.png?t=123`),
            'data:image/png;base64,iVBORw=='
        );
        assert.equal(
            resolveImageToBase64(`http://localhost:3001/library/projects/${encodedProject}/images/reference.png`),
            'data:image/png;base64,iVBORw=='
        );
    } finally {
        if (previousLibraryDir === undefined) delete process.env.LIBRARY_DIR;
        else process.env.LIBRARY_DIR = previousLibraryDir;
        fs.rmSync(tempLibrary, { recursive: true, force: true });
    }
});

test('解码后仍拒绝越出素材库的图片路径', () => {
    assert.equal(resolveImageToBase64('/library/%2E%2E/secret.png'), null);
    assert.equal(resolveImageToBase64('/library/%E0%A4%A'), null);
});
