/**
 * 锁定「生成期间的浏览器串行队列」行为。
 *
 * 现场问题（用户实测）：产品短视频跑到「正在生成替换图」时，右上角「打开 Evan 专属 Chrome」
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

test('检查登录态在拒绝之前不得写入 checking 状态', () => {
  // 顺序反了的话，三个平台会永久停在「检查中」——和探针卡死表现完全一样。
  const source = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const handler = source.slice(
    source.indexOf("app.post('/api/browser-sessions/check'"),
    source.indexOf("app.post('/api/browser/open'")
  );
  assert.ok(handler.length > 0, '没找到 check-login 路由');
  assert.ok(
    handler.indexOf('assertBrowserWorkflowIdle') < handler.indexOf("transition(provider, 'checking')"),
    '忙碌判定必须在写入 checking 之前'
  );
});

test('识图 / 提示词优化与生成共用同一条队列', () => {
  // Gemini 识图曾是唯一没入队的浏览器任务：它和生成同时驱动同一个 Chrome，
  // 而 ops-cli 工作页是 cleanup_before=True，后来者会关掉正在用的页面。
  const source = fs.readFileSync(new URL('../server/services/geminiWebWorkflow.js', import.meta.url), 'utf8');
  assert.match(source, /runGeminiWebTextTask = options =>\s*\n?\s*enqueueBrowserWorkflow/);
});
