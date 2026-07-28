import assert from 'node:assert/strict';
import test from 'node:test';
import { upsertProductSceneResultNode } from '../src/utils/productSceneResult.js';

const sourceNode = { id: 'source-1', x: 100, y: 200, productCategory: '产品' };

function completedJob(overrides = {}) {
    return {
        id: 'job-1',
        resultUrls: ['/library/projects/p/images/a.png'],
        resultNodeIds: ['image-node-1'],
        resultUrl: '/library/projects/p/images/a.png',
        resultNodeId: 'image-node-1',
        imageModel: 'jimeng-image-5-0-lite',
        aspectRatio: '9:16',
        videoTasks: [{
            index: 0,
            imageNodeId: 'image-node-1',
            videoNodeId: 'video-node-1',
            status: 'success',
            resultUrl: '/library/projects/p/videos/a.mp4'
        }],
        ...overrides
    };
}

test('完成的任务会把图片与视频结果节点补进画布', () => {
    const next = upsertProductSceneResultNode([], sourceNode, completedJob());
    assert.deepEqual(next.map(node => node.id), ['image-node-1', 'video-node-1']);
});

test('用户删掉的结果节点不再被恢复回来', () => {
    // 这正是「删了图片节点但它又长回来」的那个 bug：任务本身是完成状态，
    // 恢复逻辑只看结果在不在画布上，分不清「还没恢复」和「已经删了」。
    const job = completedJob({ dismissedResultNodeIds: ['image-node-1'] });
    const next = upsertProductSceneResultNode([], sourceNode, job);
    assert.deepEqual(next.map(node => node.id), ['video-node-1']);
});

test('图片和视频节点都能被标记为已删除', () => {
    const job = completedJob({ dismissedResultNodeIds: ['image-node-1', 'video-node-1'] });
    assert.deepEqual(upsertProductSceneResultNode([], sourceNode, job), []);
});

test('再点一次生成是新增一版子节点，不覆盖上一版', () => {
    const first = upsertProductSceneResultNode([], sourceNode, completedJob({ version: 1 }));
    const rerun = completedJob({
        id: 'job-2',
        version: 2,
        resultUrls: ['/library/projects/p/images/b.png'],
        resultUrl: '/library/projects/p/images/b.png',
        resultNodeIds: ['image-node-2'],
        resultNodeId: 'image-node-2',
        videoTasks: [{
            index: 0,
            imageNodeId: 'image-node-2',
            videoNodeId: 'video-node-2',
            status: 'success',
            resultUrl: '/library/projects/p/videos/b.mp4'
        }]
    });
    const second = upsertProductSceneResultNode(first, sourceNode, rerun);

    assert.deepEqual(
        second.map(node => node.id),
        ['image-node-1', 'video-node-1', 'image-node-2', 'video-node-2'],
        '上一版必须原样留着'
    );
    assert.match(second.find(node => node.id === 'image-node-1').resultUrl, /a\.png/, '上一版内容不被改写');
});

test('新一版往下让开，不会压在上一版身上', () => {
    const v1 = upsertProductSceneResultNode([], sourceNode, completedJob({ version: 1 }));
    const v2 = upsertProductSceneResultNode([], sourceNode, completedJob({
        version: 2, resultNodeIds: ['image-node-2'], resultNodeId: 'image-node-2'
    }));
    const firstY = v1.find(node => node.id === 'image-node-1').y;
    const secondY = v2.find(node => node.id === 'image-node-2').y;
    assert.ok(secondY > firstY, `第二版应排在下面：${secondY} 应大于 ${firstY}`);
});

test('版本号出现在标题里，方便区分是第几次生成', () => {
    const v1 = upsertProductSceneResultNode([], sourceNode, completedJob({ version: 1 }));
    assert.equal(v1[0].title.includes('v'), false, '第一版不加后缀');
    const v2 = upsertProductSceneResultNode([], sourceNode, completedJob({
        version: 2, resultNodeIds: ['image-node-2'], resultNodeId: 'image-node-2'
    }));
    assert.match(v2[0].title, /v2$/);
});
