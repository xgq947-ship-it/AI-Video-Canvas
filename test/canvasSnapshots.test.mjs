import test from 'node:test';
import assert from 'node:assert/strict';

import { dataUrlToBlob, snapshotImageSource } from '../shared/canvasSnapshots.js';

test('dataUrlToBlob preserves bytes and media type without base64 overhead', async () => {
    const dataUrl = 'data:image/png;base64,' + Buffer.from([0, 1, 2, 250, 255]).toString('base64');
    const blob = dataUrlToBlob(dataUrl);

    assert.equal(blob.type, 'image/png');
    assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [0, 1, 2, 250, 255]);
    assert.ok(blob.size < dataUrl.length);
});

test('snapshotImageSource leaves legacy string snapshots unchanged', () => {
    const dataUrl = 'data:image/png;base64,AA==';
    const source = snapshotImageSource(dataUrl);

    assert.equal(source.src, dataUrl);
    assert.doesNotThrow(source.release);
});

test('snapshotImageSource creates and revokes object URLs for blobs', () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const revoked = [];

    URL.createObjectURL = () => 'blob:test-snapshot';
    URL.revokeObjectURL = value => revoked.push(value);

    try {
        const source = snapshotImageSource(new Blob(['snapshot'], { type: 'image/png' }));
        assert.equal(source.src, 'blob:test-snapshot');
        source.release();
        assert.deepEqual(revoked, ['blob:test-snapshot']);
    } finally {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
    }
});
