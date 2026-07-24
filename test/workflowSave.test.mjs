import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeServerNormalizedNodes } from '../src/utils/workflowSave.js';

test('旧保存响应不会覆盖生成完成状态或删除期间新增的多图节点', () => {
  const submitted = [{
    id: 'source',
    status: 'loading',
    generationStartTime: 100,
    resultUrl: '/library/old.webp',
  }];
  const normalized = [{
    ...submitted[0],
    resultUrl: '/library/projects/demo/images/old.webp',
  }];
  const current = [{
    id: 'source',
    status: 'success',
    resultUrl: '/library/new-1.webp',
    generationStartTime: undefined,
  }, {
    id: 'batch-2',
    status: 'success',
    resultUrl: '/library/new-2.webp',
  }];

  assert.deepEqual(mergeServerNormalizedNodes(current, submitted, normalized), current);
});

test('服务器规范化媒体地址仍会安全写回未被并发修改的节点', () => {
  const submitted = [{
    id: 'source',
    status: 'success',
    resultUrl: 'data:image/webp;base64,AAAA',
  }];
  const normalized = [{
    ...submitted[0],
    resultUrl: '/library/projects/demo/images/saved.webp',
  }];

  assert.deepEqual(mergeServerNormalizedNodes(submitted, submitted, normalized), [{
    id: 'source',
    status: 'success',
    resultUrl: '/library/projects/demo/images/saved.webp',
  }]);
});
