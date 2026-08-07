#!/usr/bin/env node
/**
 * P6：授权系统最低管理端。所有操作直接复用管理员现有的 Wrangler / D1 登录态；
 * 默认只读写本地 D1，只有显式 --remote 才访问生产。
 *
 * unbind-device 的设计：只允许解绑状态一致的已使用授权码。脚本把授权码恢复为 unused、
 * 清空用户/设备绑定并删除 license_devices 行，使旧设备无法再通过 restore 找回许可证，
 * 同一明文授权码可在新设备重新激活。已经签名并保存在旧电脑上的永久离线许可证不会被
 * 远程撤回——这是现有“永久授权可完全离线使用”的产品边界，管理脚本不能绕过签名模型。
 */

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CLOUDFLARE_DIR = path.join(PROJECT_ROOT, 'cloudflare');
const DATABASE_NAME = 'ai-canvas-auth';

const args = process.argv.slice(2);
const command = args[0] || 'help';

function option(name, fallback = undefined) {
  const flag = `--${name}`;
  const prefix = `${flag}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  const next = args[index + 1];
  return next && !next.startsWith('--') ? next : true;
}

function fail(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

function sqlEscape(value) {
  return String(value).replace(/'/g, "''");
}

function parseWranglerJson(output) {
  const start = output.indexOf('[');
  if (start < 0) fail(`无法解析 Wrangler 输出：${output.trim()}`);
  try {
    return JSON.parse(output.slice(start));
  } catch (error) {
    fail(`Wrangler 返回了无效 JSON：${error.message}`);
  }
}

function wranglerArgs(remote, tail) {
  return ['wrangler', 'd1', 'execute', DATABASE_NAME, remote ? '--remote' : '--local', ...tail];
}

function query(sql, { remote }) {
  try {
    const output = execFileSync('npx', wranglerArgs(remote, ['--command', sql, '--json']), {
      cwd: CLOUDFLARE_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const payload = parseWranglerJson(output);
    return payload.flatMap((entry) => (Array.isArray(entry?.results) ? entry.results : []));
  } catch (error) {
    const detail = error?.stderr?.toString().trim() || error?.message || String(error);
    fail(`D1 查询失败：${detail}`);
  }
}

/**
 * 多条关联写操作放进同一次 wrangler d1 execute --file 调用，返回后再逐项查询校验。
 * 不把“命令返回 0”误当成业务成功，避免只改了一侧却静默结束。
 */
function executeBatch(sql, { remote }) {
  const tempFile = path.join(os.tmpdir(), `evan-license-admin-${randomUUID()}.sql`);
  fs.writeFileSync(tempFile, `${sql.trim()}\n`, { mode: 0o600 });
  let writeError = null;
  try {
    execFileSync('npx', wranglerArgs(remote, ['--file', tempFile]), {
      cwd: CLOUDFLARE_DIR,
      stdio: 'inherit',
    });
  } catch (error) {
    writeError = error;
  } finally {
    fs.rmSync(tempFile, { force: true });
  }
  if (writeError) fail(`D1 写入失败：${writeError?.message || writeError}`);
}

function environmentName(remote) {
  return remote ? '远端生产 D1' : '本地 D1';
}

function requireValue(name) {
  const value = option(name);
  if (!value || value === true) fail(`缺少 --${name}=...`);
  return String(value).trim();
}

function booleanFlag(name) {
  const value = option(name, false);
  if (value === false) return false;
  if (value === true) return true;
  fail(`--${name} 是无值开关，请直接写 --${name}，不要写 --${name}=...`);
}

function readDevVar(name) {
  const devVarsPath = path.join(CLOUDFLARE_DIR, '.dev.vars');
  if (!fs.existsSync(devVarsPath)) return null;
  const content = fs.readFileSync(devVarsPath, 'utf8');
  return content.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim() || null;
}

function resolveSalt(remote) {
  if (process.env.LICENSE_CODE_SALT) return process.env.LICENSE_CODE_SALT;
  if (remote) return null;
  return readDevVar('LICENSE_CODE_SALT');
}

function normalizeCode(code) {
  return code.trim().toUpperCase();
}

function hashCode(code, salt) {
  return createHash('sha256').update(normalizeCode(code) + salt, 'utf8').digest('hex');
}

function resolveCodeHash(remote) {
  const explicitHash = option('code-hash');
  const plainCode = option('code');
  if (explicitHash && plainCode) fail('--code-hash 和 --code 只能传一个');
  if (explicitHash && explicitHash !== true) {
    const normalized = String(explicitHash).trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) fail('--code-hash 必须是 64 位十六进制 SHA-256');
    return normalized;
  }
  if (!plainCode || plainCode === true) fail('缺少 --code-hash=<hash> 或 --code=AICV-...');

  const normalizedCode = normalizeCode(String(plainCode));
  if (!/^AICV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalizedCode)) {
    fail('--code 格式应为 AICV-XXXX-XXXX-XXXX');
  }
  const salt = resolveSalt(remote);
  if (!salt) {
    fail(
      remote
        ? '--remote 下用明文授权码时必须显式提供 LICENSE_CODE_SALT；绝不会回退读取本地开发盐'
        : '找不到 LICENSE_CODE_SALT，请检查 cloudflare/.dev.vars'
    );
  }
  return hashCode(normalizedCode, salt);
}

function listCodes({ remote }) {
  const requestedStatus = option('status');
  const allowed = new Set(['unused', 'used', 'revoked', 'disabled']);
  if (requestedStatus && (requestedStatus === true || !allowed.has(String(requestedStatus)))) {
    fail('--status 只允许 unused、used、revoked、disabled');
  }
  const where = requestedStatus ? `WHERE lk.status = '${sqlEscape(requestedStatus)}'` : '';
  const rows = query(
    `SELECT
       substr(lk.id, 1, 8) AS id,
       CASE WHEN lk.activation_count > 0 OR lk.activated_at IS NOT NULL
         THEN 'AICV-XXXX-****-XXXX' ELSE '(明文未存储)' END AS code,
       lk.code_hash,
       lk.status,
       COALESCE(u.email, '') AS user_email,
       COALESCE(substr(lk.bound_device_hash, 1, 8), '') AS device,
       COALESCE(lk.activated_at, '') AS activated_at,
       COALESCE(lk.note, '') AS note
     FROM license_keys lk
     LEFT JOIN users u ON u.id = lk.bound_user_id
     ${where}
     ORDER BY lk.created_at DESC`,
    { remote }
  );
  console.log(`\n授权码（${environmentName(remote)}）：`);
  if (rows.length) console.table(rows);
  else console.log('  无记录');
  console.log('说明：数据库从不保存授权码明文；已激活授权码统一显示为 AICV-XXXX-****-XXXX。\n');
}

function disableCode({ remote, dryRun }) {
  const codeHash = resolveCodeHash(remote);
  const key = query(
    `SELECT id, status, bound_device_hash FROM license_keys WHERE code_hash = '${codeHash}'`,
    { remote }
  )[0];
  if (!key) fail('找不到对应授权码');
  if (key.status === 'revoked') fail('授权码已是 revoked，不能改为 disabled');

  let device = null;
  if (key.bound_device_hash) {
    device = query(
      `SELECT device_hash, license_status, license_key_id FROM license_devices
       WHERE device_hash = '${sqlEscape(key.bound_device_hash)}'`,
      { remote }
    )[0];
    if (!device || device.license_key_id !== key.id) {
      fail('授权码与设备绑定数据不一致，已停止写入，请先人工核实');
    }
  }

  if (dryRun) {
    console.log(`\n[--dry-run] 将在${environmentName(remote)}禁用授权码 ${key.id.slice(0, 8)}`);
    if (device) console.log(`并封禁设备 ${device.device_hash.slice(0, 8)}`);
    console.log('未写入数据库。\n');
    return;
  }

  const statements = [
    `UPDATE license_keys SET status = 'disabled', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE code_hash = '${codeHash}' AND status IN ('unused', 'used', 'disabled');`,
  ];
  if (device) {
    statements.push(
      `UPDATE license_devices SET license_status = 'blocked', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE device_hash = '${sqlEscape(device.device_hash)}' AND license_key_id = '${sqlEscape(key.id)}';`
    );
  }
  executeBatch(statements.join('\n'), { remote });

  const verifiedKey = query(`SELECT status FROM license_keys WHERE code_hash = '${codeHash}'`, { remote })[0];
  if (verifiedKey?.status !== 'disabled') fail('写入后校验失败：授权码没有变成 disabled');
  if (device) {
    const verifiedDevice = query(
      `SELECT license_status FROM license_devices WHERE device_hash = '${sqlEscape(device.device_hash)}'`,
      { remote }
    )[0];
    if (verifiedDevice?.license_status !== 'blocked') fail('写入后校验失败：绑定设备没有变成 blocked');
  }
  console.log(`\n✅ 已在${environmentName(remote)}禁用授权码${device ? '并封禁绑定设备' : ''}。\n`);
  if (device) {
    console.log('注意：已经落盘的永久离线许可证无法远程撤回；封禁会阻止后续服务端状态、激活和恢复路径。\n');
  }
}

function blockDevice({ remote, dryRun }) {
  const deviceHash = requireValue('device-hash');
  const device = query(
    `SELECT device_hash, license_status FROM license_devices WHERE device_hash = '${sqlEscape(deviceHash)}'`,
    { remote }
  )[0];
  if (!device) fail('找不到对应设备');

  if (dryRun) {
    console.log(`\n[--dry-run] 将在${environmentName(remote)}封禁设备 ${deviceHash.slice(0, 8)}，未写入数据库。\n`);
    return;
  }
  executeBatch(
    `UPDATE license_devices SET license_status = 'blocked', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE device_hash = '${sqlEscape(deviceHash)}';`,
    { remote }
  );
  const verified = query(
    `SELECT license_status FROM license_devices WHERE device_hash = '${sqlEscape(deviceHash)}'`,
    { remote }
  )[0];
  if (verified?.license_status !== 'blocked') fail('写入后校验失败：设备没有变成 blocked');
  console.log(`\n✅ 已在${environmentName(remote)}封禁设备 ${deviceHash.slice(0, 8)}。\n`);
}

function unbindDevice({ remote, dryRun }) {
  const deviceHash = requireValue('device-hash');
  const binding = query(
    `SELECT d.device_hash, d.license_status, d.license_key_id,
            lk.status AS key_status, lk.bound_device_hash
     FROM license_devices d
     LEFT JOIN license_keys lk ON lk.id = d.license_key_id
     WHERE d.device_hash = '${sqlEscape(deviceHash)}'`,
    { remote }
  )[0];
  if (!binding) fail('找不到对应设备');
  if (!binding.license_key_id || binding.key_status !== 'used' || binding.bound_device_hash !== deviceHash) {
    fail('只允许解绑绑定关系完整且授权码状态为 used 的设备；当前数据不满足安全解绑条件');
  }
  if (!['licensed', 'blocked'].includes(binding.license_status)) {
    fail(`设备状态为 ${binding.license_status}，不是可解绑的 licensed/blocked`);
  }

  if (dryRun) {
    console.log(`\n[--dry-run] 将在${environmentName(remote)}执行：`);
    console.log(`  授权码 ${binding.license_key_id.slice(0, 8)} 恢复为 unused 并清空绑定`);
    console.log(`  删除设备 ${deviceHash.slice(0, 8)}，使旧设备无法 restore`);
    console.log('未写入数据库。\n');
    return;
  }

  executeBatch(
    `UPDATE license_keys
       SET status = 'unused', activation_count = 0, bound_device_hash = NULL,
           bound_user_id = NULL, activated_at = NULL,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = '${sqlEscape(binding.license_key_id)}'
       AND status = 'used' AND bound_device_hash = '${sqlEscape(deviceHash)}';
     DELETE FROM license_devices
     WHERE device_hash = '${sqlEscape(deviceHash)}' AND license_key_id = '${sqlEscape(binding.license_key_id)}';`,
    { remote }
  );

  const deviceAfter = query(
    `SELECT id FROM license_devices WHERE device_hash = '${sqlEscape(deviceHash)}'`,
    { remote }
  )[0];
  const keyAfter = query(
    `SELECT status, activation_count, bound_device_hash, bound_user_id, activated_at
     FROM license_keys WHERE id = '${sqlEscape(binding.license_key_id)}'`,
    { remote }
  )[0];
  const keyReset = keyAfter?.status === 'unused'
    && Number(keyAfter.activation_count) === 0
    && keyAfter.bound_device_hash == null
    && keyAfter.bound_user_id == null
    && keyAfter.activated_at == null;
  if (deviceAfter || !keyReset) fail('写入后校验失败：设备删除或授权码解绑没有完整生效');
  console.log(`\n✅ 已在${environmentName(remote)}解绑设备；授权码可在新设备重新激活。\n`);
}

function stats({ remote }) {
  const summary = query(
    `SELECT
       (SELECT count(*) FROM users) AS registered_users,
       (SELECT count(*) FROM license_devices) AS total_devices,
       (SELECT count(DISTINCT device_hash) FROM activity_events WHERE event_date = date('now')) AS dau,
       (SELECT count(DISTINCT device_hash) FROM activity_events WHERE event_date >= date('now', '-6 days')) AS active_7d,
       (SELECT count(DISTINCT device_hash) FROM activity_events WHERE event_date >= date('now', '-29 days')) AS mau,
       (SELECT count(*) FROM license_devices WHERE license_status = 'licensed') AS licensed_devices`,
    { remote }
  )[0] || {};
  const statusRows = query(
    `SELECT license_status AS status, count(*) AS devices
     FROM license_devices GROUP BY license_status ORDER BY license_status`,
    { remote }
  );
  const versionRows = query(
    `SELECT COALESCE(NULLIF(app_version, ''), '(unknown)') AS app_version, count(*) AS events
     FROM activity_events
     WHERE event_date >= date('now', '-29 days')
     GROUP BY COALESCE(NULLIF(app_version, ''), '(unknown)')
     ORDER BY events DESC, app_version`,
    { remote }
  );

  console.log(`\n活跃与授权统计（${environmentName(remote)}，UTC 日期）：`);
  console.table([
    { metric: '注册用户数', value: Number(summary.registered_users || 0) },
    { metric: '设备总数', value: Number(summary.total_devices || 0) },
    { metric: 'DAU', value: Number(summary.dau || 0) },
    { metric: '7 日活跃', value: Number(summary.active_7d || 0) },
    { metric: 'MAU', value: Number(summary.mau || 0) },
    { metric: '试用转授权数', value: Number(summary.licensed_devices || 0) },
  ]);
  console.log('设备状态分布：');
  if (statusRows.length) console.table(statusRows);
  else console.log('  无设备记录');
  console.log('近 30 天版本分布：');
  if (versionRows.length) console.table(versionRows);
  else console.log('  无活跃记录');
  console.log('');
}

function printHelp() {
  console.log(`
用法：
  node scripts/license-admin.mjs list-codes [--status=unused|used|revoked|disabled] [--remote]
  node scripts/license-admin.mjs disable-code (--code-hash=<hash>|--code=AICV-...) [--dry-run] [--remote]
  node scripts/license-admin.mjs block-device --device-hash=<hash> [--dry-run] [--remote]
  node scripts/license-admin.mjs unbind-device --device-hash=<hash> [--dry-run] [--remote]
  node scripts/license-admin.mjs stats [--remote]

默认环境：本地 D1。只有显式 --remote 才访问生产。
`);
}

const remote = booleanFlag('remote');
const dryRun = booleanFlag('dry-run');

switch (command) {
  case 'list-codes':
    listCodes({ remote });
    break;
  case 'disable-code':
    disableCode({ remote, dryRun });
    break;
  case 'block-device':
    blockDevice({ remote, dryRun });
    break;
  case 'unbind-device':
    unbindDevice({ remote, dryRun });
    break;
  case 'stats':
    stats({ remote });
    break;
  case 'help':
  case '--help':
  case '-h':
    printHelp();
    break;
  default:
    fail(`未知子命令：${command}。运行 node scripts/license-admin.mjs --help 查看用法`);
}
