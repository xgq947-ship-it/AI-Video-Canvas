import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createActivityReporter } from '../electron/activityReporter.js';

test('activityReporter 未登录时跳过，登录后并发调用也只请求一次', async () => {
  const originalFetch = globalThis.fetch;
  let token = null;
  let fetchCalls = 0;
  let requestBody = null;

  globalThis.fetch = async (_url, init) => {
    fetchCalls += 1;
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ success: true, reported: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const reporter = createActivityReporter({
      authManager: { getAccessToken: () => token },
      deviceIdentity: { ensureIdentity: async () => ({ deviceHash: 'device-hash' }) },
      baseUrl: 'http://localhost:8788/',
      appVersion: '1.2.3',
    });

    const skipped = await reporter.reportOnce();
    assert.equal(skipped.skipped, 'auth_required');
    assert.equal(fetchCalls, 0);

    token = 'access-token';
    const [first, second] = await Promise.all([reporter.reportOnce(), reporter.reportOnce()]);
    assert.equal(fetchCalls, 1);
    assert.equal(first.success, true);
    assert.equal(first.reported, true);
    assert.equal(second.skipped, 'already_attempted');
    assert.deepEqual(Object.keys(requestBody).sort(), ['app_version', 'device_hash', 'platform']);
    assert.equal(requestBody.device_hash, 'device-hash');
    assert.equal(requestBody.app_version, '1.2.3');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('activityReporter 服务不可达时不抛异常且不重试', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  const originalConsoleError = console.error;
  console.error = () => {};
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('offline');
  };

  try {
    const reporter = createActivityReporter({
      authManager: { getAccessToken: () => 'access-token' },
      deviceIdentity: { ensureIdentity: async () => ({ deviceHash: 'device-hash' }) },
      baseUrl: 'http://127.0.0.1:1',
      appVersion: '1.2.3',
    });

    const first = await reporter.reportOnce();
    const second = await reporter.reportOnce();
    assert.deepEqual(first, { success: false, reported: false });
    assert.equal(second.skipped, 'already_attempted');
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test('主进程只在 authenticated 跃迁后延迟触发活跃上报，不新增渲染进程 IPC', () => {
  const mainSource = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preloadSource = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');

  assert.match(mainSource, /createActivityReporter\(\{/);
  assert.match(
    mainSource,
    /next\?\.status === 'authenticated'[\s\S]*lastAuthStatus !== 'authenticated'[\s\S]*scheduleActivityReport\(\)/
  );
  assert.match(mainSource, /setTimeout\([\s\S]*activityReporter\?\.reportOnce\(\)[\s\S]*7_000/);
  assert.doesNotMatch(preloadSource, /activity|report-activity/);
});
