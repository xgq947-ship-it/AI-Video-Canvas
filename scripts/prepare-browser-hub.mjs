#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HUB_VERSION = '0.1.0';
const platform = process.platform;
const arch = process.env.AI_BROWSER_HUB_RUNTIME_ARCH || process.arch;
const payloadName = `payload-${platform}-${arch}`;
const destination = path.join(ROOT, 'desktop-runtime', 'current', 'browser-hub');

async function validPayload(directory) {
    try {
        const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
        return manifest.version === HUB_VERSION
            && manifest.platform === platform
            && manifest.arch === arch
            && existsSync(path.join(directory, 'server', 'daemon.mjs'))
            && existsSync(path.join(directory, 'runtime', platform === 'win32' ? 'node.exe' : 'node'))
            && existsSync(path.join(directory, 'runtime', 'NODE-LICENSE'));
    } catch {
        return false;
    }
}

async function localPayload() {
    const configured = String(process.env.AI_BROWSER_HUB_SOURCE || '').trim();
    const repository = configured || path.resolve(ROOT, '..', 'AI-Browser-Hub');
    const direct = path.basename(repository) === payloadName
        ? repository
        : path.join(repository, 'dist', payloadName);
    if (await validPayload(direct)) return direct;
    if (!existsSync(path.join(repository, 'package.json'))) return null;
    const prepare = spawnSync(process.execPath, [path.join(repository, 'scripts', 'prepare-node-runtime.mjs')], {
        cwd: repository,
        stdio: 'inherit',
        env: { ...process.env, AI_BROWSER_HUB_RUNTIME_ARCH: arch }
    });
    if (prepare.status !== 0) throw new Error('AI Browser Hub Node 运行时构建失败。');
    execFileSync(process.execPath, [path.join(repository, 'scripts', 'build-payload.mjs')], {
        cwd: repository,
        stdio: 'inherit',
        env: { ...process.env, AI_BROWSER_HUB_RUNTIME_ARCH: arch }
    });
    return await validPayload(direct) ? direct : null;
}

async function downloadPayload() {
    const tag = `v${HUB_VERSION}`;
    const asset = `AI-Browser-Hub-${tag}-${platform}-${arch}.zip`;
    const url = `https://github.com/xgq947-ship-it/ai-browser-hub/releases/download/${tag}/${asset}`;
    const temporary = await mkdtemp(path.join(tmpdir(), 'evan-browser-hub-'));
    const archive = path.join(temporary, asset);
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`AI Browser Hub 下载失败：HTTP ${response.status}`);
    await finished(Readable.fromWeb(response.body).pipe(createWriteStream(archive)));
    const checksumResponse = await fetch(`${url}.sha256`);
    if (!checksumResponse.ok) throw new Error(`AI Browser Hub 校验文件下载失败：HTTP ${checksumResponse.status}`);
    const expected = (await checksumResponse.text()).trim().match(/^[a-fA-F0-9]{64}/)?.[0]?.toLowerCase();
    const actual = createHash('sha256').update(await readFile(archive)).digest('hex');
    if (!expected || actual !== expected) throw new Error('AI Browser Hub 载荷 SHA-256 校验失败。');
    const extracted = path.join(temporary, 'extracted');
    await mkdir(extracted, { recursive: true });
    if (platform === 'win32') {
        execFileSync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            'Expand-Archive -LiteralPath $env:HUB_ARCHIVE -DestinationPath $env:HUB_EXTRACT -Force'
        ], { env: { ...process.env, HUB_ARCHIVE: archive, HUB_EXTRACT: extracted } });
    } else {
        execFileSync('ditto', ['-x', '-k', archive, extracted]);
    }
    const entries = await readdir(extracted);
    const root = entries.length === 1 ? path.join(extracted, entries[0]) : extracted;
    if (!await validPayload(root)) throw new Error('下载的 AI Browser Hub 载荷校验失败。');
    return { root, temporary };
}

let source = await localPayload();
if (!source && await validPayload(destination)) process.exit(0);
let temporary = null;
if (!source) {
    const downloaded = await downloadPayload();
    source = downloaded.root;
    temporary = downloaded.temporary;
}
await rm(destination, { recursive: true, force: true });
await mkdir(path.dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });
if (!await validPayload(destination)) throw new Error('AI Browser Hub 安装载荷准备失败。');
if (temporary) await rm(temporary, { recursive: true, force: true });
console.log(`✅ AI Browser Hub ${HUB_VERSION} 已内置：${destination}`);
