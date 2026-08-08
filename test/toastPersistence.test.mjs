/**
 * Toast 常驻与重试入口的回归测试。
 *
 * 约束一：后台任务（生成 / 导入 / 分析 / 拼接）失败的提示必须常驻，
 * 由用户手动关闭。这类失败常常发生在用户切走做别的事情的时候，几秒后自动消失
 * 的提示等于没提示。即时校验（"请先打开项目"）不在此列，仍走默认时长。
 *
 * 约束二：toast 上的重试按钮不得绕过「已扣费」保护。平台受理过的请求
 * （errorSubmitted）结果可能就在平台历史里，直接重试会再扣一次费——节点内的
 * 错误 UI 正是这样处理的，toast 必须保持一致。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const at = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const TOASTS = at('../src/hooks/useToasts.ts');
const STACK = at('../src/components/ToastStack.tsx');
const APP = at('../src/App.tsx');
const GENERATION = at('../src/hooks/useGeneration.ts');

test('duration 为 0 时不排自动关闭定时器', () => {
    assert.match(TOASTS, /export const TOAST_PERSIST = 0;/);
    assert.match(TOASTS, /if \(duration > 0\) \{/);
});

test('后台任务失败的提示全部常驻，没有残留的固定时长', () => {
    // 6500ms 是改造前后台失败提示的写法，不应再有残留。
    assert.doesNotMatch(
        APP,
        /duration: 6500/,
        'App.tsx 仍有 duration: 6500 的后台失败提示，应改为 TOAST_PERSIST'
    );
    const persistent = [...APP.matchAll(/duration: TOAST_PERSIST/g)];
    assert.ok(
        persistent.length >= 9,
        `常驻错误提示只剩 ${persistent.length} 处，改造覆盖的 9 处后台失败路径可能被回退`
    );
});

test('即时校验类提示仍然自动消失', () => {
    // 抽查两条纯输入校验：它们不该被一并改成常驻，否则用户忙着关提示。
    assert.match(APP, /showToast\('请先打开项目', \{ tone: 'error' \}\)/);
    assert.match(APP, /showToast\('请先新建或打开项目', \{ tone: 'error' \}\)/);
});

test('ToastStack 渲染可选的操作按钮，并在执行前先关闭自身', () => {
    assert.match(STACK, /toast\.action && \(/);
    const actionBlock = STACK.slice(STACK.indexOf('toast.action && ('), STACK.indexOf('aria-label="关闭提示"'));
    const dismissAt = actionBlock.indexOf('onDismiss(toast.id)');
    const invokeAt = actionBlock.indexOf('toast.action!.onClick()');
    assert.ok(dismissAt !== -1 && invokeAt !== -1, '操作按钮必须同时关闭提示并执行回调');
    assert.ok(dismissAt < invokeAt, '必须先关闭旧提示再执行回调，否则重试后新旧提示会叠在一起');
});

test('已扣费的失败不提供 toast 重试按钮', () => {
    // errorSubmitted 为真时必须传 undefined（无 action），与 NodeContent 藏掉
    // 重试按钮的处理保持一致。
    assert.match(
        GENERATION,
        /errorSubmitted \? undefined : \{ action: \{ label: '重试'/,
        '重试按钮必须以 errorSubmitted 为闸门，避免重复扣费'
    );
});
