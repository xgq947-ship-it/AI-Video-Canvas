import assert from 'node:assert/strict';
import test from 'node:test';
import { startBackend } from '../server/index.js';

test('backend can bind an OS-assigned loopback port and shut down cleanly', async () => {
    const ready = new Promise((resolve, reject) => {
        const server = startBackend({
            host: '127.0.0.1',
            port: 0,
            onReady: resolve
        });
        server.on('error', reject);
    });

    const { host, port, server } = await ready;
    assert.equal(host, '127.0.0.1');
    assert.ok(Number.isInteger(port) && port > 0);

    const response = await fetch(`http://${host}:${port}/api/capabilities`);
    assert.equal(response.status, 200);
    const capabilities = await response.json();
    assert.ok(capabilities.browserModels.sessions['google-flow']);

    await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
});
