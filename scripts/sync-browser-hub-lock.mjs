#!/usr/bin/env node
import { appendFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BROWSER_HUB_LOCK_PATH,
    compareVersions,
    protocolMajor,
    readBrowserHubLock,
    validateBrowserHubLock
} from './browser-hub-lock.mjs';

function githubHeaders(environment = process.env) {
    const headers = {
        accept: 'application/vnd.github+json',
        'user-agent': 'evan-browser-hub-sync'
    };
    const token = String(environment.GITHUB_TOKEN || '').trim();
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
}

async function responseJson(response, label) {
    if (!response.ok) throw new Error(`${label}失败：HTTP ${response.status}`);
    const value = await response.json();
    if (!value || typeof value !== 'object') throw new Error(`${label}没有返回有效 JSON。`);
    return value;
}

export function releaseIndexToLock(index, current) {
    if (!index || index.schemaVersion !== 1) throw new Error('Hub Release 清单 schemaVersion 无效。');
    if (index.repository !== current.repository) throw new Error('Hub Release 清单仓库不匹配。');
    const candidate = validateBrowserHubLock({ ...index, channel: 'stable' });
    if (protocolMajor(candidate.protocolVersion) !== protocolMajor(current.protocolVersion)) {
        throw new Error(`Hub ${candidate.version} 使用不兼容的协议 ${candidate.protocolVersion}，已停止自动升级。`);
    }
    return candidate;
}

async function writeOutputs(result, environment = process.env) {
    const output = String(environment.GITHUB_OUTPUT || '').trim();
    if (!output) return;
    await appendFile(output, `changed=${result.changed}\nversion=${result.version}\n`);
}

export async function syncLatestBrowserHub({
    fetchImpl = fetch,
    environment = process.env,
    lockPath = BROWSER_HUB_LOCK_PATH
} = {}) {
    const current = await readBrowserHubLock(lockPath);
    const release = await responseJson(
        await fetchImpl(`https://api.github.com/repos/${current.repository}/releases/latest`, {
            headers: githubHeaders(environment),
            signal: AbortSignal.timeout(20_000)
        }),
        '读取 Hub 最新稳定版'
    );
    if (release.draft || release.prerelease) throw new Error('GitHub latest 返回了非稳定 Hub Release。');
    const tag = String(release.tag_name || '').trim();
    const version = tag.match(/^v(\d+\.\d+\.\d+)$/)?.[1];
    if (!version) throw new Error('Hub 最新 Release Tag 格式无效。');
    if (compareVersions(version, current.version) <= 0) {
        const result = { changed: false, version: current.version };
        await writeOutputs(result, environment);
        return result;
    }

    const indexName = `AI-Browser-Hub-${tag}-release.json`;
    const indexAsset = Array.isArray(release.assets)
        ? release.assets.find(asset => asset?.name === indexName)
        : null;
    if (!indexAsset?.browser_download_url) throw new Error(`Hub ${tag} 缺少机器可读发布清单。`);
    const downloadUrl = new URL(indexAsset.browser_download_url);
    if (downloadUrl.protocol !== 'https:' || downloadUrl.hostname !== 'github.com') {
        throw new Error('Hub Release 清单下载地址不可信。');
    }
    const index = await responseJson(
        await fetchImpl(downloadUrl, { signal: AbortSignal.timeout(20_000) }),
        '下载 Hub Release 清单'
    );
    const next = releaseIndexToLock(index, current);
    if (next.version !== version || next.tag !== tag) throw new Error('Hub Release 清单与 latest Tag 不一致。');

    const temporary = `${lockPath}.${process.pid}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`);
        await rename(temporary, lockPath);
    } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
    }
    const result = { changed: true, version: next.version };
    await writeOutputs(result, environment);
    return result;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
    const result = await syncLatestBrowserHub();
    process.stdout.write(result.changed
        ? `AI Browser Hub 已同步到 ${result.version}。\n`
        : `AI Browser Hub 已是最新稳定版 ${result.version}。\n`);
}
