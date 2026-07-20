import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    organizeWorkflowAssets,
    renameWorkflowAssetDirs
} from '../server/utils/projectAssets.js';

function makeLibrary() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twitcanva-project-rename-'));
    const imagesDir = path.join(root, 'images');
    const videosDir = path.join(root, 'videos');
    fs.mkdirSync(imagesDir);
    fs.mkdirSync(videosDir);
    return { root, imagesDir, videosDir };
}

test('renaming a project also renames image/video folders and rewrites media URLs', (t) => {
    const dirs = makeLibrary();
    t.after(() => fs.rmSync(dirs.root, { recursive: true, force: true }));

    const oldName = '未命名项目_37d44ea1';
    fs.mkdirSync(path.join(dirs.imagesDir, oldName));
    fs.mkdirSync(path.join(dirs.videosDir, oldName));
    fs.writeFileSync(path.join(dirs.imagesDir, oldName, 'face.png'), 'image');
    fs.writeFileSync(path.join(dirs.videosDir, oldName, 'shot.mp4'), 'video');

    const workflow = {
        id: '37d44ea1-0000-0000-0000-000000000000',
        title: '未命名项目',
        assetsDirName: oldName,
        coverUrl: '/library/images/未命名项目_37d44ea1/face.png',
        nodes: [{
            resultUrl: '/library/images/未命名项目_37d44ea1/face.png',
            lastFrame: 'http://localhost:3001/library/videos/未命名项目_37d44ea1/shot.mp4'
        }]
    };

    const result = renameWorkflowAssetDirs(workflow, '莫妮卡：上海 / 夜景', dirs);
    const expected = '莫妮卡：上海夜景_37d44ea1';

    assert.equal(result.changed, true);
    assert.equal(workflow.assetsDirName, expected);
    assert.equal(workflow.coverUrl, `/library/images/${expected}/face.png`);
    assert.equal(workflow.nodes[0].resultUrl, `/library/images/${expected}/face.png`);
    assert.equal(workflow.nodes[0].lastFrame, `http://localhost:3001/library/videos/${expected}/shot.mp4`);
    assert.equal(fs.existsSync(path.join(dirs.imagesDir, oldName)), false);
    assert.equal(fs.existsSync(path.join(dirs.videosDir, oldName)), false);
    assert.equal(fs.readFileSync(path.join(dirs.imagesDir, expected, 'face.png'), 'utf8'), 'image');
    assert.equal(fs.readFileSync(path.join(dirs.videosDir, expected, 'shot.mp4'), 'utf8'), 'video');
});

test('an in-flight save with the old folder URL is normalized to the renamed folder', (t) => {
    const dirs = makeLibrary();
    t.after(() => fs.rmSync(dirs.root, { recursive: true, force: true }));

    const newName = '新项目_37d44ea1';
    fs.mkdirSync(path.join(dirs.imagesDir, newName));
    fs.writeFileSync(path.join(dirs.imagesDir, newName, 'face.png'), 'image');
    const workflow = {
        id: '37d44ea1-0000-0000-0000-000000000000',
        title: '新项目',
        assetsDirName: newName,
        nodes: [{ resultUrl: '/library/images/未命名项目_37d44ea1/face.png' }]
    };

    const result = organizeWorkflowAssets(workflow, dirs);

    assert.equal(result.changed, true);
    assert.equal(workflow.nodes[0].resultUrl, `/library/images/${newName}/face.png`);
});
