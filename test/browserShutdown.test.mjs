import assert from 'node:assert/strict';
import test from 'node:test';

import { closeBrowserForShutdown } from '../server/services/opsCliRunner.js';

test('退出 AI 画布不会关闭系统共享 Chrome', async () => {
    const result = await closeBrowserForShutdown();
    assert.deepEqual(result, { closed: false, reason: 'shared-hub-managed' });
});

test('退出路径不再启动 browser close 子进程', async () => {
    let called = false;
    const result = await closeBrowserForShutdown({
        spawnProcess: () => { called = true; }
    });
    assert.equal(called, false);
    assert.equal(result.reason, 'shared-hub-managed');
});
