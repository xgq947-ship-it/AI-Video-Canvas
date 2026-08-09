import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    getProjectTrashPreviewPath,
    listProjectTrash,
    permanentlyDeleteProjectTrashEntry,
    PROJECT_TRASH_RETENTION_MS,
    purgeAllProjectTrash,
    purgeExpiredProjectTrash,
    restoreProjectTrashEntry,
    trashWorkflowNodes
} from '../server/services/projectTrash.js';

const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

const createFixture = (t) => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-project-trash-'));
    t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
    fs.mkdirSync(path.join(projectRoot, 'images'), { recursive: true });
    const filename = 'generated.png';
    const imagePath = path.join(projectRoot, 'images', filename);
    const sidecarPath = path.join(projectRoot, 'images', 'generated.json');
    const nodeMetadataPath = path.join(projectRoot, 'images', 'image-1.json');
    fs.writeFileSync(imagePath, Buffer.from('image-bytes'));
    fs.writeFileSync(sidecarPath, JSON.stringify({ filename }));
    fs.writeFileSync(nodeMetadataPath, JSON.stringify({ id: 'image-1', filename }));
    const resultUrl = '/library/projects/TestProject/images/generated.png?t=1';
    const node = {
        id: 'image-1',
        type: 'Image',
        title: '测试图片',
        x: 100,
        y: 200,
        prompt: 'test',
        resultUrl
    };
    const workflow = {
        id: 'workflow-1',
        projectDirName: 'TestProject',
        nodes: [node]
    };
    return { projectRoot, imagePath, sidecarPath, nodeMetadataPath, resultUrl, node, workflow };
};

const createVideoFixture = (t) => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-project-video-trash-'));
    t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
    fs.mkdirSync(path.join(projectRoot, 'videos'), { recursive: true });
    const filename = 'generated.mp4';
    const videoPath = path.join(projectRoot, 'videos', filename);
    const metadataPath = path.join(projectRoot, 'videos', 'video-1.json');
    fs.writeFileSync(videoPath, Buffer.from('video-bytes'));
    fs.writeFileSync(metadataPath, JSON.stringify({ id: 'video-1', filename }));
    const resultUrl = '/library/projects/TestProject/videos/generated.mp4';
    const node = {
        id: 'video-1',
        type: 'Video',
        title: '测试视频',
        resultUrl
    };
    const workflow = {
        id: 'workflow-video-1',
        projectDirName: 'TestProject',
        nodes: [node]
    };
    return { projectRoot, videoPath, metadataPath, resultUrl, node, workflow };
};

test('删除最后一个图片引用时把本地文件移入项目回收站并可完整恢复', (t) => {
    const fixture = createFixture(t);
    const now = Date.parse('2026-07-26T00:00:00.000Z');
    const result = trashWorkflowNodes(
        fixture.workflow,
        [fixture.node],
        [fixture.node.id],
        fixture.projectRoot,
        now
    );

    assert.ok(result.entry);
    assert.equal(result.entry.expiresAt, new Date(now + PROJECT_TRASH_RETENTION_MS).toISOString());
    assert.equal(fs.existsSync(fixture.imagePath), false);
    assert.equal(fs.existsSync(fixture.sidecarPath), false);
    assert.equal(fs.existsSync(fixture.nodeMetadataPath), false);
    assert.ok(getProjectTrashPreviewPath(fixture.projectRoot, result.entry.id));
    assert.equal(listProjectTrash(fixture.workflow, fixture.projectRoot, now).length, 1);

    const restored = restoreProjectTrashEntry(fixture.workflow, fixture.projectRoot, result.entry.id);
    assert.deepEqual(restored.map(node => node.id), ['image-1']);
    assert.equal(fs.readFileSync(fixture.imagePath, 'utf8'), 'image-bytes');
    assert.deepEqual(JSON.parse(fs.readFileSync(fixture.sidecarPath, 'utf8')), {
        filename: 'generated.png'
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(fixture.nodeMetadataPath, 'utf8')), {
        id: 'image-1',
        filename: 'generated.png'
    });
    assert.equal(listProjectTrash(fixture.workflow, fixture.projectRoot, now).length, 0);
});

test('同一图片仍被其他画布节点引用时保留原文件，同时为回收站保留独立备份', (t) => {
    const fixture = createFixture(t);
    const sharedNode = { ...fixture.node, id: 'image-2', x: 500 };
    fixture.workflow.nodes = [fixture.node, sharedNode];

    const result = trashWorkflowNodes(
        fixture.workflow,
        [fixture.node, sharedNode],
        [fixture.node.id],
        fixture.projectRoot
    );

    assert.ok(result.entry);
    assert.equal(fs.existsSync(fixture.imagePath), true);
    assert.ok(getProjectTrashPreviewPath(fixture.projectRoot, result.entry.id));
    assert.deepEqual(fixture.workflow.nodes.map(node => node.id), ['image-2']);
});

test('删除视频节点时把视频和元数据移入项目回收站并可恢复', (t) => {
    const fixture = createVideoFixture(t);
    const result = trashWorkflowNodes(
        fixture.workflow,
        [fixture.node],
        [fixture.node.id],
        fixture.projectRoot
    );

    assert.ok(result.entry);
    assert.equal(result.entry.mediaType, 'videos');
    assert.equal(fs.existsSync(fixture.videoPath), false);
    assert.equal(fs.existsSync(fixture.metadataPath), false);
    assert.ok(getProjectTrashPreviewPath(fixture.projectRoot, result.entry.id));

    const restored = restoreProjectTrashEntry(fixture.workflow, fixture.projectRoot, result.entry.id);
    assert.deepEqual(restored.map(node => node.id), ['video-1']);
    assert.equal(fs.readFileSync(fixture.videoPath, 'utf8'), 'video-bytes');
    assert.deepEqual(JSON.parse(fs.readFileSync(fixture.metadataPath, 'utf8')), {
        id: 'video-1',
        filename: 'generated.mp4'
    });
});

test('图片仍被独立复刻任务引用时保留项目文件', (t) => {
    const fixture = createFixture(t);
    fixture.workflow.videoRemixes = [{
        id: 'remix-1',
        state: {
            assets: {
                characters: [{ referenceImages: [fixture.resultUrl] }]
            }
        }
    }];

    const result = trashWorkflowNodes(
        fixture.workflow,
        [fixture.node],
        [fixture.node.id],
        fixture.projectRoot
    );

    assert.ok(result.entry);
    assert.equal(fs.existsSync(fixture.imagePath), true);
    assert.ok(getProjectTrashPreviewPath(fixture.projectRoot, result.entry.id));
    assert.deepEqual(fixture.workflow.nodes, []);
});

test('删除项目图片或视频时统一调用项目回收站，并先清除选中态', () => {
    const block = appSource.slice(
        appSource.indexOf('const deleteNodesWithTrash'),
        appSource.indexOf('// Simple dirty flag')
    );
    assert.ok(block.length > 0);
    assert.ok(
        block.indexOf('setSelectedNodeIds') < block.indexOf("fetch(`/api/projects/"),
        '磁盘回收站请求前必须先关闭所删节点的控制面板'
    );
    assert.match(block, /deleteNodes\(uniqueIds\)/);
    assert.match(block, /NodeType\.VIDEO/);
    assert.match(block, /\(\?:images\|videos\)/);
});

test('图片和文字节点一起删除时两者都进入回收站且可一起恢复', (t) => {
    const fixture = createFixture(t);
    const textNode = {
        id: 'text-1',
        type: 'Text',
        title: '产品场景提示词',
        x: 500,
        y: 200,
        prompt: '生成一张商业产品场景图'
    };
    fixture.workflow.nodes = [fixture.node, textNode];

    const result = trashWorkflowNodes(
        fixture.workflow,
        [fixture.node, textNode],
        [fixture.node.id, textNode.id],
        fixture.projectRoot
    );

    assert.deepEqual(result.deletedNodes.map(node => node.id), ['image-1', 'text-1']);
    assert.deepEqual(fixture.workflow.nodes, []);
    const restored = restoreProjectTrashEntry(
        fixture.workflow,
        fixture.projectRoot,
        result.entry.id
    );
    assert.deepEqual(restored.map(node => node.id), ['image-1', 'text-1']);
});

test('永久删除和七天到期清理移除回收站副本及无引用的项目原文件', (t) => {
    const first = createFixture(t);
    const firstResult = trashWorkflowNodes(
        first.workflow,
        [first.node],
        [first.node.id],
        first.projectRoot,
        1000
    );
    const firstPreview = getProjectTrashPreviewPath(first.projectRoot, firstResult.entry.id);
    permanentlyDeleteProjectTrashEntry(first.workflow, first.projectRoot, firstResult.entry.id);
    assert.equal(fs.existsSync(firstPreview), false);
    assert.equal(listProjectTrash(first.workflow, first.projectRoot, 1000).length, 0);

    const second = createFixture(t);
    trashWorkflowNodes(
        second.workflow,
        [second.node],
        [second.node.id],
        second.projectRoot,
        2000
    );
    assert.equal(
        purgeExpiredProjectTrash(second.projectRoot, 2000 + PROJECT_TRASH_RETENTION_MS - 1),
        0
    );
    assert.equal(
        purgeExpiredProjectTrash(second.projectRoot, 2000 + PROJECT_TRASH_RETENTION_MS, second.workflow),
        1
    );
    assert.equal(listProjectTrash(second.workflow, second.projectRoot, Date.now()).length, 0);
});

test('永久删除时清理后来已无引用的项目原文件，但保留仍被画布使用的共享素材', (t) => {
    const removed = createFixture(t);
    const removedSharedNode = { ...removed.node, id: 'image-2' };
    removed.workflow.nodes = [removed.node, removedSharedNode];
    const removedResult = trashWorkflowNodes(
        removed.workflow,
        [removed.node, removedSharedNode],
        [removed.node.id],
        removed.projectRoot
    );
    assert.equal(fs.existsSync(removed.imagePath), true);
    removed.workflow.nodes = [];
    permanentlyDeleteProjectTrashEntry(removed.workflow, removed.projectRoot, removedResult.entry.id);
    assert.equal(fs.existsSync(removed.imagePath), false);
    assert.equal(fs.existsSync(removed.sidecarPath), false);
    assert.equal(fs.existsSync(removed.nodeMetadataPath), false);

    const retained = createFixture(t);
    const retainedSharedNode = { ...retained.node, id: 'image-2' };
    retained.workflow.nodes = [retained.node, retainedSharedNode];
    const retainedResult = trashWorkflowNodes(
        retained.workflow,
        [retained.node, retainedSharedNode],
        [retained.node.id],
        retained.projectRoot
    );
    permanentlyDeleteProjectTrashEntry(retained.workflow, retained.projectRoot, retainedResult.entry.id);
    assert.equal(fs.existsSync(retained.imagePath), true);
    assert.equal(fs.existsSync(retained.nodeMetadataPath), true);
});

test('全部永久删除也同步清理已无引用的项目原文件', (t) => {
    const fixture = createFixture(t);
    const sharedNode = { ...fixture.node, id: 'image-2' };
    fixture.workflow.nodes = [fixture.node, sharedNode];
    trashWorkflowNodes(
        fixture.workflow,
        [fixture.node, sharedNode],
        [fixture.node.id],
        fixture.projectRoot
    );
    fixture.workflow.nodes = [];

    assert.deepEqual(purgeAllProjectTrash(fixture.workflow, fixture.projectRoot), { deleted: 1 });
    assert.equal(fs.existsSync(fixture.imagePath), false);
    assert.equal(fs.existsSync(fixture.nodeMetadataPath), false);
    assert.deepEqual(listProjectTrash(fixture.workflow, fixture.projectRoot), []);
});

test('回收站预览接口可以读取隐藏 .trash 目录中的真实图片', async t => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-trash-preview-api-'));
    t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

    const libraryDir = path.join(dataDir, 'library');
    const workflowId = 'workflow-trash-preview';
    const projectDirName = 'TrashPreviewProject';
    const projectRoot = path.join(libraryDir, 'projects', projectDirName);
    const workflowsDir = path.join(libraryDir, 'workflows');
    fs.mkdirSync(path.join(projectRoot, 'images'), { recursive: true });
    fs.mkdirSync(workflowsDir, { recursive: true });

    // Valid 1x1 PNG so the response is verified as an actual browser image,
    // not only as arbitrary bytes returned with a successful status.
    const imageBytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
    );
    const node = {
        id: 'preview-image',
        type: 'Image',
        title: '回收站预览',
        x: 0,
        y: 0,
        resultUrl: `/library/projects/${projectDirName}/images/preview.png`
    };
    const workflow = {
        id: workflowId,
        title: '回收站预览测试',
        projectDirName,
        nodes: [node],
        groups: [],
        viewport: { x: 0, y: 0, zoom: 1 }
    };
    fs.writeFileSync(path.join(projectRoot, 'images', 'preview.png'), imageBytes);
    fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(workflow));
    fs.writeFileSync(path.join(workflowsDir, `${workflowId}.json`), JSON.stringify(workflow));

    const child = spawn(process.execPath, [
        '--input-type=module',
        '--eval',
        "import('./server/index.js').then(({ startBackend }) => startBackend({ port: 0 }))"
    ], {
        cwd: path.resolve(import.meta.dirname, '..'),
        env: {
            ...process.env,
            NODE_ENV: 'test',
            EVAN_DESKTOP: '1',
            EVAN_DATA_DIR: dataDir
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    t.after(() => {
        if (!child.killed) child.kill('SIGTERM');
    });

    const origin = await new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => reject(new Error(`backend startup timed out:\n${output}`)), 10_000);
        const inspect = chunk => {
            output += chunk.toString();
            const match = output.match(/Backend server running on (http:\/\/127\.0\.0\.1:\d+)/);
            if (!match) return;
            clearTimeout(timeout);
            resolve(match[1]);
        };
        child.stdout.on('data', inspect);
        child.stderr.on('data', inspect);
        child.once('exit', code => {
            clearTimeout(timeout);
            reject(new Error(`backend exited before ready (${code}):\n${output}`));
        });
    });

    const trashedResponse = await fetch(`${origin}/api/projects/${workflowId}/trash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: [node], nodeIds: [node.id] })
    });
    assert.equal(trashedResponse.status, 201, await trashedResponse.text());

    const entriesResponse = await fetch(`${origin}/api/projects/${workflowId}/trash`);
    assert.equal(entriesResponse.status, 200);
    const [entry] = await entriesResponse.json();
    assert.ok(entry?.previewUrl);

    const previewResponse = await fetch(`${origin}${entry.previewUrl}`);
    assert.equal(previewResponse.status, 200);
    assert.equal(previewResponse.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await previewResponse.arrayBuffer()), imageBytes);
});
