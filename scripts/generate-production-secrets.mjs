#!/usr/bin/env node
/**
 * 一次性生成全部生产密钥，直接写入 cloudflare/.prod-secrets/（已 gitignore），
 * 不打印任何密钥内容到终端——本脚本运行时的输出只有文件路径列表。
 *
 * 背景：这套仓库在开发阶段用 AI 助手生成过一版密钥用于本地联调，那一版的
 * 明文在助手的会话记录里出现过，绝不能带去生产。这个脚本生成的是全新一套，
 * 助手本身也不会读取这些文件的内容（只有管理员自己会看到）。
 *
 * 用法：
 *   node scripts/generate-production-secrets.mjs
 *
 * 生成后：
 *   1. 对着 cloudflare/.prod-secrets/ 下的文件逐个跑 wrangler secret put（见脚本输出的命令）
 *   2. 确认 7 个 secret 都设置成功后，删除整个 .prod-secrets/ 目录
 *   3. GOOGLE_CLIENT_SECRET 不在这里生成——去 Google Cloud Console 轮换，
 *      拿到新值后自己直接跑 `wrangler secret put GOOGLE_CLIENT_SECRET`，
 *      不要把这个值粘贴给任何人/任何工具，包括粘贴进聊天记录。
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'cloudflare', '.prod-secrets');

fs.mkdirSync(OUT_DIR, { recursive: true });

function writeSecretFile(name, value) {
    const filePath = path.join(OUT_DIR, `${name}.txt`);
    fs.writeFileSync(filePath, value, { mode: 0o600 });
    return filePath;
}

// ---- 三个随机字符串密钥 ----
const sessionSigningSecret = randomBytes(32).toString('base64url');
const licenseCodeSalt = randomBytes(32).toString('base64url');
const adminSecret = randomBytes(32).toString('base64url');

// ---- Ed25519 密钥对（用于签发/验证永久许可证）----
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const privatePemB64 = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
const publicPemB64 = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64');
const publicSpkiDer = publicKey.export({ type: 'spki', format: 'der' });
const publicSpkiB64url = Buffer.from(publicSpkiDer).toString('base64url');

const files = {
    SESSION_SIGNING_SECRET: writeSecretFile('SESSION_SIGNING_SECRET', sessionSigningSecret),
    LICENSE_CODE_SALT: writeSecretFile('LICENSE_CODE_SALT', licenseCodeSalt),
    ADMIN_SECRET: writeSecretFile('ADMIN_SECRET', adminSecret),
    LICENSE_PRIVATE_KEY_PEM_B64: writeSecretFile('LICENSE_PRIVATE_KEY_PEM_B64', privatePemB64),
    LICENSE_PUBLIC_KEY_PEM_B64: writeSecretFile('LICENSE_PUBLIC_KEY_PEM_B64', publicPemB64),
};

// 公钥不是秘密，客户端本来就要内置它——单独存一份方便直接读取更新 authConfig.js。
const publicKeyInfoPath = writeSecretFile('LICENSE_PUBLIC_KEY_SPKI_B64URL', publicSpkiB64url);

console.log('\n✅ 已生成全部密钥，写入以下文件（内容未打印，只有你自己能看到）：\n');
for (const [name, filePath] of Object.entries(files)) {
    console.log(`  ${name.padEnd(28)} -> ${path.relative(PROJECT_ROOT, filePath)}`);
}
console.log(`  ${'LICENSE_PUBLIC_KEY_SPKI_B64URL'.padEnd(28)} -> ${path.relative(PROJECT_ROOT, publicKeyInfoPath)}  （公钥，非秘密，客户端要内置）`);

console.log('\n接下来在 cloudflare/ 目录下依次执行（wrangler 会提示你确认，逐个跑）：\n');
for (const name of Object.keys(files)) {
    console.log(`  wrangler secret put ${name} < .prod-secrets/${name}.txt`);
}
console.log('\n还差一个 GOOGLE_CLIENT_SECRET：');
console.log('  1. 去 Google Cloud Console 给这个 OAuth Client 轮换一个新的 Client Secret');
console.log('  2. 直接跑 `wrangler secret put GOOGLE_CLIENT_SECRET`，在提示符里手动粘贴新值');
console.log('     （不要把这个值粘贴到聊天、文件或任何脚本里）\n');
console.log('全部 7 个 secret 设置成功后，删除整个目录：rm -rf cloudflare/.prod-secrets\n');
