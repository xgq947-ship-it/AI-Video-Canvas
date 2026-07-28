/**
 * Generation provider registry.
 *
 * This registry is intentionally about orchestration policy, not wire
 * protocol/model ids.  Protocol ids remain in services/webhttp/registry.js so
 * adding scheduling/health metadata cannot accidentally alter a verified HTTP
 * request.
 */

const DEFAULT_WEB_PROVIDERS = Object.freeze([
    {
        id: 'google-flow',
        label: 'Google Flow',
        transport: 'web-http',
        requiresBrowserSession: true,
        submitConcurrency: 1,
        pollConcurrency: 4,
        downloadConcurrency: 2
    },
    {
        id: 'gemini-web',
        label: 'Gemini Web',
        transport: 'web-http',
        requiresBrowserSession: true,
        submitConcurrency: 1,
        pollConcurrency: 4,
        downloadConcurrency: 2
    },
    {
        id: 'jimeng',
        label: '即梦',
        transport: 'web-http',
        requiresBrowserSession: true,
        submitConcurrency: 1,
        pollConcurrency: 4,
        downloadConcurrency: 2
    }
]);

function normalizeDefinition(input) {
    const id = String(input?.id || '').trim();
    if (!id) throw new Error('Generation provider id is required');
    const positiveInteger = (value, fallback) => {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
    };
    return Object.freeze({
        id,
        label: String(input?.label || id),
        transport: String(input?.transport || 'unknown'),
        requiresBrowserSession: Boolean(input?.requiresBrowserSession),
        submitConcurrency: positiveInteger(input?.submitConcurrency, 1),
        pollConcurrency: positiveInteger(input?.pollConcurrency, 2),
        downloadConcurrency: positiveInteger(input?.downloadConcurrency, 2)
    });
}

export class GenerationProviderRegistry {
    constructor(definitions = []) {
        this.providers = new Map();
        for (const definition of definitions) this.register(definition);
    }

    register(definition) {
        const normalized = normalizeDefinition(definition);
        if (this.providers.has(normalized.id)) {
            throw new Error(`Generation provider already registered: ${normalized.id}`);
        }
        this.providers.set(normalized.id, normalized);
        return normalized;
    }

    require(provider) {
        const definition = this.providers.get(String(provider || ''));
        if (!definition) throw new Error(`Unknown generation provider: ${provider}`);
        return definition;
    }

    get(provider) {
        return this.providers.get(String(provider || '')) || null;
    }

    list() {
        return [...this.providers.values()];
    }
}

export const generationProviderRegistry = new GenerationProviderRegistry(DEFAULT_WEB_PROVIDERS);

/** Canvas model id -> orchestration provider id. */
export function providerForWebModel(modelId) {
    const id = String(modelId || '');
    if (id.startsWith('google-flow-')) return 'google-flow';
    if (id.startsWith('gemini-web-')) return 'gemini-web';
    if (id.startsWith('jimeng-')) return 'jimeng';
    return null;
}
