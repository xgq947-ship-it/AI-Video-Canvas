import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    BrowserSessionStateStore,
    browserStateForError,
    inferBrowserProvider
} from '../server/services/browserSessionState.js';

test('browser session states persist without storing credentials', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-browser-state-'));
    const filePath = path.join(directory, 'sessions.json');
    const store = new BrowserSessionStateStore({
        filePath,
        now: () => '2026-07-24T12:00:00.000Z'
    });

    assert.equal(store.get('google-flow').state, 'unknown');
    store.transition('google-flow', 'expired', {
        errorCode: 'AUTH_REQUIRED',
        message: '请重新登录'
    });

    const restored = new BrowserSessionStateStore({ filePath });
    assert.deepEqual(restored.get('google-flow'), {
        provider: 'google-flow',
        state: 'expired',
        updatedAt: '2026-07-24T12:00:00.000Z',
        errorCode: 'AUTH_REQUIRED',
        message: '请重新登录'
    });
    assert.equal(JSON.stringify(restored.list()).includes('cookie'), false);
});

test('应用重启后不沿用历史 authenticated，必须重新做真实页面探针', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-browser-state-stale-'));
    const filePath = path.join(directory, 'sessions.json');
    const store = new BrowserSessionStateStore({ filePath });
    store.transition('google-flow', 'authenticated', { message: '上一次验证成功' });

    const restored = new BrowserSessionStateStore({ filePath });
    assert.equal(restored.get('google-flow').state, 'unknown');
    assert.match(restored.get('google-flow').message, /本次启动重新验证/);
});

test('browser provider is inferred from ops cli arguments', () => {
    assert.equal(inferBrowserProvider(['image-to-video', 'jimeng', 'generate']), 'jimeng');
    assert.equal(inferBrowserProvider(['text-to-image', 'google-flow', 'generate']), 'google-flow');
    assert.equal(inferBrowserProvider(['unrelated']), null);
});

test('only explicit auth and browser errors change availability state', () => {
    assert.equal(browserStateForError({ code: 'AUTH_REQUIRED' }), 'expired');
    assert.equal(browserStateForError({ code: 'SCENE_CAPTURE_FAILED' }), 'expired');
    assert.equal(browserStateForError({ code: 'SUBMISSION_UNKNOWN' }), 'submission_unknown');
    assert.equal(browserStateForError({ code: 'BROWSER_CLOSED' }), 'browser_unavailable');
    assert.equal(browserStateForError({ code: 'PAGE_NAVIGATION_FAILED' }), null);
});
