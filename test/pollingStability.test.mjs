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
 * 依赖这个字符串；节点快照从 ref 里取。useGenerationRecovery 一直是这么写的，
 * useAutoSubtitleRecovery 曾经不是，本测试防止它和后来者再退回去。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = name => fs.readFileSync(new URL(`../src/hooks/${name}`, import.meta.url), 'utf8');

const SUBTITLE = read('useAutoSubtitleRecovery.ts');
const RECOVERY = read('useGenerationRecovery.ts');

/** 抓出源码里所有 `}, [...]);` 形式的 effect 依赖数组。 */
const dependencyArrays = source =>
    [...source.matchAll(/\}, \[([^\]]*)\]\);/g)].map(match => match[1].trim());

/** 依赖数组里是否直接依赖了整个 nodes 数组（`nodes.length` 之类不算）。 */
const dependsOnNodesArray = deps => deps
    .split(',')
    .map(entry => entry.trim())
    .includes('nodes');

test('自动字幕轮询不依赖 nodes 数组', () => {
    const offenders = dependencyArrays(SUBTITLE).filter(dependsOnNodesArray);
    assert.deepEqual(
        offenders,
        [],
        `useAutoSubtitleRecovery 的 effect 依赖了 nodes，拖拽时会把 1.2s 轮询打成每帧一次：[${offenders.join('] [')}]`
    );
});

test('自动字幕轮询依赖的是「待轮询任务」的稳定字符串', () => {
    // 这个 key 必须只由 节点 id + 任务 id 组成：坐标、尺寸等变化不得触发重建。
    assert.match(SUBTITLE, /\$\{node\.id\}:\$\{node\.subtitleJobId\}/);
    assert.match(SUBTITLE, /\}, \[pendingJobs\]\);/);
});

test('自动字幕轮询通过 ref 读取回调，调用方是否记忆化不影响轮询节奏', () => {
    // 回调进依赖数组等于把「调用方有没有包 useCallback」变成轮询频率的隐性前提，
    // 是同一个 bug 的另一种触发路径。
    assert.match(SUBTITLE, /callbacksRef/);
    const offenders = dependencyArrays(SUBTITLE)
        .filter(deps => /\b(updateNode|onCompleted|onFailed)\b/.test(deps));
    assert.deepEqual(offenders, [], `回调不应进入 effect 依赖数组：[${offenders.join('] [')}]`);
});

test('生成状态轮询同样不依赖 nodes 数组（既有约定，防止回退）', () => {
    const offenders = dependencyArrays(RECOVERY).filter(dependsOnNodesArray);
    assert.deepEqual(offenders, [], `useGenerationRecovery 的 effect 依赖了 nodes：[${offenders.join('] [')}]`);
});
