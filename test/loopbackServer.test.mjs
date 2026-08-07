import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLoopbackServer } from '../electron/auth/loopbackServer.js';

test('loopback 收到 /oauth/callback?code= 时 waitForCode 返回该 code', async () => {
  const { port, waitForCode } = await startLoopbackServer({ timeoutMs: 5000 });
  assert.ok(port > 0 && port < 65536);

  const codePromise = waitForCode();
  const res = await fetch(`http://127.0.0.1:${port}/oauth/callback?code=ABC123`);
  assert.equal(res.status, 200);
  await res.text();

  assert.equal(await codePromise, 'ABC123');
});

test('回调缺少 code 时 waitForCode 拒绝', async () => {
  const { port, waitForCode } = await startLoopbackServer({ timeoutMs: 5000 });
  // 先挂上期望（同步 attach catch），再触发回调，避免拒绝落在无处理窗口。
  const expectation = assert.rejects(waitForCode(), /登录码/);
  await fetch(`http://127.0.0.1:${port}/oauth/callback`).then((r) => r.text());
  await expectation;
});

test('回调带 error 参数时 waitForCode 拒绝', async () => {
  const { port, waitForCode } = await startLoopbackServer({ timeoutMs: 5000 });
  const expectation = assert.rejects(waitForCode(), /登录失败/);
  await fetch(`http://127.0.0.1:${port}/oauth/callback?error=access_denied`).then((r) => r.text());
  await expectation;
});

test('超时后 waitForCode 拒绝', async () => {
  const { waitForCode } = await startLoopbackServer({ timeoutMs: 120 });
  await assert.rejects(waitForCode(), /超时/);
});
