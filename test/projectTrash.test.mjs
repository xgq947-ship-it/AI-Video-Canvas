import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    getProjectTrashPreviewPath,
    listProjectTrash,
    permanentlyDeleteProjectTrashEntry,
    PROJECT_TRASH_RETENTION_MS,
    purgeExpiredProjectTrash,
    restoreProjectTrashEntry,
    trashWorkflowNodes
} from '../server/services/projectTrash.js';

const createFixture = (t) => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-project-trash-'));
    t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
    fs.mkdirSync(path.join(projectRoot, 'images'), { recursive: true });
    const filename = 'generated.png';
    const imagePath = path.join(projectRoot, 'images', filename);
    const sidecarPath = path.join(projectRoot, 'images', 'generated.json');
    fs.writeFileSync(imagePath, Buffer.from('image-bytes'));
    fs.writeFileSync(sidecarPath, JSON.stringify({ filename }));
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
    return { projectRoot, imagePath, sidecarPath, resultUrl, node, workflow };
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
    assert.ok(getProjectTrashPreviewPath(fixture.projectRoot, result.entry.id));
    assert.equal(listProjectTrash(fixture.workflow, fixture.projectRoot, now).length, 1);

    const restored = restoreProjectTrashEntry(fixture.workflow, fixture.projectRoot, result.entry.id);
    assert.deepEqual(restored.map(node => node.id), ['image-1']);
    assert.equal(fs.readFileSync(fixture.imagePath, 'utf8'), 'image-bytes');
    assert.deepEqual(JSON.parse(fs.readFileSync(fixture.sidecarPath, 'utf8')), {
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

test('永久删除和七天到期清理只移除回收站副本', (t) => {
    const first = createFixture(t);
    const firstResult = trashWorkflowNodes(
        first.workflow,
        [first.node],
        [first.node.id],
        first.projectRoot,
        1000
    );
    const firstPreview = getProjectTrashPreviewPath(first.projectRoot, firstResult.entry.id);
    permanentlyDeleteProjectTrashEntry(first.projectRoot, firstResult.entry.id);
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
        purgeExpiredProjectTrash(second.projectRoot, 2000 + PROJECT_TRASH_RETENTION_MS),
        1
    );
    assert.equal(listProjectTrash(second.workflow, second.projectRoot, Date.now()).length, 0);
});
