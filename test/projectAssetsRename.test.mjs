import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    ensureProjectFolder,
    importProjectAsset,
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

test('new project creates an exact-name folder with image video and audio libraries', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twitcanva-project-root-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const projectsDir = path.join(root, 'projects');
    fs.mkdirSync(projectsDir);
    const workflow = { id: 'project-1', title: '莫妮卡 上海篇' };

    const projectRoot = ensureProjectFolder(workflow, { projectsDir }, { exactName: true });

    assert.equal(workflow.projectDirName, '莫妮卡 上海篇');
    assert.equal(projectRoot, path.join(projectsDir, '莫妮卡 上海篇'));
    for (const type of ['images', 'videos', 'audio']) {
        assert.equal(fs.existsSync(path.join(projectRoot, type)), true);
    }
});

test('project organizer copies image video audio and rewrites every node media URL', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twitcanva-project-assets-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dirs = {
        libraryDir: root,
        projectsDir: path.join(root, 'projects'),
        imagesDir: path.join(root, 'images'),
        videosDir: path.join(root, 'videos'),
        audioDir: path.join(root, 'audio')
    };
    for (const dir of Object.values(dirs).filter(value => value !== root)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dirs.imagesDir, 'face.png'), 'image');
    fs.writeFileSync(path.join(dirs.videosDir, 'shot.mp4'), 'video');
    fs.writeFileSync(path.join(dirs.audioDir, 'voice.mp3'), 'audio');
    fs.writeFileSync(path.join(dirs.audioDir, 'voice-id.json'), JSON.stringify({ id: 'voice-id', filename: 'voice.mp3', text: '台词' }));
    const workflow = {
        id: 'abc12345-0000-0000-0000-000000000000',
        title: '第一集',
        nodes: [
            { resultUrl: '/library/images/face.png' },
            { resultUrl: '/library/videos/shot.mp4', mediaUrl: '/library/audio/voice.mp3' }
        ]
    };

    const result = organizeWorkflowAssets(workflow, dirs);

    assert.equal(result.changed, true);
    assert.equal(workflow.nodes[0].resultUrl, '/library/projects/%E7%AC%AC%E4%B8%80%E9%9B%86/images/face.png');
    assert.equal(workflow.nodes[1].resultUrl, '/library/projects/%E7%AC%AC%E4%B8%80%E9%9B%86/videos/shot.mp4');
    assert.equal(workflow.nodes[1].mediaUrl, '/library/projects/%E7%AC%AC%E4%B8%80%E9%9B%86/audio/voice.mp3');
    assert.equal(fs.existsSync(path.join(dirs.projectsDir, '第一集', 'audio', 'voice.json')), true);
});

test('importing another project asset creates an independent copy', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twitcanva-project-copy-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dirs = {
        libraryDir: root,
        projectsDir: path.join(root, 'projects'),
        imagesDir: path.join(root, 'images'),
        videosDir: path.join(root, 'videos'),
        audioDir: path.join(root, 'audio')
    };
    fs.mkdirSync(path.join(dirs.projectsDir, '项目甲', 'images'), { recursive: true });
    fs.writeFileSync(path.join(dirs.projectsDir, '项目甲', 'images', '共享图.png'), 'source');
    const target = { id: 'project-b', title: '项目乙', projectDirName: '项目乙' };

    const imported = importProjectAsset(target, '/library/projects/%E9%A1%B9%E7%9B%AE%E7%94%B2/images/%E5%85%B1%E4%BA%AB%E5%9B%BE.png', dirs);

    assert.equal(imported.url, '/library/projects/%E9%A1%B9%E7%9B%AE%E4%B9%99/images/%E5%85%B1%E4%BA%AB%E5%9B%BE.png');
    fs.writeFileSync(path.join(dirs.projectsDir, '项目甲', 'images', '共享图.png'), 'changed');
    assert.equal(fs.readFileSync(path.join(dirs.projectsDir, '项目乙', 'images', '共享图.png'), 'utf8'), 'source');
});

test('renaming a modern project renames the single root folder and rewrites image video audio URLs', (t) => {
    const dirs = makeLibrary();
    t.after(() => fs.rmSync(dirs.root, { recursive: true, force: true }));
    dirs.projectsDir = path.join(dirs.root, 'projects');
    const oldRoot = path.join(dirs.projectsDir, '旧项目');
    for (const type of ['images', 'videos', 'audio']) fs.mkdirSync(path.join(oldRoot, type), { recursive: true });
    fs.writeFileSync(path.join(oldRoot, 'images', 'face.png'), 'image');
    fs.writeFileSync(path.join(oldRoot, 'audio', 'voice.mp3'), 'audio');
    const workflow = {
        id: 'modern-project',
        title: '旧项目',
        projectDirName: '旧项目',
        nodes: [{
            resultUrl: '/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/images/face.png',
            mediaUrl: '/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/audio/voice.mp3',
            imageVersions: [{ url: '/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/images/face.png' }]
        }]
    };

    const result = renameWorkflowAssetDirs(workflow, '新项目', dirs);

    assert.equal(result.changed, true);
    assert.equal(workflow.projectDirName, '新项目');
    assert.equal(fs.existsSync(path.join(dirs.projectsDir, '旧项目')), false);
    assert.equal(fs.existsSync(path.join(dirs.projectsDir, '新项目', 'audio', 'voice.mp3')), true);
    assert.equal(workflow.nodes[0].resultUrl, '/library/projects/%E6%96%B0%E9%A1%B9%E7%9B%AE/images/face.png');
    assert.equal(workflow.nodes[0].mediaUrl, '/library/projects/%E6%96%B0%E9%A1%B9%E7%9B%AE/audio/voice.mp3');
    assert.equal(workflow.nodes[0].imageVersions[0].url, '/library/projects/%E6%96%B0%E9%A1%B9%E7%9B%AE/images/face.png');
});
