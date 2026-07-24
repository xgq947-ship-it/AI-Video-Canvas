import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchWorkflowMedia } from '../server/utils/workflowMedia.js';

function fakeResponse({ status = 200, contentType = 'image/png', body = 'media' } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get(name) {
                return name.toLowerCase() === 'content-type' ? contentType : null;
            }
        },
        async arrayBuffer() {
            return Buffer.from(body);
        }
    };
}

test('已生成的远程图片只有在内容类型正确且非空时才接收入库', async () => {
    const result = await fetchWorkflowMedia('https://example.test/result', {
        providerName: '即梦',
        expectedType: 'image',
        recoveryHint: '请检查历史记录。',
        fetchImpl: async () => fakeResponse({ contentType: 'image/webp', body: 'image' })
    });

    assert.deepEqual(result.buffer, Buffer.from('image'));
    assert.equal(result.contentType, 'image/webp');
});

test('签名地址返回登录 HTML 时不再把网页保存成损坏的媒体文件', async () => {
    await assert.rejects(
        () => fetchWorkflowMedia('https://example.test/result', {
            providerName: 'Google Flow',
            expectedType: 'video',
            recoveryHint: '请到 Flow 历史记录下载，不要直接重新生成。',
            fetchImpl: async () => fakeResponse({
                contentType: 'text/html; charset=utf-8',
                body: '<html>login</html>'
            })
        }),
        /不是有效的视频.*历史记录.*不要直接重新生成/
    );
});

test('结果下载网络失败会明确提示生成已完成并避免重复生成', async () => {
    await assert.rejects(
        () => fetchWorkflowMedia('https://example.test/result', {
            providerName: '即梦',
            expectedType: 'image',
            recoveryHint: '请到即梦历史会话下载，不要直接重新生成。',
            fetchImpl: async () => {
                throw new Error('socket closed');
            }
        }),
        /已生成结果.*socket closed.*不要直接重新生成/
    );
});

test('收到响应头后传输中断也保留历史记录恢复提示', async () => {
    const response = fakeResponse({ contentType: 'image/png' });
    response.arrayBuffer = async () => {
        throw new Error('body terminated');
    };
    await assert.rejects(
        () => fetchWorkflowMedia('https://example.test/result', {
            providerName: 'Google Flow',
            expectedType: 'image',
            recoveryHint: '请到 Flow 历史记录下载，不要直接重新生成。',
            fetchImpl: async () => response
        }),
        /传输中断开.*body terminated.*不要直接重新生成/
    );
});
