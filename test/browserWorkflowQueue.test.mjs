/**
 * 锁定「生成期间的浏览器串行队列」行为。
 *
 * 现场问题（用户实测）：产品短视频跑到「正在生成替换图」时，右上角「打开系统共享 Chrome」
 * 点了一直转圈。原因是这三个界面操作和生成走同一条串行队列，而队列**没有等待超时** ——
 * runOpsCli 的 timeoutMs 只从任务真正开始执行才计时，所以按钮会一直转到整个生成结束。
 * 这类操作又必须重启 Chrome（open 切有头、check-login 走 stop_chrome），排到了反而会
 * 打断生成，所以正确行为是立刻拒绝并说明原因，而不是排队等。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  assertBrowserWorkflowIdle,
  browserWorkflowBusyLabel,
  enqueueBrowserWorkflow
} from '../server/services/googleFlowWorkflowQueue.js';
import { runScheduledGeneration } from '../server/services/generationRuntime/scheduler.js';

test('生成占用 Chrome 期间，界面操作立刻拿到可读的拒绝而不是干等', async () => {
  assert.equal(browserWorkflowBusyLabel(), '');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const running = enqueueBrowserWorkflow(() => gate, { label: '即梦图片生成' });

  assert.equal(browserWorkflowBusyLabel(), '即梦图片生成');
  const error = (() => {
    try {
      assertBrowserWorkflowIdle('打开浏览器窗口');
      return null;
    } catch (thrown) {
      return thrown;
    }
  })();
  assert.ok(error, '生成进行中必须拒绝');
  assert.equal(error.code, 'BROWSER_WORKFLOW_BUSY');
  assert.equal(error.status, 409);
  // 提示里要同时给出「谁在占用」和「为什么不能现在做」，否则用户只会反复点。
  assert.match(error.message, /即梦图片生成/);
  assert.match(error.message, /中断当前生成/);

  release();
  await running;
  assert.equal(browserWorkflowBusyLabel(), '');
  assert.doesNotThrow(() => assertBrowserWorkflowIdle('打开浏览器窗口'));
});

test('任务失败也要释放队列，不能把后续操作永久锁死', async () => {
  const failing = enqueueBrowserWorkflow(() => Promise.reject(new Error('生成失败')), { label: '即梦视频生成' });
  await assert.rejects(failing, /生成失败/);
  assert.equal(browserWorkflowBusyLabel(), '');
});

test('HTTP 生成运行时占用期间同样拒绝打开或重启共享 Chrome', async () => {
  let release;
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const running = runScheduledGeneration({
    provider: 'jimeng',
    label: '即梦 HTTP 图片生成',
    task: async () => {
      started();
      await gate;
    }
  });

  await startedPromise;
  assert.equal(browserWorkflowBusyLabel(), '即梦 HTTP 图片生成');
  assert.throws(() => assertBrowserWorkflowIdle('打开浏览器窗口'), error => {
    assert.equal(error.code, 'BROWSER_WORKFLOW_BUSY');
    assert.match(error.message, /即梦 HTTP 图片生成/);
    return true;
  });

  release();
  await running;
  assert.equal(browserWorkflowBusyLabel(), '');
});

test('取消信号立即从浏览器队列移除任务，排队任务不会再启动', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const running = enqueueBrowserWorkflow(() => gate, { label: '前序生成' });
  const controller = new AbortController();
  let started = false;
  const queued = enqueueBrowserWorkflow(() => {
    started = true;
  }, { label: '待取消生成', signal: controller.signal });

  controller.abort();
  await assert.rejects(queued, error =>
    error.code === 'OPERATION_CANCELLED' && error.cancelled === true
  );
  assert.equal(started, false);
  assert.equal(browserWorkflowBusyLabel(), '前序生成');

  release();
  await running;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, false);
  assert.equal(browserWorkflowBusyLabel(), '');
});

test('取消正在执行的任务后，队列在它真正收尾前仍然算忙', async () => {
  // 取消只表示「调用方不再等结果」：ops_cli 子进程还在收尾，Chrome 仍被它占着。
  // 早期实现在 abort 时就把条目移出 inFlight，于是 assertBrowserWorkflowIdle 立刻放行
  // 「打开共享 Chrome / 检查登录」——而这两个动作都会 stop_chrome，正好把还没退干净的
  // 那个任务打断。这正是这几个 Windows 修复要根除的生命周期问题。
  assert.equal(browserWorkflowBusyLabel(), '');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const controller = new AbortController();
  let started = false;
  const running = enqueueBrowserWorkflow(() => { started = true; return gate; }, {
    label: '即梦视频生成',
    signal: controller.signal
  });

  // 必须等任务体真的跑起来再取消：还在排队时取消应当立刻释放（另有用例覆盖），
  // 这里要锁的是「已经在驱动 Chrome」的那一种。
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  assert.equal(browserWorkflowBusyLabel(), '即梦视频生成');
  controller.abort();
  await assert.rejects(running, error => error.code === 'OPERATION_CANCELLED');

  // 调用方已经拿到 reject，但任务体还没结束 —— 队列必须继续拒绝界面操作。
  assert.equal(browserWorkflowBusyLabel(), '即梦视频生成');
  assert.throws(() => assertBrowserWorkflowIdle('打开浏览器窗口'), /BROWSER_WORKFLOW_BUSY|中断当前生成/);

  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(browserWorkflowBusyLabel(), '');
});

test('取消错误的形状对四层调用方一致：submitted 必须为 false', async () => {
  // shouldRetryOpsFailure 与视频任务的 retryBlocked 都按 submitted 判定。
  // 漏设会让「用户主动取消」被当成「已提交、状态未知」，界面就会让用户去平台
  // 历史记录里找一个根本没提交过的任务。
  const controller = new AbortController();
  controller.abort();
  const cancelled = enqueueBrowserWorkflow(() => {}, { label: '即梦图片生成', signal: controller.signal });
  await assert.rejects(cancelled, error => {
    assert.equal(error.code, 'OPERATION_CANCELLED');
    assert.equal(error.cancelled, true);
    assert.equal(error.submitted, false);
    return true;
  });
});

test('检查登录态在拒绝之前不得写入 checking 状态', () => {
  // 顺序反了的话，三个平台会永久停在「检查中」——和探针卡死表现完全一样。
  // 这几条路由已从 server/index.js 搬到 server/routes/browser.js（行为未变）。
  const source = fs.readFileSync(new URL('../server/routes/browser.js', import.meta.url), 'utf8');
  const handler = source.slice(
    source.indexOf("router.post('/browser-sessions/check'"),
    source.indexOf("router.post('/browser/open'")
  );
  assert.ok(handler.length > 0, '没找到 check-login 路由');
  assert.ok(
    handler.indexOf('assertBrowserWorkflowIdle') < handler.indexOf("transition(provider, 'checking')"),
    '忙碌判定必须在写入 checking 之前'
  );
});

test('生成链路不再占用浏览器串行队列', () => {
  // 曾经所有生成都要排队抢那一个 Chrome：识图没入队还会关掉正在用的页面。
  // DOM 生成删除后，队列只服务「打开浏览器 / 登录」这类真正独占的操作，
  // HTTP 生成由 Generation Scheduler 管理任务级提交边界；打开/登录队列不执行生成。
  const files = [
    '../server/services/geminiWebWorkflow.js',
    '../server/services/googleFlowWorkflow.js',
    '../server/services/googleFlowImageWorkflow.js',
    '../server/services/jimengImageWorkflow.js',
    '../server/services/jimengVideoWorkflow.js'
  ];
  for (const file of files) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /enqueue(Browser|GoogleFlow)Workflow/, `${file} 不应再往浏览器队列排生成任务`);
    assert.match(source, /runWithExecutionMode/, `${file} 应通过统一分发进入 HTTP 通道`);
  }
});

test('浏览器队列仍然保护登录 / 打开窗口这类独占操作', () => {
  const browserRoutes = fs.readFileSync(new URL('../server/routes/browser.js', import.meta.url), 'utf8');
  assert.match(browserRoutes, /assertBrowserWorkflowIdle\('打开浏览器窗口'\)/);
  assert.match(browserRoutes, /assertBrowserWorkflowIdle\('打开登录窗口'\)/);
});
