import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BROWSER_HUB_LOCK_PATH = path.join(PROJECT_ROOT, 'browser-hub.lock.json');
export const BROWSER_HUB_TARGETS = ['darwin-arm64', 'darwin-x64', 'win32-x64'];

function semver(value, label) {
    const normalized = String(value || '').trim();
    if (!/^\d+\.\d+\.\d+$/.test(normalized)) throw new Error(`${label} 不是有效的语义版本。`);
    return normalized;
}

export function compareVersions(left, right) {
    const a = semver(left, '版本号').split('.').map(Number);
    const b = semver(right, '版本号').split('.').map(Number);
    for (let index = 0; index < 3; index += 1) {
        if (a[index] !== b[index]) return a[index] - b[index];
    }
    return 0;
}

export function protocolMajor(value) {
    return Number.parseInt(semver(value, 'Hub 协议版本').split('.')[0], 10);
}

export function validateBrowserHubLock(value) {
    if (!value || value.schemaVersion !== 1) throw new Error('browser-hub.lock.json schemaVersion 无效。');
    const repository = String(value.repository || '').trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
        throw new Error('browser-hub.lock.json repository 无效。');
    }
    if (value.channel !== 'stable') throw new Error('browser-hub.lock.json 只允许 stable 通道。');
    const version = semver(value.version, 'Hub 版本');
    const tag = String(value.tag || '').trim();
    if (tag !== `v${version}`) throw new Error('browser-hub.lock.json Tag 与版本不一致。');
    const protocolVersion = semver(value.protocolVersion, 'Hub 协议版本');
    const assets = {};
    for (const target of BROWSER_HUB_TARGETS) {
        const entry = value.assets?.[target];
        const expectedName = `AI-Browser-Hub-${tag}-${target}.zip`;
        const sha256 = String(entry?.sha256 || '').trim().toLowerCase();
        if (entry?.name !== expectedName || !/^[a-f0-9]{64}$/.test(sha256)) {
            throw new Error(`browser-hub.lock.json 缺少有效的 ${target} 载荷。`);
        }
        assets[target] = { name: expectedName, sha256 };
    }
    return { schemaVersion: 1, repository, channel: 'stable', version, tag, protocolVersion, assets };
}

export async function readBrowserHubLock(lockPath = BROWSER_HUB_LOCK_PATH) {
    return validateBrowserHubLock(JSON.parse(await readFile(lockPath, 'utf8')));
}

export function browserHubTarget(platform = process.platform, arch = process.arch) {
    const target = `${platform}-${arch}`;
    if (!BROWSER_HUB_TARGETS.includes(target)) throw new Error(`AI Browser Hub 不支持目标平台：${target}。`);
    return target;
}

export function browserHubAsset(lock, platform = process.platform, arch = process.arch) {
    return validateBrowserHubLock(lock).assets[browserHubTarget(platform, arch)];
}
