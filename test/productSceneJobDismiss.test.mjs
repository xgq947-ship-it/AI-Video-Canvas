import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dismissProductSceneResultNodes, resolveJobVersion, resolveResultNodeIds } from '../server/services/productSceneJobs.js';

const WORKFLOW_ID = 'workflow-1';

function fixture(job) {
    // 复刻真实布局：任务文件落在项目目录下的 .jobs/product-scene，
    // 而项目目录要由 workflows/<id>.json 的 projectDirName 解析出来。
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twitcanva-scene-jobs-'));
    const libraryDir = path.join(root, 'library');
    const projectsDir = path.join(libraryDir, 'projects');
    const workflowsDir = path.join(libraryDir, 'workflows');
    fs.mkdirSync(path.join(projectsDir, 'demo', 'images'), { recursive: true });
    fs.mkdirSync(workflowsDir, { recursive: true });
    fs.writeFileSync(
        path.join(workflowsDir, `${WORKFLOW_ID}.json`),
        JSON.stringify({ id: WORKFLOW_ID, title: 'demo', projectDirName: 'demo', nodes: [] })
    );
    const jobsDir = path.join(projectsDir, 'demo', '.jobs', 'product-scene');
    fs.mkdirSync(jobsDir, { recursive: true });
    fs.writeFileSync(path.join(jobsDir, `${job.id}.json`), JSON.stringify(job));
    return { root, dirs: { libraryDir, projectsDir, workflowsDir }, jobsDir };
}

function baseJob() {
    return {
        id: 'job-1',
        workflowId: WORKFLOW_ID,
        nodeId: 'source-1',
        status: 'completed',
        resultNodeIds: ['image-node-1'],
        videoResultNodeIds: ['video-node-1'],
        videoTasks: [{ index: 0, imageNodeId: 'image-node-1', videoNodeId: 'video-node-1', status: 'success' }],
        createdAt: new Date().toISOString()
    };
}

function readJob(jobsDir, id) {
    return JSON.parse(fs.readFileSync(path.join(jobsDir, `${id}.json`), 'utf8'));
}

test('删除图片结果节点会记进任务文件', t => {
    const { root, dirs, jobsDir } = fixture(baseJob());
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const result = dismissProductSceneResultNodes(['image-node-1'], WORKFLOW_ID, { dirs });
    assert.deepEqual(result.dismissed, ['image-node-1']);
    assert.deepEqual(readJob(jobsDir, 'job-1').dismissedResultNodeIds, ['image-node-1']);
});

test('视频结果节点同样能被记下来', t => {
    const { root, dirs, jobsDir } = fixture(baseJob());
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    // 视频节点走不到回收站那条分支，所以这条路径必须独立成立。
    dismissProductSceneResultNodes(['video-node-1'], WORKFLOW_ID, { dirs });
    assert.deepEqual(readJob(jobsDir, 'job-1').dismissedResultNodeIds, ['video-node-1']);
});

test('重复标记不会写入重复项，也不认领别的节点', t => {
    const { root, dirs, jobsDir } = fixture(baseJob());
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    dismissProductSceneResultNodes(['image-node-1'], WORKFLOW_ID, { dirs });
    const result = dismissProductSceneResultNodes(['image-node-1', '不属于这个任务的节点'], WORKFLOW_ID, { dirs });
    assert.deepEqual(result.dismissed, []);
    assert.deepEqual(readJob(jobsDir, 'job-1').dismissedResultNodeIds, ['image-node-1']);
});

test('空输入直接返回，不改动任何任务文件', t => {
    const { root, dirs, jobsDir } = fixture(baseJob());
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    assert.deepEqual(dismissProductSceneResultNodes([], WORKFLOW_ID, { dirs }).dismissed, []);
    assert.equal(readJob(jobsDir, 'job-1').dismissedResultNodeIds, undefined);
});

test('每一轮都用全新的结果节点 id：新增一版，不覆盖上一版', () => {
    let counter = 0;
    const ids = resolveResultNodeIds({ imageCount: 2, newId: () => `fresh-${counter += 1}` });
    assert.deepEqual(ids, ['fresh-1', 'fresh-2']);
});

test('版本号按这个节点已有的任务数递增', () => {
    assert.equal(resolveJobVersion([]), 1);
    assert.equal(resolveJobVersion(undefined), 1);
    assert.equal(resolveJobVersion([{ id: 'a' }, { id: 'b' }]), 3);
});
