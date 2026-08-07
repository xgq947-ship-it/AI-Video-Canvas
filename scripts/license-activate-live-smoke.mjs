#!/usr/bin/env node
/**
 * 授权码激活的手动联调脚本（延续 web-http-live-smoke.mjs 的模式：opt-in、
 * 打真实跑着的服务，不进 test/*.test.mjs、不由 `npm test` 自动执行——
 * Cloudflare Worker 代码要测真实分支需要真实 D1，仓库统一用 node --test
 * 没有 miniflare，这类验证只能对着真实运行的 wrangler dev 打）。
 *
 * 前置条件：
 *   1. cd cloudflare && npm run dev（wrangler dev，默认 8788）
 *   2. 本地 D1 已跑过迁移（wrangler d1 migrations apply ai-canvas-auth --local）
 *
 * 用法：
 *   node scripts/license-activate-live-smoke.mjs [--base=http://localhost:8788]
 *
 * 覆盖点（对应文档 §23 验收清单里"授权码"这一段）：
 *   - 未使用授权码可以激活
 *   - 并发提交同一个授权码只有一个成功
 *   - 已使用授权码不能在其他设备使用
 *   - 被禁用/撤销的授权码无法激活
 *   - 同设备重装恢复授权（restore）
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CLOUDFLARE_DIR = path.join(PROJECT_ROOT, 'cloudflare');

const args = process.argv.slice(2);
function option(name, fallback) {
    const prefix = `--${name}=`;
    const hit = args.find(arg => arg.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : fallback;
}

const BASE = option('base', 'http://localhost:8788');

let passCount = 0;
let failCount = 0;
function check(label, condition, detail) {
    if (condition) {
        passCount++;
        console.log(`  ✅ ${label}`);
    } else {
        failCount++;
        console.log(`  ❌ ${label}${detail ? `  (${JSON.stringify(detail)})` : ''}`);
    }
}

function readDevVar(name) {
    const content = fs.readFileSync(path.join(CLOUDFLARE_DIR, '.dev.vars'), 'utf8');
    const match = content.match(new RegExp(`^${name}=(.*)$`, 'm'));
    if (!match) throw new Error(`cloudflare/.dev.vars 缺少 ${name}`);
    return match[1].trim();
}

function b64url(buf) {
    return buf.toString('base64url');
}

function mintAccessToken(userId, secret) {
    const now = Math.floor(Date.now() / 1000);
    const payload = b64url(Buffer.from(JSON.stringify({ sub: userId, typ: 'access', iat: now, exp: now + 3600 })));
    const sig = createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}

async function api(pathname, { method = 'GET', token, body } = {}) {
    const res = await fetch(`${BASE}${pathname}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
}

function d1(sql, { remote = false } = {}) {
    const out = execFileSync(
        'npx',
        ['wrangler', 'd1', 'execute', 'ai-canvas-auth', remote ? '--remote' : '--local', '--command', sql, '--json'],
        { cwd: CLOUDFLARE_DIR, stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString();
    // --json 仍可能在前面混入 proxy/config 的 WARNING 横幅；只取从第一个 '[' 开始的部分。
    const jsonStart = out.indexOf('[');
    return JSON.parse(jsonStart >= 0 ? out.slice(jsonStart) : out);
}

function seedUser(userId, email) {
    d1(
        `INSERT OR REPLACE INTO users (id,email,display_name,status,created_at,updated_at) VALUES ` +
        `('${userId}','${email}','Smoke Tester','active','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`
    );
}

function generateCode(salt, note) {
    const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    const group = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
    const code = `AICV-${group()}-${group()}-${group()}`;
    const hash = createHash('sha256').update(code.trim().toUpperCase() + salt).digest('hex');
    const id = randomUUID();
    d1(
        `INSERT INTO license_keys (id, code_hash, status, license_type, max_activations, activation_count, features, note, created_at, updated_at) ` +
        `VALUES ('${id}', '${hash}', 'unused', 'perpetual', 1, 0, '["director_workflow"]', '${note}', ` +
        `strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    );
    return { code, id };
}

async function main() {
    console.log(`\n授权码激活联调 — 目标 ${BASE}\n`);

    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
        console.error(`❌ 连不上 ${BASE}，请先在另一个终端跑：cd cloudflare && npm run dev`);
        process.exit(1);
    }

    const secret = readDevVar('SESSION_SIGNING_SECRET');
    const salt = readDevVar('LICENSE_CODE_SALT');

    const userA = `smoke-user-${randomUUID()}`;
    const userB = `smoke-user-${randomUUID()}`;
    seedUser(userA, `${userA}@example.com`);
    seedUser(userB, `${userB}@example.com`);
    const tokenA = mintAccessToken(userA, secret);
    const tokenB = mintAccessToken(userB, secret);

    const deviceA = `smoke-device-${randomUUID()}`;
    const deviceA2 = `smoke-device-${randomUUID()}`;
    const deviceB = `smoke-device-${randomUUID()}`;
    await api('/api/device/status', { method: 'POST', token: tokenA, body: { device_hash: deviceA, platform: 'macOS' } });
    await api('/api/device/status', { method: 'POST', token: tokenA, body: { device_hash: deviceA2, platform: 'macOS' } });
    await api('/api/device/status', { method: 'POST', token: tokenB, body: { device_hash: deviceB, platform: 'macOS' } });

    console.log('1) 未使用授权码可以激活');
    const code1 = generateCode(salt, 'smoke-1');
    const act1 = await api('/api/license/activate', { method: 'POST', token: tokenA, body: { license_code: code1.code, device_hash: deviceA } });
    check('激活成功', act1.status === 200 && act1.data?.success === true, act1.data);
    check('返回了签名许可证', typeof act1.data?.license?.payload === 'string' && typeof act1.data?.license?.signature === 'string');

    console.log('\n2) 已使用授权码不能在其他设备使用');
    const act2 = await api('/api/license/activate', { method: 'POST', token: tokenB, body: { license_code: code1.code, device_hash: deviceB } });
    check('返回 LICENSE_ALREADY_USED', act2.status === 409 && act2.data?.code === 'LICENSE_ALREADY_USED', act2.data);

    console.log('\n3) 同设备+同用户重复提交同一个已绑定的码 → 幂等重签同一份许可证');
    const act3 = await api('/api/license/activate', { method: 'POST', token: tokenA, body: { license_code: code1.code, device_hash: deviceA } });
    const decode = (p) => JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    check(
        'license_id 与首次激活一致',
        act3.data?.success && decode(act3.data.license.payload).license_id === decode(act1.data.license.payload).license_id,
        { first: act1.data, repeat: act3.data }
    );

    console.log('\n4) 同一台设备再用另一个码激活 → DEVICE_ALREADY_LICENSED');
    const code2 = generateCode(salt, 'smoke-2');
    const act4 = await api('/api/license/activate', { method: 'POST', token: tokenA, body: { license_code: code2.code, device_hash: deviceA } });
    check('返回 DEVICE_ALREADY_LICENSED', act4.status === 409 && act4.data?.code === 'DEVICE_ALREADY_LICENSED', act4.data);

    console.log('\n5) 并发提交同一个授权码：只能有一个成功');
    const code5 = generateCode(salt, 'smoke-concurrent');
    const deviceC1 = `smoke-device-${randomUUID()}`;
    const deviceC2 = `smoke-device-${randomUUID()}`;
    await api('/api/device/status', { method: 'POST', token: tokenB, body: { device_hash: deviceC1, platform: 'macOS' } });
    await api('/api/device/status', { method: 'POST', token: tokenB, body: { device_hash: deviceC2, platform: 'macOS' } });
    const [r1, r2] = await Promise.all([
        api('/api/license/activate', { method: 'POST', token: tokenB, body: { license_code: code5.code, device_hash: deviceC1 } }),
        api('/api/license/activate', { method: 'POST', token: tokenB, body: { license_code: code5.code, device_hash: deviceC2 } }),
    ]);
    const successes = [r1, r2].filter(r => r.data?.success === true).length;
    check('恰好一个成功', successes === 1, { r1: r1.data, r2: r2.data });

    console.log('\n6) 无效授权码 → LICENSE_INVALID');
    const act6 = await api('/api/license/activate', { method: 'POST', token: tokenA, body: { license_code: 'AICV-0000-0000-0000', device_hash: deviceA2 } });
    check('返回 LICENSE_INVALID', act6.status === 400 && act6.data?.code === 'LICENSE_INVALID', act6.data);

    console.log('\n7) 被禁用/撤销的授权码无法激活');
    const code7 = generateCode(salt, 'smoke-disabled');
    d1(`UPDATE license_keys SET status='disabled' WHERE code_hash='${createHash('sha256').update(code7.code.trim().toUpperCase() + salt).digest('hex')}'`);
    const act7 = await api('/api/license/activate', { method: 'POST', token: tokenA, body: { license_code: code7.code, device_hash: deviceA2 } });
    check('返回 LICENSE_DISABLED', act7.status === 400 && act7.data?.code === 'LICENSE_DISABLED', act7.data);

    console.log('\n8) 同设备重装恢复授权（restore）');
    const restore1 = await api('/api/license/restore', { method: 'POST', token: tokenA, body: { device_hash: deviceA } });
    check(
        'restore 返回同一个 license_id',
        restore1.data?.success && decode(restore1.data.license.payload).license_id === decode(act1.data.license.payload).license_id,
        restore1.data
    );

    console.log('\n9) 其他账号不能恢复不属于自己的授权');
    const restore2 = await api('/api/license/restore', { method: 'POST', token: tokenB, body: { device_hash: deviceA } });
    check('返回 DEVICE_NOT_OWNED', restore2.status === 403 && restore2.data?.code === 'DEVICE_NOT_OWNED', restore2.data);

    console.log('\n10) 未登录（无 token）→ AUTH_REQUIRED');
    const act10 = await api('/api/license/activate', { method: 'POST', body: { license_code: code1.code, device_hash: deviceA } });
    check('返回 401 AUTH_REQUIRED', act10.status === 401 && act10.data?.code === 'AUTH_REQUIRED', act10.data);

    console.log(`\n结果：${passCount} 通过 / ${failCount} 失败\n`);
    process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('\n💥 脚本异常：', err);
    process.exit(1);
});
