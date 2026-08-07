#!/usr/bin/env node
/**
 * licenseManager 完整生命周期联调（打真实跑着的本地 Worker，真实 D1）。
 *
 * licenseManager.js 依赖 authConfig.js（进而依赖 electron 的 app.isPackaged），
 * 这是正当的设计——它是主进程专属模块，不该为了方便测试而假装能脱离 Electron
 * 运行时。所以本脚本用 `electron` 命令本身跑（不是 `node`），在 app.whenReady()
 * 之后执行验证逻辑，并把 userData 指向一次性临时目录——不碰用户真实的
 * `~/Library/Application Support/Evan AI Video Canvas`。
 *
 * 用真实的 createSecureStore（真实 safeStorage 加密）+ 真实的 createDeviceIdentity，
 * 只有 authManager 用了简化版（提供铸造的 access token，不需要真的走一遍 OAuth——
 * 那部分 P1 阶段已经用真实 Google 账号验证过）。
 *
 * 关键验证点：「重启后」离线也能立刻拿到 licensed 状态——不是网络失败时的降级，
 * 是从设计上根本不发请求。做法：给「重启后」的实例一个连不上的 baseUrl，
 * 如果 loadLocalLicense() 之后 getState() 依然正确返回 licensed，就证明了
 * 这条路径没有偷偷发起任何网络请求。
 *
 * 前置：cd cloudflare && npm run dev（wrangler dev，默认 8788）
 * 用法：npx electron scripts/license-client-live-smoke.mjs [--base=http://localhost:8788]
 */
import { app } from 'electron';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CLOUDFLARE_DIR = path.join(PROJECT_ROOT, 'cloudflare');

// 必须在 app ready 之前设置：一次性临时 userData 目录，绝不碰用户真实数据。
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-license-smoke-'));
app.setPath('userData', tmpUserData);
app.setName('Evan License Smoke Test'); // 避免 macOS Keychain 服务名跟正式 App 混淆

const args = process.argv.slice(2);
function option(name, fallback) {
    const prefix = `--${name}=`;
    const hit = args.find(arg => arg.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : fallback;
}
const BASE = option('base', 'http://localhost:8788');

let passCount = 0, failCount = 0;
function check(label, condition, detail) {
    if (condition) { passCount++; console.log(`  ✅ ${label}`); }
    else { failCount++; console.log(`  ❌ ${label}${detail ? `  (${JSON.stringify(detail)})` : ''}`); }
}

function readDevVar(name) {
    const content = fs.readFileSync(path.join(CLOUDFLARE_DIR, '.dev.vars'), 'utf8');
    const match = content.match(new RegExp(`^${name}=(.*)$`, 'm'));
    if (!match) throw new Error(`cloudflare/.dev.vars 缺少 ${name}`);
    return match[1].trim();
}

function mintAccessToken(userId, secret) {
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ sub: userId, typ: 'access', iat: now, exp: now + 3600 })).toString('base64url');
    const sig = createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}

function d1(sql) {
    const out = execFileSync(
        'npx', ['wrangler', 'd1', 'execute', 'ai-canvas-auth', '--local', '--command', sql, '--json'],
        { cwd: CLOUDFLARE_DIR, stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString();
    const i = out.indexOf('[');
    return JSON.parse(i >= 0 ? out.slice(i) : out);
}

function seedUser(userId) {
    d1(`INSERT OR REPLACE INTO users (id,email,status,created_at,updated_at) VALUES ('${userId}','${userId}@example.com','active','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`);
}

function generateCode(salt, note) {
    const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    const group = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
    const code = `AICV-${group()}-${group()}-${group()}`;
    const hash = createHash('sha256').update(code.trim().toUpperCase() + salt).digest('hex');
    d1(`INSERT INTO license_keys (id, code_hash, status, license_type, max_activations, activation_count, features, note, created_at, updated_at) VALUES ('${randomUUID()}', '${hash}', 'unused', 'perpetual', 1, 0, '["director_workflow"]', '${note}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
    return code;
}

async function run() {
    console.log(`\nlicenseManager 生命周期联调（真实 Electron 运行时，临时 userData: ${tmpUserData}）\n目标 ${BASE}\n`);

    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
        console.error(`❌ 连不上 ${BASE}，请先在另一个终端跑：cd cloudflare && npm run dev`);
        app.exit(1);
        return;
    }

    const { createSecureStore } = await import(path.join(PROJECT_ROOT, 'electron/secureStore.js'));
    const { createDeviceIdentity } = await import(path.join(PROJECT_ROOT, 'electron/deviceIdentity.js'));
    const { createLicenseManager } = await import(path.join(PROJECT_ROOT, 'electron/license/licenseManager.js'));

    const secret = readDevVar('SESSION_SIGNING_SECRET');
    const salt = readDevVar('LICENSE_CODE_SALT');
    const userId = `smoke-lm-${randomUUID()}`;
    seedUser(userId);
    const token = mintAccessToken(userId, secret);
    const deviceHash1 = `smoke-lm-device-${randomUUID()}`;

    const fakeAuthManager = { getAccessToken: () => token };

    // ---- 真实 secureStore + deviceIdentity（真实 safeStorage 加密，落在临时 userData） ----
    const secureStore = createSecureStore({ dir: tmpUserData });
    check('safeStorage 在真实 Electron 运行时里可用', secureStore.isAvailable() === true);

    const deviceIdentity = createDeviceIdentity({ configDir: tmpUserData, secureStore });
    const identity = await deviceIdentity.ensureIdentity();
    check('设备身份生成成功', typeof identity.deviceHash === 'string' && identity.deviceHash.length === 64);

    const lm1 = createLicenseManager({
        authManager: fakeAuthManager,
        deviceIdentity,
        secureStore,
        baseUrl: BASE,
        appVersion: '0.0.0-smoke',
    });

    const hadLocal1 = await lm1.loadLocalLicense();
    check('首次启动：没有本地许可证', hadLocal1 === false);
    check('首次启动：状态为 unknown', lm1.getState().status === 'unknown');

    await fetch(`${BASE}/api/device/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ device_hash: identity.deviceHash, platform: 'macOS' }),
    });

    const trialState = await lm1.refresh();
    check('建立设备后 refresh()：状态为 trial', trialState.status === 'trial', trialState);

    const code = generateCode(salt, 'licenseManager-smoke');
    const activateResult = await lm1.activate(code);
    check('activate() 成功', activateResult.success === true, activateResult);
    check('激活后 getState() 立刻变成 licensed', lm1.getState().status === 'licensed');

    const storedPayload = await secureStore.get('license.payload');
    const storedSignature = await secureStore.get('license.signature');
    check('真实 SecureStore（safeStorage 加密）里写入了许可证', Boolean(storedPayload && storedSignature));

    // ---- 模拟「重启」：新的 licenseManager 实例，同一个 secureStore/deviceIdentity（同一份持久化数据），
    //      但 baseUrl 连不上——如果代码偷偷发了网络请求，下面的检查会失败 ----
    const lm2 = createLicenseManager({
        authManager: fakeAuthManager,
        deviceIdentity,
        secureStore,
        baseUrl: 'http://127.0.0.1:1',
        appVersion: '0.0.0-smoke',
    });
    const hadLocal2 = await lm2.loadLocalLicense();
    check('「重启」后：本地许可证验签通过', hadLocal2 === true);
    check('「重启」后：不发任何网络请求就拿到 licensed（baseUrl 是错的都不受影响）', lm2.getState().status === 'licensed');
    check('「重启」后：features 正确', JSON.stringify(lm2.getState().features) === JSON.stringify(['director_workflow']));

    const refreshAfterRestart = await lm2.refresh();
    check('licensed 用户调用 refresh() 依然短路成功（不受 24h 复验限制影响）', refreshAfterRestart.status === 'licensed');

    // ---- 复制到另一台「设备」：验签必须失败 ----
    const otherDeviceIdentity = { ensureIdentity: async () => ({ deviceHash: `other-${identity.deviceHash}`, installationIdHash: 'x' }) };
    const lm3 = createLicenseManager({
        authManager: fakeAuthManager,
        deviceIdentity: otherDeviceIdentity,
        secureStore, // 同一份许可证文件，但设备哈希不同
        baseUrl: 'http://127.0.0.1:1',
        appVersion: '0.0.0-smoke',
    });
    const hadLocal3 = await lm3.loadLocalLicense();
    check('复制到其他设备：本地许可证验签失败，不采信', hadLocal3 === false);
    check('复制到其他设备：状态不是 licensed', lm3.getState().status !== 'licensed');

    // ---- 网络不可用时 activate() 不抛异常，转成明确的失败结果 ----
    const offlineLm = createLicenseManager({
        authManager: fakeAuthManager,
        deviceIdentity,
        secureStore: createSecureStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'evan-license-smoke-offline-')) }),
        baseUrl: 'http://127.0.0.1:1',
        appVersion: '0.0.0-smoke',
    });
    const offlineResult = await offlineLm.activate('AICV-0000-0000-0000');
    check('断网激活：不抛异常，返回 NETWORK_ERROR', offlineResult.success === false && offlineResult.code === 'NETWORK_ERROR', offlineResult);

    console.log(`\n结果：${passCount} 通过 / ${failCount} 失败\n`);

    fs.rmSync(tmpUserData, { recursive: true, force: true });
    app.exit(failCount > 0 ? 1 : 0);
}

app.whenReady().then(run).catch(err => {
    console.error('\n💥 脚本异常：', err);
    app.exit(1);
});
