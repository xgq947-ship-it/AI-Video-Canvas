import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    ensureProjectFolder,
    importProjectAsset,
    organizeWorkflowAssets,
    renameWorkflowAssetDirs,
    saveProjectImageUpload
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

test('pasted image is written directly into the active project folder with metadata', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twitcanva-project-paste-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const projectsDir = path.join(root, 'projects');
    fs.mkdirSync(projectsDir);
    const workflow = { id: 'project-paste', title: '粘贴测试', projectDirName: '粘贴测试' };
    const data = `data:image/png;base64,${Buffer.from('fake-png').toString('base64')}`;

    const saved = saveProjectImageUpload(workflow, {
        data,
        prompt: '剪贴板图片.png',
        originalFilename: '剪贴板图片.png'
    }, { projectsDir });

    assert.match(saved.url, /^\/library\/projects\/%E7%B2%98%E8%B4%B4%E6%B5%8B%E8%AF%95\/images\/img_/);
    const imagePath = path.join(projectsDir, '粘贴测试', 'images', saved.filename);
    const metadataPath = imagePath.replace(/\.png$/, '.json');
    assert.equal(fs.readFileSync(imagePath, 'utf8'), 'fake-png');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    assert.equal(metadata.filename, saved.filename);
    assert.equal(metadata.originalFilename, '剪贴板图片.png');
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

test('素材库分类图片导入项目时使用稳定唯一文件名并隔离源文件', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twitcanva-curated-copy-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dirs = {
        libraryDir: root,
        projectsDir: path.join(root, 'projects'),
        imagesDir: path.join(root, 'images'),
        videosDir: path.join(root, 'videos'),
        audioDir: path.join(root, 'audio')
    };
    const sourceDir = path.join(root, 'assets', 'Character', '苏曼');
    const otherSourceDir = path.join(root, 'assets', 'Character', '林舟');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(otherSourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, '正面.png'), 'character-source');
    fs.writeFileSync(path.join(otherSourceDir, '正面.png'), 'other-character-source');
    const target = { id: 'project-remix', title: '二创项目', projectDirName: '二创项目' };

    const first = importProjectAsset(
        target,
        '/library/assets/Character/%E8%8B%8F%E6%9B%BC/%E6%AD%A3%E9%9D%A2.png',
        dirs
    );
    const second = importProjectAsset(
        target,
        '/library/assets/Character/%E8%8B%8F%E6%9B%BC/%E6%AD%A3%E9%9D%A2.png',
        dirs
    );

    assert.equal(first.url, second.url);
    assert.match(first.url, /^\/library\/projects\/%E4%BA%8C%E5%88%9B%E9%A1%B9%E7%9B%AE\/images\/%E6%AD%A3%E9%9D%A2_[a-f0-9]{8}\.png$/);
    const other = importProjectAsset(
        target,
        '/library/assets/Character/%E6%9E%97%E8%88%9F/%E6%AD%A3%E9%9D%A2.png',
        dirs
    );
    assert.notEqual(first.url, other.url);
    const importedName = decodeURIComponent(first.url.split('/').at(-1));
    fs.writeFileSync(path.join(sourceDir, '正面.png'), 'changed');
    assert.equal(
        fs.readFileSync(path.join(dirs.projectsDir, '二创项目', 'images', importedName), 'utf8'),
        'character-source'
    );
    assert.throws(
        () => importProjectAsset(
            target,
            '/library/assets/Character/%2E%2E/secret.png',
            dirs
        ),
        error => error?.code === 'UNSUPPORTED_ASSET_URL'
    );
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
        videoRemixes: [{
            id: 'remix-root',
            state: {
                source: {
                    localUrl: '/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/video-remix/remix_root/source/original.mp4',
                    previewUrl: 'http://localhost:3001/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/video-remix/remix_root/source/original.mp4?t=1'
                },
                assets: {
                    props: [{
                        referenceImages: [
                            '/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/images/product-reference.png'
                        ]
                    }]
                },
                output: {
                    url: '/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/video-remix/remix_root/final/final.mp4'
                }
            }
        }],
        nodes: [{
            resultUrl: '/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/images/face.png',
            mediaUrl: '/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/audio/voice.mp3',
            imageVersions: [{ url: '/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/images/face.png' }],
            videoRemix: {
                source: {
                    localUrl: '/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/video-remix/remix_1/source/ref_1/original.mp4',
                    previewUrl: 'http://localhost:3001/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/video-remix/remix_1/source/ref_1/original.mp4?t=1',
                    proxyUrl: '/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/video-remix/remix_1/preprocess/run_1/analysis_proxy.mp4',
                    sourceUrl: 'https://example.com/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/external.mp4'
                },
                shots: [{
                    analysisFrames: [{
                        url: '/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/video-remix/remix_1/preprocess/run_1/shots/shot_001/frames/start.jpg'
                    }]
                }],
                assets: {
                    characters: [{
                        referenceImages: [
                            '/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/video-remix/remix_1/keyframes/character.png'
                        ]
                    }]
                },
                output: {
                    url: '/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/video-remix/remix_1/final/final.mp4'
                }
            }
        }, {
            videoRemix: {
                source: {
                    sourceType: 'canvas',
                    sourceUrl: '/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/videos/original-canvas.mp4',
                    localUrl: '/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/video-remix/remix_2/source/ref_2/original.mp4'
                }
            }
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
    assert.equal(
        workflow.nodes[0].videoRemix.source.localUrl,
        '/library/projects/%E6%96%B0%E9%A1%B9%E7%9B%AE/video-remix/remix_1/source/ref_1/original.mp4'
    );
    assert.equal(
        workflow.nodes[0].videoRemix.source.previewUrl,
        'http://localhost:3001/library/projects/%E6%96%B0%E9%A1%B9%E7%9B%AE/video-remix/remix_1/source/ref_1/original.mp4?t=1'
    );
    assert.equal(
        workflow.nodes[0].videoRemix.source.sourceUrl,
        'https://example.com/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE/external.mp4'
    );
    assert.equal(
        workflow.nodes[0].videoRemix.source.proxyUrl,
        '/library/projects/%E6%96%B0%E9%A1%B9%E7%9B%AE/video-remix/remix_1/preprocess/run_1/analysis_proxy.mp4'
    );
    assert.equal(
        workflow.nodes[0].videoRemix.shots[0].analysisFrames[0].url,
        '/library/projects/%E6%96%B0%E9%A1%B9%E7%9B%AE/video-remix/remix_1/preprocess/run_1/shots/shot_001/frames/start.jpg'
    );
    assert.equal(
        workflow.nodes[0].videoRemix.assets.characters[0].referenceImages[0],
        '/library/projects/%E6%96%B0%E9%A1%B9%E7%9B%AE/video-remix/remix_1/keyframes/character.png'
    );
    assert.equal(
        workflow.nodes[0].videoRemix.output.url,
        '/library/projects/%E6%96%B0%E9%A1%B9%E7%9B%AE/video-remix/remix_1/final/final.mp4'
    );
    assert.equal(
        workflow.nodes[1].videoRemix.source.sourceUrl,
        '/library/projects/%E6%96%B0%E9%A1%B9%E7%9B%AE/videos/original-canvas.mp4'
    );
    assert.equal(
        workflow.videoRemixes[0].state.source.localUrl,
        '/library/projects/%E6%96%B0%E9%A1%B9%E7%9B%AE/video-remix/remix_root/source/original.mp4'
    );
    assert.equal(
        workflow.videoRemixes[0].state.source.previewUrl,
        'http://localhost:3001/library/projects/%E6%96%B0%E9%A1%B9%E7%9B%AE/video-remix/remix_root/source/original.mp4?t=1'
    );
    assert.equal(
        workflow.videoRemixes[0].state.assets.props[0].referenceImages[0],
        '/library/projects/%E6%96%B0%E9%A1%B9%E7%9B%AE/images/product-reference.png'
    );
    assert.equal(
        workflow.videoRemixes[0].state.output.url,
        '/library/projects/%E6%96%B0%E9%A1%B9%E7%9B%AE/video-remix/remix_root/final/final.mp4'
    );
});

test('project organizer relocates media referenced only by a project-level remix task', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twitcanva-remix-root-assets-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dirs = {
        libraryDir: root,
        projectsDir: path.join(root, 'projects'),
        imagesDir: path.join(root, 'images'),
        videosDir: path.join(root, 'videos'),
        audioDir: path.join(root, 'audio')
    };
    for (const dir of Object.values(dirs).filter(value => value !== root)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dirs.imagesDir, 'identity.png'), 'identity');
    fs.writeFileSync(path.join(dirs.videosDir, 'reference.mp4'), 'reference');
    const workflow = {
        id: 'root-remix-project',
        title: '独立复刻',
        nodes: [],
        videoRemixes: [{
            id: 'remix-1',
            state: {
                source: { localUrl: '/library/videos/reference.mp4' },
                assets: { characters: [{ referenceImages: ['/library/images/identity.png'] }] }
            }
        }]
    };

    const result = organizeWorkflowAssets(workflow, dirs);

    assert.equal(result.changed, true);
    assert.equal(
        workflow.videoRemixes[0].state.source.localUrl,
        '/library/projects/%E7%8B%AC%E7%AB%8B%E5%A4%8D%E5%88%BB/videos/reference.mp4'
    );
    assert.equal(
        workflow.videoRemixes[0].state.assets.characters[0].referenceImages[0],
        '/library/projects/%E7%8B%AC%E7%AB%8B%E5%A4%8D%E5%88%BB/images/identity.png'
    );
    assert.equal(fs.readFileSync(path.join(dirs.projectsDir, '独立复刻', 'images', 'identity.png'), 'utf8'), 'identity');
    assert.equal(fs.readFileSync(path.join(dirs.projectsDir, '独立复刻', 'videos', 'reference.mp4'), 'utf8'), 'reference');
});
