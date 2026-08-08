/**
 * 轮询定时器的稳定性回归测试。
 *
 * 这是一个「项目级」约束，不是某个 hook 的补丁：**任何按固定间隔轮询后端的
 * effect，都不能把 `nodes` 数组放进依赖数组。**
 *
 * 原因：这些 effect 的写法都是「建定时器 + 立刻同步跑一次」。而 `nodes` 在拖拽
 * 期间每一帧都是新数组引用，一旦进了依赖数组，拖动任意节点就会不停销毁/重建
 * 定时器，每次重建都多发一轮请求 —— 1.2 秒一次的轮询会变成每秒几十次，同时
 * 把 CanvasNode 那套 memo 优化整个抵消掉。
 *
 * 正确写法是先把「该轮询谁」压成一个稳定字符串（节点 id + 任务 id），effect 只
 * 依赖这个字符串；节点快照从 ref 里取。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = name => fs.readFileSync(new URL(`../src/hooks/${name}`, import.meta.url), 'utf8');

const RECOVERY = read('useGenerationRecovery.ts');

/** 抓出源码里所有 `}, [...]);` 形式的 effect 依赖数组。 */
const dependencyArrays = source =>
    [...source.matchAll(/\}, \[([^\]]*)\]\);/g)].map(match => match[1].trim());

/** 依赖数组里是否直接依赖了整个 nodes 数组（`nodes.length` 之类不算）。 */
const dependsOnNodesArray = deps => deps
    .split(',')
    .map(entry => entry.trim())
    .includes('nodes');

test('生成状态轮询同样不依赖 nodes 数组（既有约定，防止回退）', () => {
    const offenders = dependencyArrays(RECOVERY).filter(dependsOnNodesArray);
    assert.deepEqual(offenders, [], `useGenerationRecovery 的 effect 依赖了 nodes：[${offenders.join('] [')}]`);
});
