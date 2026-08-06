/**
 * 生成任务取消的回归测试。
 *
 * 最关键的一条不是「能不能取消」，而是 **取消之后有没有如实说清是否可能已计费**。
 * 取消只能中止我们这一侧的等待；一旦请求越过提交边界被平台受理，结果可能已经躺在
 * 平台历史里、费用照扣。把这种情况一律显示成「已取消」，用户就会去重新生成，
 * 于是重复扣一次费——这正是 NodeContent 里「已扣费就藏掉重试按钮」要防的事。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
    activeGenerationCount,
    cancelGeneration,
    isGenerationActive,
    registerGeneration,
    resetGenerationRegistry
} from '../server/services/generationCancellation.js';

test.beforeEach(() => resetGenerationRegistry());

test('登记后可查询到，取消会中止 signal', () => {
    const handle = registerGeneration({ workflowId: 'w1', nodeId: 'n1', label: '视频生成' });
    assert.ok(handle, '应当返回句柄');
    assert.equal(isGenerationActive('w1', 'n1'), true);
    assert.equal(handle.signal.aborted, false);

    const result = cancelGeneration('w1', 'n1');
    assert.deepEqual(result, { cancelled: true, submitted: false });
    assert.equal(handle.signal.aborted, true, '取消必须真的 abort 掉 signal');
    assert.equal(isGenerationActive('w1', 'n1'), false);
});

test('没有在跑的任务时取消返回 not_found，而不是假装成功', () => {
    const result = cancelGeneration('w1', 'nope');
    assert.equal(result.cancelled, false);
    assert.equal(result.reason, 'not_found');
});

test('已越过提交边界的取消必须回报 submitted=true', () => {
    registerGeneration({ workflowId: 'w1', nodeId: 'n1', submitted: () => true });
    const result = cancelGeneration('w1', 'n1');
    assert.equal(result.cancelled, true);
    assert.equal(result.submitted, true, '已受理的请求必须如实上报，否则用户会重复扣费');
});

test('查询提交状态本身抛错时按「可能已提交」处理', () => {
    registerGeneration({
        workflowId: 'w1',
        nodeId: 'n1',
        submitted: () => { throw new Error('调度器状态不可用'); }
    });
    const result = cancelGeneration('w1', 'n1');
    assert.equal(result.submitted, true, '状态未知时必须偏向保守，不能说一定没扣费');
});

test('不同项目的同名 nodeId 互不干扰', () => {
    const a = registerGeneration({ workflowId: 'projA', nodeId: 'same' });
    const b = registerGeneration({ workflowId: 'projB', nodeId: 'same' });
    cancelGeneration('projA', 'same');
    assert.equal(a.signal.aborted, true);
    assert.equal(b.signal.aborted, false, '取消 A 项目不应波及 B 项目的同名节点');
});

test('同一节点重复发起时，旧的那次会被取消且不残留登记', () => {
    const first = registerGeneration({ workflowId: 'w1', nodeId: 'n1' });
    const second = registerGeneration({ workflowId: 'w1', nodeId: 'n1' });
    assert.equal(first.signal.aborted, true, '旧任务应被中止');
    assert.equal(second.signal.aborted, false);
    assert.equal(activeGenerationCount(), 1, '登记表里不应残留旧条目');
});

test('release 只清自己那条，不会误删后来者', () => {
    const first = registerGeneration({ workflowId: 'w1', nodeId: 'n1' });
    registerGeneration({ workflowId: 'w1', nodeId: 'n1' });
    first.release();
    assert.equal(isGenerationActive('w1', 'n1'), true, 'release 旧句柄不应把新任务一起清掉');
});

test('缺少 nodeId 时不登记（没有 nodeId 就无从取消）', () => {
    assert.equal(registerGeneration({ workflowId: 'w1', nodeId: '' }), null);
    assert.equal(activeGenerationCount(), 0);
});

// ---------------------------------------------------------------------------
// 接线：端点与前端必须真的用上这套东西
// ---------------------------------------------------------------------------

const ROUTES = fs.readFileSync(new URL('../server/routes/generation.js', import.meta.url), 'utf8');
const SERVICE = fs.readFileSync(new URL('../src/services/generationService.ts', import.meta.url), 'utf8');
const HOOK = fs.readFileSync(new URL('../src/hooks/useGeneration.ts', import.meta.url), 'utf8');
const CONTENT = fs.readFileSync(new URL('../src/components/canvas/NodeContent.tsx', import.meta.url), 'utf8');

test('两条生成路由都登记了取消句柄并在 finally 里释放', () => {
    assert.equal((ROUTES.match(/cancellation = registerGeneration\(/g) || []).length, 2);
    assert.equal((ROUTES.match(/cancellation\?\.release\(\)/g) || []).length, 2, '必须在 finally 释放，否则登记表会泄漏');
});

test('生成路由按调度器 provider 名称查询提交边界', () => {
    assert.match(ROUTES, /generationHasCrossedSubmissionBoundary\(\s*webProviderForModel\(imageModel\)/s);
    assert.match(ROUTES, /generationHasCrossedSubmissionBoundary\(\s*webProviderForModel\(videoModel\)/s);
});

test('signal 透传到了各 provider workflow', () => {
    const passed = (ROUTES.match(/signal: cancellation\?\.signal/g) || []).length;
    assert.ok(passed >= 4, `只有 ${passed} 处透传了 signal，浏览器 workflow 路径可能有遗漏`);
});

test('取消端点存在，并把 submitted 原样返回给前端', () => {
    assert.match(ROUTES, /router\.post\('\/generations\/:nodeId\/cancel'/);
    assert.match(ROUTES, /submitted: result\.submitted/);
    assert.match(ROUTES, /可能已被平台受理并计费/, '已受理的取消必须给出明确的计费提示');
});

test('前端把 signal 交给 fetch，且不会混进请求体', () => {
    assert.match(SERVICE, /body: JSON\.stringify\(withoutSignal\(params\)\)/);
    assert.equal((SERVICE.match(/signal: params\.signal/g) || []).length, 2);
});

test('取消先问服务端再中止本地请求', () => {
    const block = HOOK.slice(HOOK.indexOf('const cancelNodeGeneration'), HOOK.indexOf('// RETURN'));
    const askAt = block.indexOf('requestCancelGeneration(id, workflowId)');
    const abortAt = block.indexOf('?.abort()');
    assert.ok(askAt !== -1 && abortAt !== -1);
    assert.ok(askAt < abortAt, '先 abort 就再也拿不到「是否已计费」的结论了');
});

test('用户取消不会被当成生成失败标红', () => {
    assert.match(HOOK, /error\?\.name === 'AbortError' \|\| abortController\.signal\.aborted/);
    const block = HOOK.slice(HOOK.indexOf("error?.name === 'AbortError'"), HOOK.indexOf('// Handle errors'));
    assert.match(block, /errorMessage: undefined/, '取消不应留下错误信息');
    assert.doesNotMatch(block, /NodeStatus\.ERROR/, '取消不是失败，不该进 ERROR 状态');
});

test('LOADING 节点上有取消入口，且点击后立刻置灰', () => {
    assert.match(CONTENT, /const CancelGenerationButton/);
    assert.equal((CONTENT.match(/<CancelGenerationButton/g) || []).length, 2, '重新生成覆盖层与占位态都要有');
    assert.match(CONTENT, /disabled=\{cancelling\}/, '取消有一次网络往返，不置灰用户会连点');
});
