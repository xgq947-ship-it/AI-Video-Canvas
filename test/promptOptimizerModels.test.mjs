import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DEEPSEEK_MODELS_URL,
    getPromptOptimizerModelCatalog,
    invalidatePromptOptimizerModelCatalogCache
} from '../server/services/promptOptimizerModels.js';

test('DeepSeek 模型目录使用官方 /models 接口并只返回模型信息', async t => {
    const originalFetch = globalThis.fetch;
    let request;
    t.after(() => {
        globalThis.fetch = originalFetch;
        invalidatePromptOptimizerModelCatalogCache();
    });

    globalThis.fetch = async (url, options) => {
        request = { url, options };
        return new Response(JSON.stringify({
            object: 'list',
            data: [
                { id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' },
                { id: 'deepseek-v4-pro', object: 'model', owned_by: 'deepseek' },
                { id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' }
            ]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const catalog = await getPromptOptimizerModelCatalog({
        refresh: true,
        apiKeys: { deepseek: 'secret-deepseek-key' }
    });
    const deepseek = catalog.providers.deepseek;

    assert.equal(request.url, DEEPSEEK_MODELS_URL);
    assert.equal(request.options.headers.Authorization, 'Bearer secret-deepseek-key');
    assert.equal(deepseek.discovered, true);
    assert.deepEqual(deepseek.models.map(model => model.id), [
        'deepseek-v4-flash',
        'deepseek-v4-pro'
    ]);
    assert.equal(JSON.stringify(catalog).includes('secret-deepseek-key'), false);
});

test('未配置 DeepSeek 密钥时使用安全的内置目录，不发起外部请求', async t => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    t.after(() => {
        globalThis.fetch = originalFetch;
        invalidatePromptOptimizerModelCatalogCache();
    });

    globalThis.fetch = async () => {
        calls += 1;
        throw new Error('不应发起请求');
    };

    const catalog = await getPromptOptimizerModelCatalog({ refresh: true, apiKeys: {} });

    assert.equal(calls, 0);
    assert.equal(catalog.providers.deepseek.discovered, false);
    assert.deepEqual(
        catalog.providers.deepseek.models.map(model => model.id),
        ['deepseek-v4-flash', 'deepseek-v4-pro']
    );
});

test('模型同步失败时保留内置目录，并明确 CLI/Gemini 的能力边界', async t => {
    const originalFetch = globalThis.fetch;
    t.after(() => {
        globalThis.fetch = originalFetch;
        invalidatePromptOptimizerModelCatalogCache();
    });

    globalThis.fetch = async () => new Response('{}', { status: 401 });
    const catalog = await getPromptOptimizerModelCatalog({
        refresh: true,
        apiKeys: { deepseek: 'expired-key' }
    });

    assert.equal(catalog.providers.deepseek.discovered, false);
    assert.match(catalog.providers.deepseek.message, /内置列表/);
    assert.equal(catalog.providers['claude-cli'].syncSupported, false);
    assert.ok(catalog.providers['claude-cli'].models.some(model => model.id === 'sonnet'));
    assert.equal(catalog.providers['codex-cli'].syncSupported, false);
    assert.equal(catalog.providers['gemini-web'].models[0].id, 'Gemini Web');
});
