import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

import {
  createDesktopPollProof,
  pollDesktopSession,
} from '../electron/auth/desktopPolling.js';

const authManagerSource = fs.readFileSync(
  new URL('../electron/auth/authManager.js', import.meta.url),
  'utf8'
);
const workerAuthSource = fs.readFileSync(
  new URL('../cloudflare/src/routes/auth.ts', import.meta.url),
  'utf8'
);
const workerDbSource = fs.readFileSync(
  new URL('../cloudflare/src/lib/db.ts', import.meta.url),
  'utf8'
);
const workerIndexSource = fs.readFileSync(
  new URL('../cloudflare/src/index.ts', import.meta.url),
  'utf8'
);
const migrationSource = fs.readFileSync(
  new URL('../cloudflare/migrations/0008_desktop_login_polling.sql', import.meta.url),
  'utf8'
);

test('桌面轮询证明使用高熵 verifier，浏览器只收到 SHA-256 challenge', () => {
  const { verifier, challenge } = createDesktopPollProof();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.match(challenge, /^[a-f0-9]{64}$/);
  assert.equal(createHash('sha256').update(verifier, 'utf8').digest('hex'), challenge);
});

test('登录轮询跨过 pending 和暂时网络错误后返回会话', async () => {
  let calls = 0;
  const data = await pollDesktopSession({
    pollVerifier: createDesktopPollProof().verifier,
    deviceHash: 'device-hash',
    timeoutMs: 500,
    intervalMs: 1,
    apiPost: async (pathname, body) => {
      calls += 1;
      assert.equal(pathname, '/auth/poll');
      assert.equal(body.device_hash, 'device-hash');
      if (calls === 1) throw new TypeError('temporary network failure');
      if (calls === 2) {
        return { ok: true, status: 202, data: { success: false, code: 'LOGIN_PENDING' } };
      }
      return {
        ok: true,
        status: 200,
        data: { success: true, access_token: 'access', refresh_token: 'refresh', user: { id: 'u1' } },
      };
    },
  });
  assert.equal(calls, 3);
  assert.equal(data.user.id, 'u1');
});

test('登录轮询对确定性 4xx 立即失败', async () => {
  await assert.rejects(
    pollDesktopSession({
      pollVerifier: createDesktopPollProof().verifier,
      deviceHash: 'device-hash',
      timeoutMs: 500,
      intervalMs: 1,
      apiPost: async () => ({
        ok: false,
        status: 400,
        data: { success: false, message: 'poll_verifier 非法' },
      }),
    }),
    /poll_verifier 非法/
  );
});

test('登录轮询总超时后给出可重试提示', async () => {
  await assert.rejects(
    pollDesktopSession({
      pollVerifier: createDesktopPollProof().verifier,
      deviceHash: 'device-hash',
      timeoutMs: 20,
      intervalMs: 2,
      apiPost: async () => ({
        ok: true,
        status: 202,
        data: { success: false, code: 'LOGIN_PENDING' },
      }),
    }),
    /登录超时，请重试/
  );
});

test('新版桌面不再启动 localhost 回跳，Worker 同时保留旧版 exchange 兼容', () => {
  assert.match(authManagerSource, /poll_challenge=/);
  assert.match(authManagerSource, /pollDesktopSession/);
  assert.doesNotMatch(authManagerSource, /startLoopbackServer/);

  assert.match(workerIndexSource, /path === '\/auth\/poll'/);
  assert.match(workerAuthSource, /handleDesktopPoll/);
  assert.match(workerAuthSource, /loginPollingCompleteHtml/);
  assert.match(workerDbSource, /WHERE poll_challenge = \? AND used = 0 AND expires_at > \?/);
  assert.match(migrationSource, /add column poll_challenge text/i);
  assert.match(migrationSource, /unique index[\s\S]*poll_challenge/i);

  // v0.2.16 仍会走 port + /auth/exchange，部署 Worker 后不能让已安装用户失效。
  assert.match(workerAuthSource, /state\.port !== null/);
  assert.match(workerAuthSource, /handleExchange/);
  assert.match(workerIndexSource, /path === '\/auth\/exchange'/);
});
