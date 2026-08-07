#!/usr/bin/env node
/**
 * 生成一次性授权码（文档 §17）。管理员在本机运行，密码学安全随机生成，
 * 数据库只写入哈希——明文只在本次终端输出里出现一次，脚本本身不落盘明文、
 * 不写日志文件。
 *
 * 用法：
 *   node scripts/generate-license-codes.mjs --count=5 --note="2026-08 批次"
 *   node scripts/generate-license-codes.mjs --remote --count=1
 *
 * 盐来源：优先读 LICENSE_CODE_SALT 环境变量（生产批次必须这样传，因为生产盐
 * 只存在 Worker Secret 里，脚本拿不到）；本地开发批次回退读 cloudflare/.dev.vars。
 */
import { randomInt, createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CLOUDFLARE_DIR = path.join(PROJECT_ROOT, 'cloudflare');

// 去掉容易看混的字符：0/O、1/I/L
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const KNOWN_FEATURES = new Set([
    'director_workflow',
    'advanced_nodes',
    'video_generation',
    'batch_generation',
    'advanced_export'
]);

const args = process.argv.slice(2);

function option(name, fallback) {
    const prefix = `--${name}=`;
    const hit = args.find(arg => arg.startsWith(prefix));
    if (hit) return hit.slice(prefix.length);
    return args.includes(`--${name}`) ? true : fallback;
}

function fail(message) {
    console.error(`\n❌ ${message}\n`);
    process.exit(1);
}

function randomGroup(len = 4) {
    let out = '';
    for (let i = 0; i < len; i++) out += ALPHABET[randomInt(ALPHABET.length)];
    return out;
}

function generateCode() {
    return `AICV-${randomGroup()}-${randomGroup()}-${randomGroup()}`;
}

function normalizeCode(code) {
    return code.trim().toUpperCase();
}

function hashCode(code, salt) {
    return createHash('sha256').update(normalizeCode(code) + salt, 'utf8').digest('hex');
}

function resolveSalt(remote) {
    if (process.env.LICENSE_CODE_SALT) return process.env.LICENSE_CODE_SALT;
    if (remote) {
        // 绝不能在 --remote 模式下静默回退到本地开发盐——那是另一把盐，算出来的
        // 哈希跟生产 Worker 实际持有的 LICENSE_CODE_SALT 对不上，生成的授权码
        // 表面上写库成功，实际永远激活不了（LICENSE_INVALID），且不会有任何报错提示。
        return null;
    }
    const devVarsPath = path.join(CLOUDFLARE_DIR, '.dev.vars');
    if (fs.existsSync(devVarsPath)) {
        const content = fs.readFileSync(devVarsPath, 'utf8');
        const match = content.match(/^LICENSE_CODE_SALT=(.*)$/m);
        if (match) return match[1].trim();
    }
    return null;
}

function sqlEscape(value) {
    return String(value).replace(/'/g, "''");
}

function parseFeatures(raw) {
    if (!raw) return ['director_workflow'];
    const list = String(raw).split(',').map(s => s.trim()).filter(Boolean);
    for (const feature of list) {
        if (!KNOWN_FEATURES.has(feature)) {
            fail(`未知功能键 "${feature}"，允许值：${[...KNOWN_FEATURES].join(', ')}`);
        }
    }
    if (!list.length) fail('--features 不能解析为空列表');
    return list;
}

function main() {
    const count = Number(option('count', '1'));
    if (!Number.isInteger(count) || count < 1 || count > 500) {
        fail('--count 必须是 1~500 之间的整数');
    }
    const remote = Boolean(option('remote', false));
    const note = option('note', '');
    const features = parseFeatures(option('features'));
    const dryRun = Boolean(option('dry-run', false));

    const salt = resolveSalt(remote);
    if (!salt) {
        fail(
            remote
                ? '生产批次（--remote）必须显式传 LICENSE_CODE_SALT 环境变量——绝不会回退读本地 ' +
                  '.dev.vars（那是另一把盐，算出来的哈希在生产环境永远激活不了，且不会报错）。用法：\n' +
                  '  LICENSE_CODE_SALT="$(cat 你保存盐的文件)" node scripts/generate-license-codes.mjs --remote'
                : '找不到 LICENSE_CODE_SALT，确认 cloudflare/.dev.vars 里有这一行。'
        );
    }

    const featuresJson = JSON.stringify(features);
    const plainCodes = [];
    const statements = [];

    for (let i = 0; i < count; i++) {
        const code = generateCode();
        const hash = hashCode(code, salt);
        plainCodes.push(code);
        statements.push(
            `INSERT INTO license_keys (id, code_hash, status, license_type, max_activations, activation_count, features, note, created_at, updated_at) ` +
            `VALUES ('${randomUUID()}', '${hash}', 'unused', 'perpetual', 1, 0, '${sqlEscape(featuresJson)}', ${note ? `'${sqlEscape(note)}'` : 'NULL'}, ` +
            `strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));`
        );
    }

    if (dryRun) {
        console.log(`\n[--dry-run] 生成了 ${count} 个授权码，不会写入数据库：\n`);
        plainCodes.forEach(code => console.log(`  ${code}`));
        console.log('');
        return;
    }

    const tmpFile = path.join(os.tmpdir(), `license-codes-${randomUUID()}.sql`);
    fs.writeFileSync(tmpFile, statements.join('\n'), { mode: 0o600 });

    try {
        execFileSync(
            'npx',
            ['wrangler', 'd1', 'execute', 'ai-canvas-auth', remote ? '--remote' : '--local', '--file', tmpFile],
            { cwd: CLOUDFLARE_DIR, stdio: 'inherit' }
        );
    } finally {
        fs.rmSync(tmpFile, { force: true });
    }

    console.log(`\n✅ 已生成 ${count} 个授权码（写入 ${remote ? '远端' : '本地'} D1，功能：${features.join(', ')}）。`);
    console.log('   以下明文只会显示这一次，请立即交付给用户，不要自己留存：\n');
    plainCodes.forEach(code => console.log(`  ${code}`));
    console.log('');
}

main();
