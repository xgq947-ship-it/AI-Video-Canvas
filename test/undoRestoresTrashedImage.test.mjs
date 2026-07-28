import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * 撤销删除后，图片必须跟着回来。
 *
 * 删除项目图片节点会把图片文件移进 .trash，而撤销（Ctrl+Z）只还原画布状态、不碰磁盘，
 * 于是节点方框回来了、图片却 404 —— 界面上是一个「Failed to load」的空框。
 *
 * 这条链路要真跑得开一整个画布，所以这里按本仓库既有做法（canvasEditLock.test.mjs）
 * 锁住源码里的关键接线，防止以后被顺手删掉。
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');

test('删除时记下回收站条目 id', () => {
    assert.match(APP, /pendingTrashRef/, '必须记住「哪些节点的图片进了哪个回收站条目」');
    assert.match(APP, /result\?\.entry\?\.id/, '条目 id 来自移入回收站接口的返回');
});

test('节点重新出现在画布上时，调用回收站还原接口', () => {
    assert.match(APP, /\/trash\/\$\{encodeURIComponent\(record\.entryId\)\}\/restore/);
    // 挂在 nodes 上而不是 undo 上：撤销是异步生效的，而且「节点又出现了」这个条件
    // 对撤销、重做以及其它任何让它回来的路径都成立。
    assert.match(APP, /const presentIds = new Set\(nodes\.map\(node => node\.id\)\)/);
});

test('还原后换掉 resultUrl 上的时间戳，强制重新请求图片', () => {
    // <img> 已经记住了那次 404，不换 URL 就不会重新请求，界面仍是空框。
    assert.match(APP, /resultUrl\.split\('\?'\)\[0\]\}\?t=\$\{Date\.now\(\)\}/);
});

test('还原失败时告诉用户去回收站手动恢复，而不是静默吞掉', () => {
    assert.match(APP, /图片没能从回收站取回/);
});
