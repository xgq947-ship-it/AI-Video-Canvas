#!/usr/bin/env node
/**
 * P6 活跃上报联调：真实 Electron 运行时、临时 userData、真实 safeStorage、
 * 真实本地 Wrangler Worker 与本地 D1。不访问远端、不写用户正式 userData。
 *
 * 前置：cd cloudflare && npx wrangler dev --port 8788
 * 用法：npx electron scripts/activity-report-live-smoke.mjs [--base=http://localhost:8788]
 */

import { app } from 'electron';
import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CLOUDFLARE_DIR = path.join(PROJECT_ROOT, 'cloudflare');

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-activity-smoke-'));
app.setPath('userData', tmpUserData);
app.setName('Evan Activity Smoke Test');

const args = process.argv.slice(2);
function option(name, fallback) {
  const prefix = `--${name}=`;
  const hit = args.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}
const BASE = option('base', 'http://localhost:8788');

let passCount = 0;
let failCount = 0;
let smokeUserId = null;
let smokeDeviceHash = null;

function check(label, condition, detail) {
  if (condition) {
    passCount += 1;
    console.log(`  ✅ ${label}`);
  } else {
    failCount += 1;
    console.log(`  ❌ ${label}${detail ? `  (${JSON.stringify(detail)})` : ''}`);
  }
}

function readDevVar(name) {
  const content = fs.readFileSync(path.join(CLOUDFLARE_DIR, '.dev.vars'), 'utf8');
  const match = content.match(new RegExp(`^${name}=(.*)$`, 'm'));
  if (!match) throw new Error(`cloudflare/.dev.vars 缺少 ${name}`);
  return match[1].trim();
}

function mintAccessToken(userId, secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, typ: 'access', iat: now, exp: now + 3600 })
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function d1(sql) {
  const output = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'ai-canvas-auth', '--local', '--command', sql, '--json'],
    { cwd: CLOUDFLARE_DIR, stdio: ['ignore', 'pipe', 'ignore'] }
  ).toString();
  const start = output.indexOf('[');
  const payload = JSON.parse(start >= 0 ? output.slice(start) : output);
  return payload.flatMap((entry) => (Array.isArray(entry?.results) ? entry.results : []));
}

async function api(pathname, { token, body } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

function cleanup() {
  try {
    if (smokeDeviceHash) {
      d1(`DELETE FROM activity_events WHERE device_hash = '${smokeDeviceHash}'`);
    }
    if (smokeUserId) {
      d1(`DELETE FROM users WHERE id = '${smokeUserId}'`);
    }
  } catch (error) {
    console.error('[cleanup] 本地 D1 清理失败：', error.message);
  }
  fs.rmSync(tmpUserData, { recursive: true, force: true });
}

async function run() {
  console.log(`\n活跃上报联调（真实 Electron / 本地 D1）\n目标 ${BASE}\n`);

  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`连不上 ${BASE}，请先运行：cd cloudflare && npx wrangler dev --port 8788`);

  const { createSecureStore } = await import(path.join(PROJECT_ROOT, 'electron/secureStore.js'));
  const { createDeviceIdentity } = await import(path.join(PROJECT_ROOT, 'electron/deviceIdentity.js'));
  const { createActivityReporter } = await import(path.join(PROJECT_ROOT, 'electron/activityReporter.js'));

  const secureStore = createSecureStore({ dir: tmpUserData });
  check('safeStorage 在真实 Electron 运行时可用', secureStore.isAvailable() === true);
  const deviceIdentity = createDeviceIdentity({ configDir: tmpUserData, secureStore });
  const identity = await deviceIdentity.ensureIdentity();
  smokeDeviceHash = identity.deviceHash;
  check('真实设备身份生成成功', typeof smokeDeviceHash === 'string' && smokeDeviceHash.length === 64);

  smokeUserId = `smoke-activity-${randomUUID()}`;
  d1(
    `INSERT INTO users (id,email,display_name,status,created_at,updated_at) VALUES (`
      + `'${smokeUserId}','${smokeUserId}@example.com','Activity Smoke','active',`
      + `strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  );
  const token = mintAccessToken(smokeUserId, readDevVar('SESSION_SIGNING_SECRET'));

  console.log('\n0) 鉴权与必填字段');
  const unauthenticated = await api('/api/report-activity', {
    body: { device_hash: smokeDeviceHash },
  });
  const missingDevice = await api('/api/report-activity', { token, body: {} });
  check('缺少 Bearer token 返回 401 AUTH_REQUIRED', unauthenticated.status === 401 && unauthenticated.data?.code === 'AUTH_REQUIRED', unauthenticated);
  check('缺少 device_hash 返回 400 BAD_REQUEST', missingDevice.status === 400 && missingDevice.data?.code === 'BAD_REQUEST', missingDevice);

  console.log('\n1) 真实 activityReporter 首次上报 + 进程内防重复');
  const reporter = createActivityReporter({
    authManager: { getAccessToken: () => token },
    deviceIdentity,
    baseUrl: BASE,
    appVersion: '0.0.0-activity-smoke',
  });
  const first = await reporter.reportOnce();
  const clientRepeat = await reporter.reportOnce();
  check('首次上报 reported=true', first.success === true && first.reported === true, first);
  check('同进程第二次调用不再请求', clientRepeat.skipped === 'already_attempted', clientRepeat);

  console.log('\n2) 服务端同日幂等');
  const serverRepeat = await api('/api/report-activity', {
    token,
    body: {
      device_hash: smokeDeviceHash,
      app_version: '0.0.0-activity-smoke',
      platform: 'macOS',
      event_date: '1999-01-01',
    },
  });
  check('同日第二次返回 200 + reported=false', serverRepeat.status === 200 && serverRepeat.data?.reported === false, serverRepeat);
  const todayRows = d1(
    `SELECT count(*) AS count FROM activity_events
     WHERE device_hash = '${smokeDeviceHash}' AND event_date = date('now')`
  );
  check('D1 今天只有一行', Number(todayRows[0]?.count) === 1, todayRows);
  const ignoredClientDate = d1(
    `SELECT count(*) AS count FROM activity_events
     WHERE device_hash = '${smokeDeviceHash}' AND event_date = '1999-01-01'`
  );
  check('服务端忽略客户端 event_date', Number(ignoredClientDate[0]?.count) === 0, ignoredClientDate);

  console.log('\n3) 不同 UTC 日期可以各记录一行');
  d1(
    `INSERT INTO activity_events (user_id, device_hash, event_date, app_version, platform)
     VALUES ('${smokeUserId}', '${smokeDeviceHash}', date('now', '-1 day'), '0.0.0-activity-smoke', 'macOS')`
  );
  const dates = d1(
    `SELECT count(DISTINCT event_date) AS count FROM activity_events WHERE device_hash = '${smokeDeviceHash}'`
  );
  check('同一设备跨两天共有两个日期', Number(dates[0]?.count) === 2, dates);

  console.log('\n4) 服务不可达不抛异常、不重试');
  const offlineReporter = createActivityReporter({
    authManager: { getAccessToken: () => token },
    deviceIdentity,
    baseUrl: 'http://127.0.0.1:1',
    appVersion: '0.0.0-activity-smoke',
  });
  let offlineResult = null;
  let offlineThrew = false;
  try {
    offlineResult = await offlineReporter.reportOnce();
  } catch {
    offlineThrew = true;
  }
  const offlineRepeat = await offlineReporter.reportOnce();
  check('服务不可达时 reportOnce 不抛', offlineThrew === false && offlineResult?.success === false, offlineResult);
  check('失败后同进程不重试', offlineRepeat.skipped === 'already_attempted', offlineRepeat);

  console.log(`\n结果：${passCount} 通过 / ${failCount} 失败\n`);
}

app.whenReady().then(async () => {
  try {
    await run();
  } catch (error) {
    failCount += 1;
    console.error('\n💥 脚本异常：', error);
  } finally {
    cleanup();
    app.exit(failCount > 0 ? 1 : 0);
  }
});
