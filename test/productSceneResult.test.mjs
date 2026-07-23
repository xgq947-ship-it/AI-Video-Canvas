import assert from 'node:assert/strict';
import test from 'node:test';
import { upsertProductSceneResultNode } from '../src/utils/productSceneResult.js';

test('产品场景任务成功后在控制节点右侧创建并连接普通图片节点', () => {
  const source = { id: 'control', type: 'Product Scene Replace', x: 100, y: 200, productCategory: '揉腹仪', resolution: 'Auto' };
  const job = {
    id: 'job-1', resultNodeId: 'image-result', resultUrl: '/library/result.png', prompt: '最终提示词',
    imageModel: 'google-flow-nano-banana-pro', aspectRatio: '3:4'
  };
  const nodes = upsertProductSceneResultNode([source], source, job, 1234);
  const result = nodes[1];
  assert.equal(result.type, 'Image');
  assert.equal(result.status, 'success');
  assert.equal(result.title, '揉腹仪场景图');
  assert.deepEqual(result.parentIds, ['control']);
  assert.equal(result.x, 660);
  assert.equal(result.resultUrl, '/library/result.png?t=1234');
});

test('恢复轮询重复收到完成状态时不会重复创建结果节点', () => {
  const source = { id: 'control', type: 'Product Scene Replace', x: 0, y: 0 };
  const job = { id: 'job-1', resultNodeId: 'image-result', resultUrl: '/result.png', imageModel: 'flow', aspectRatio: '1:1' };
  const once = upsertProductSceneResultNode([source], source, job, 1);
  const twice = upsertProductSceneResultNode(once, source, job, 2);
  assert.equal(twice.filter(node => node.id === 'image-result').length, 1);
  assert.equal(twice.find(node => node.id === 'image-result').resultUrl, '/result.png?t=2');
});
