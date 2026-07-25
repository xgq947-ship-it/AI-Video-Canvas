import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAdditionalImagePlacements,
  getImageBatchVerticalStep,
  IMAGE_BATCH_HORIZONTAL_STEP,
  IMAGE_BATCH_VERTICAL_GAP,
  IMAGE_NODE_WIDTH
} from '../src/utils/imageBatchLayout.js';

test('纯文生多图结果从当前节点右侧水平排列且不创建连接线', () => {
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

test('带参考图的多图结果纵向排列并全部连接参考图', () => {
  const sourceNode = {
    x: 520,
    y: 240,
    resultAspectRatio: '16/9',
    aspectRatio: '1:1'
  };
  const verticalStep = getImageBatchVerticalStep(sourceNode);
  const placements = createAdditionalImagePlacements(
    sourceNode,
    ['/first.png', '/second.png', '/third.png', '/fourth.png'],
    {
      layout: 'vertical',
      parentIds: ['reference-1', 'reference-2', 'reference-1']
    }
  );

  assert.equal(IMAGE_NODE_WIDTH, 365);
  assert.equal(IMAGE_BATCH_VERTICAL_GAP, 32);
  assert.equal(verticalStep, 365 / (16 / 9) + 32);
  assert.deepEqual(placements, [
    {
      resultUrl: '/second.png',
      x: 520,
      y: 240 + verticalStep,
      parentIds: ['reference-1', 'reference-2']
    },
    {
      resultUrl: '/third.png',
      x: 520,
      y: 240 + verticalStep * 2,
      parentIds: ['reference-1', 'reference-2']
    },
    {
      resultUrl: '/fourth.png',
      x: 520,
      y: 240 + verticalStep * 3,
      parentIds: ['reference-1', 'reference-2']
    }
  ]);
});

test('纵向间距在没有实际成图比例时使用用户选择的比例', () => {
  assert.equal(
    getImageBatchVerticalStep({ aspectRatio: '9:16' }),
    365 / (9 / 16) + 32
  );
});

test('只有第一张结果时不创建额外节点', () => {
  assert.deepEqual(
    createAdditionalImagePlacements({ x: 0, y: 0 }, ['/first.png']),
    []
  );
});
