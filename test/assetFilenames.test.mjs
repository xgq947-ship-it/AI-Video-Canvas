import test from 'node:test';
import assert from 'node:assert/strict';
import { createUniqueAssetFilename } from '../server/services/assetFilenames.js';

test('中文素材名保留可读名称并追加唯一后缀', () => {
    assert.equal(
        createUniqueAssetFilename('我的素材', '.png', '6086a469-d66e-437f-bcdf-7201ed3fbfbd'),
        '我的素材_6086a469d66e.png'
    );
});

test('同名素材使用不同 ID 时不会生成相同文件名', () => {
    const first = createUniqueAssetFilename('我的素材', '.png', 'aaaaaaaa-1111');
    const second = createUniqueAssetFilename('我的素材', '.png', 'bbbbbbbb-2222');
    assert.notEqual(first, second);
});
