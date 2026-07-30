import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    BROWSER_HUB_TARGETS,
    compareVersions,
    readBrowserHubLock,
    validateBrowserHubLock
} from '../scripts/browser-hub-lock.mjs';
import { releaseIndexToLock, syncLatestBrowserHub } from '../scripts/sync-browser-hub-lock.mjs';

function releaseIndex(version = '0.1.1', protocolVersion = '1.0.0') {
    const tag = `v${version}`;
    return {
        schemaVersion: 1,
        repository: 'xgq947-ship-it/ai-browser-hub',
        version,
        tag,
        protocolVersion,
        assets: Object.fromEntries(BROWSER_HUB_TARGETS.map(target => [target, {
            name: `AI-Browser-Hub-${tag}-${target}.zip`,
            sha256: 'a'.repeat(64)
        }]))
    };
}

test('Hub lock is the single exact version and checksum source', async () => {
    const lock = await readBrowserHubLock();
    assert.equal(lock.channel, 'stable');
    assert.equal(lock.tag, `v${lock.version}`);
    assert.deepEqual(Object.keys(lock.assets), BROWSER_HUB_TARGETS);
    assert.equal(compareVersions('0.1.1', '0.1.0') > 0, true);
    assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
});

test('release index becomes a lock only when the protocol major remains compatible', async () => {
    const current = await readBrowserHubLock();
    const next = releaseIndexToLock(releaseIndex(), current);
    assert.equal(next.version, '0.1.1');
    assert.throws(
        () => releaseIndexToLock(releaseIndex('2.0.0', '2.0.0'), current),
        /不兼容的协议/
    );
});

test('latest stable release atomically updates the lock and older releases never downgrade it', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'evan-hub-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
    const lockPath = path.join(root, 'browser-hub.lock.json');
    const current = await readBrowserHubLock();
    await writeFile(lockPath, `${JSON.stringify(current, null, 2)}\n`);
    const index = releaseIndex();
    const latest = {
        draft: false,
        prerelease: false,
        tag_name: 'v0.1.1',
        assets: [{
            name: 'AI-Browser-Hub-v0.1.1-release.json',
            browser_download_url: 'https://github.com/xgq947-ship-it/ai-browser-hub/releases/download/v0.1.1/AI-Browser-Hub-v0.1.1-release.json'
        }]
    };
    const fetchImpl = async value => new Response(
        JSON.stringify(String(value).includes('/releases/latest') ? latest : index),
        { status: 200, headers: { 'content-type': 'application/json' } }
    );
    const result = await syncLatestBrowserHub({ fetchImpl, environment: {}, lockPath });
    assert.deepEqual(result, { changed: true, version: '0.1.1' });
    assert.equal(JSON.parse(await readFile(lockPath, 'utf8')).version, '0.1.1');

    const unchanged = await syncLatestBrowserHub({ fetchImpl, environment: {}, lockPath });
    assert.deepEqual(unchanged, { changed: false, version: '0.1.1' });
    assert.deepEqual(
        validateBrowserHubLock(JSON.parse(await readFile(lockPath, 'utf8'))),
        { ...index, channel: 'stable' }
    );
});
