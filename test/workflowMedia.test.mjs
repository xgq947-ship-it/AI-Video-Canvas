import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchWorkflowMedia } from '../server/utils/workflowMedia.js';
import { downloadResultMedia } from '../server/services/webhttp/media.js';

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

// --- 结果下载重试（借鉴 gflow-cli：幂等 GET 的偶发失败可安全重试）---------------

test('结果下载偶发网络失败会自动重试后成功，不必去历史记录手动下载', async () => {
    let calls = 0;
    const result = await downloadResultMedia('https://example.test/v', {
        providerName: 'Google Flow',
        expectedType: 'image',
        backoffScheduleMs: [0, 0],
        fetchImpl: async () => {
            calls += 1;
            if (calls < 3) throw new Error('ECONNRESET');
            return fakeResponse({ contentType: 'image/png', body: 'ok' });
        }
    });
    assert.equal(calls, 3, '前两次抖动失败后第三次成功');
    assert.deepEqual(result.buffer, Buffer.from('ok'));
    assert.equal(result.source, 'http');
});

test('服务端 5xx 会重试，4xx 直接失败（确定性失败不空转）', async () => {
    let fiveHundredCalls = 0;
    await assert.rejects(() => downloadResultMedia('https://example.test/v', {
        providerName: '即梦',
        expectedType: 'image',
        backoffScheduleMs: [0, 0],
        fetchImpl: async () => { fiveHundredCalls += 1; return fakeResponse({ status: 503 }); }
    }));
    assert.equal(fiveHundredCalls, 3, '503 属可重试，跑满 3 次');

    let fourOhFourCalls = 0;
    await assert.rejects(() => downloadResultMedia('https://example.test/v', {
        providerName: '即梦',
        expectedType: 'image',
        backoffScheduleMs: [0, 0],
        fetchImpl: async () => { fourOhFourCalls += 1; return fakeResponse({ status: 404 }); }
    }));
    assert.equal(fourOhFourCalls, 1, '404 是确定性失败，不重试');
});

test('登录 HTML 回退属确定性失败，一次即止不空转重试', async () => {
    let calls = 0;
    await assert.rejects(() => downloadResultMedia('https://example.test/v', {
        providerName: 'Google Flow',
        expectedType: 'video',
        backoffScheduleMs: [0, 0],
        fetchImpl: async () => {
            calls += 1;
            return fakeResponse({ contentType: 'text/html; charset=utf-8', body: '<html>login</html>' });
        }
    }), /不是有效的视频/);
    assert.equal(calls, 1);
});

test('重试到上限仍失败则透出最后一次错误与找回提示', async () => {
    let calls = 0;
    await assert.rejects(() => downloadResultMedia('https://example.test/v', {
        providerName: '即梦',
        expectedType: 'image',
        backoffScheduleMs: [0, 0],
        fetchImpl: async () => { calls += 1; throw new Error('socket hang up'); }
    }), /已生成结果.*socket hang up/);
    assert.equal(calls, 3);
});

test('已取消的下载不重试、也不伪装成可重试失败', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await assert.rejects(() => downloadResultMedia('https://example.test/v', {
        providerName: 'Google Flow',
        expectedType: 'image',
        signal: controller.signal,
        backoffScheduleMs: [0, 0],
        fetchImpl: async () => { calls += 1; return fakeResponse(); }
    }), /已取消/);
    assert.equal(calls, 0, '已取消则一次网络都不发');
});
