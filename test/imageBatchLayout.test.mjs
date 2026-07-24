import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAdditionalImagePlacements,
  IMAGE_BATCH_HORIZONTAL_STEP
} from '../src/utils/imageBatchLayout.js';

test('即梦多图结果从当前节点右侧水平排列且不创建连接线', () => {
  const placements = createAdditionalImagePlacements(
    { x: 100, y: 240 },
    ['/first.png', '/second.png', '/third.png', '/fourth.png']
  );

  assert.equal(IMAGE_BATCH_HORIZONTAL_STEP, 420);
  assert.deepEqual(placements, [
    { resultUrl: '/second.png', x: 520, y: 240, parentIds: [] },
    { resultUrl: '/third.png', x: 940, y: 240, parentIds: [] },
    { resultUrl: '/fourth.png', x: 1360, y: 240, parentIds: [] }
  ]);
});

test('只有第一张结果时不创建额外节点', () => {
  assert.deepEqual(
    createAdditionalImagePlacements({ x: 0, y: 0 }, ['/first.png']),
    []
  );
});
