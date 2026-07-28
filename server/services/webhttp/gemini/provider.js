/**
 * Gemini Web HTTP provider.
 *
 * Replaces "find the input box → click → wait for DOM → click download" with
 * bootstrap → StreamGenerate → parse → HTTP download. The browser keeps only
 * the login, the bootstrap read and the `auto`-mode fallback.
 */

import { webContext, webFetch, webFetchOk, cookieHeaderFor, buildRequestSpec } from '../bridge.js';
import { WebProviderError, classifyHttpFailure } from '../errors.js';
import { downloadResultMedia, loadReferenceImageFiles, requireNonEmptyPrompt } from '../media.js';
import {
    GEMINI_MODE,
    GEMINI_PROTOCOL_VERSION,
    applyAspectRatio,
    buildStreamBody,
    buildStreamPayload,
    buildStreamUrl,
    buildUploadFinalizeRequest,
    buildUploadStartRequest,
    extractConversation,
    extractGeneratedMedia,
    extractGeminiBootstrap,
    extractStreamPayloads,
    extractText,
    detectRefusal,
    isGenerationPending,
    nextRequestId,
    parseUploadedResourcePath,
    resolveUploadUrl
} from './protocol.js';

const PROVIDER = 'gemini-web';
const PROVIDER_NAME = 'Gemini Web';

/**
 * Session cache. `at` and `f.sid` rotate, so the TTL is short and every
 * generation refreshes rather than trusting a warm value.
 */
let cachedSession = null;
let cachedSessionAt = 0;
let requestIdSeed = null;
const SESSION_TTL_MS = 3 * 60_000;

export function clearGeminiSessionCache() {
    cachedSession = null;
    cachedSessionAt = 0;
}

export async function getGeminiSession({ signal, forceRefresh = false } = {}) {
    if (!forceRefresh && cachedSession && Date.now() - cachedSessionAt < SESSION_TTL_MS) {
        return cachedSession;
    }
    const context = await webContext(PROVIDER, { signal });
    if (context?.signedIn === false) {
        throw new WebProviderError(
            `${PROVIDER_NAME} 登录已失效，请在 Evan 专属 Chrome 中重新登录 Google 账号`,
            { provider: PROVIDER, code: 'AUTH_EXPIRED', submitted: false }
        );
    }
    if (!context?.at || !context?.bl || !context?.fSid) {
        throw new WebProviderError(
            `${PROVIDER_NAME} 未能读取会话引导参数（at / bl / f.sid），通常表示登录失效或页面结构变化`,
            { provider: PROVIDER, code: 'AUTH_EXPIRED', submitted: false }
        );
    }
    cachedSession = {
        at: context.at,
        bl: context.bl,
        fSid: context.fSid,
        feedIds: Array.isArray(context.feedIds) ? context.feedIds : [],
        cookieHeader: cookieHeaderFor(context, ['google.com', 'googleusercontent.com']),
        protocolVersion: GEMINI_PROTOCOL_VERSION
    };
    cachedSessionAt = Date.now();
    return cachedSession;
}

/** Re-parse the bootstrap out of raw HTML. Used when the page-side read failed. */
export function readBootstrapFromHtml(html) {
    return extractGeminiBootstrap(html);
}


/**
 * Upload one image through the resumable endpoint.
 *
 * Both steps happen before anything is submitted for generation, so every
 * failure here is safely retryable / fallback-able.
 */
/** One start+finalize round trip against a specific Scotty feed. */
async function tryUpload(file, feedId, { signal }) {
    const start = await webFetch(PROVIDER, buildRequestSpec(buildUploadStartRequest({
        fileName: file.fileName,
        byteLength: file.buffer.length,
        feedId
    })), { signal });
    if (!start.ok) return { ok: false, reason: `初始化 HTTP ${start.status}` };

    const uploadUrl = resolveUploadUrl(start.headers);
    if (!uploadUrl) return { ok: false, reason: '未返回续传地址' };

    const finalize = await webFetch(PROVIDER, buildRequestSpec(buildUploadFinalizeRequest({
        uploadUrl,
        buffer: file.buffer
    })), { signal, timeoutSeconds: 180 });
    if (!finalize.ok) return { ok: false, reason: `上传 HTTP ${finalize.status}` };

    const resourcePath = parseUploadedResourcePath(finalize.text);
    if (!resourcePath) return { ok: false, reason: '未返回资源路径' };
    return { ok: true, resourcePath };
}

async function uploadImage(file, { session, signal }) {
    // 页面里通常有多个 feed id。实测它们的 start 全都返回 200，但只有一个能在
    // finalize 时给出 /contrib_service 资源路径 —— 所以判定成功的标准必须是**整个
    // 握手**，不能只看初始化。哪个能用由运行时试出来，不写死；试出来的那个缓存到
    // session，同一批后续图片直接命中。
    const candidates = session.feedIds?.length > 0 ? session.feedIds : [''];
    const ordered = session.uploadFeedId
        ? [session.uploadFeedId, ...candidates.filter(id => id !== session.uploadFeedId)]
        : candidates;

    const failures = [];
    for (const feedId of ordered) {
        const result = await tryUpload(file, feedId, { signal });
        if (result.ok) {
            session.uploadFeedId = feedId;
            return { resourcePath: result.resourcePath, fileName: file.fileName, mimeType: file.mimeType };
        }
        failures.push(result.reason);
    }

    throw new WebProviderError(
        `${PROVIDER_NAME} 图片上传失败（${failures.join('；') || '没有可用的上传通道'}），协议可能已变化`,
        { provider: PROVIDER, code: 'UPLOAD_FAILED', submitted: false }
    );
}

export async function uploadGeminiImages(inputs, libraryDir, { session, signal } = {}) {
    const files = await loadReferenceImageFiles(inputs, libraryDir, { providerName: PROVIDER_NAME });
    if (files.length === 0) return [];
    const activeSession = session || await getGeminiSession({ signal });
    const assets = [];
    for (const file of files) assets.push(await uploadImage(file, { session: activeSession, signal }));
    return assets;
}

/**
 * One StreamGenerate round trip.
 *
 * `submitted` is the caller's call: a text question costs nothing, an image or
 * video generation spends quota the moment the request lands.
 */
async function streamGenerate({ session, prompt, assets, conversation, mode, submitted, signal, timeoutSeconds }) {
    requestIdSeed = nextRequestId(requestIdSeed);
    const payload = buildStreamPayload({ prompt, assets, conversation, mode });
    const spec = buildRequestSpec({
        url: buildStreamUrl({ bl: session.bl, fSid: session.fSid, reqId: requestIdSeed }),
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: buildStreamBody({ payload, at: session.at }),
        timeoutSeconds
    });

    // submitted 透传：生图/生视频请求的传输层失败结果未知，必须按已提交处理。
    const response = await webFetch(PROVIDER, spec, { signal, timeoutSeconds, submitted });
    if (!response.ok) {
        // A 401/403 here means the bootstrap went stale between read and use.
        clearGeminiSessionCache();
        throw new WebProviderError(
            `${PROVIDER_NAME} 请求失败：HTTP ${response.status}`,
            { provider: PROVIDER, code: classifyHttpFailure(response.status, response.text), submitted }
        );
    }

    const payloads = extractStreamPayloads(response.text);
    if (payloads.length === 0) {
        throw new WebProviderError(
            `${PROVIDER_NAME} 返回的响应无法解析（协议可能已变化）`,
            { provider: PROVIDER, code: 'PROTOCOL_CHANGED', submitted }
        );
    }
    return payloads;
}

/**
 * Text / prompt optimization / image recognition.
 *
 * The doc recommends one conversation per business task; `conversation` is only
 * passed when the caller genuinely wants continuity.
 */
export async function runGeminiTextTaskHttp({
    prompt,
    referenceImageInputs = [],
    conversation,
    libraryDir,
    signal
}) {
    const cleanPrompt = requireNonEmptyPrompt(prompt, PROVIDER_NAME);
    const session = await getGeminiSession({ signal });
    const assets = referenceImageInputs.length
        ? await uploadGeminiImages(referenceImageInputs, libraryDir, { session, signal })
        : [];

    const payloads = await streamGenerate({
        session,
        prompt: cleanPrompt,
        assets,
        conversation,
        mode: null,
        submitted: false,
        signal,
        timeoutSeconds: 180
    });

    const text = extractText(payloads);
    if (!text) {
        throw new WebProviderError(`${PROVIDER_NAME} 没有返回文本回答`, {
            provider: PROVIDER, code: 'GENERATION_FAILED', submitted: false
        });
    }
    return { text, conversation: extractConversation(payloads), channel: 'http' };
}

async function downloadGeminiMedia(items, { session, expectedType }) {
    const results = [];
    for (const item of items) {
        const downloaded = await downloadResultMedia(item.url, {
            providerName: PROVIDER_NAME,
            expectedType,
            cookieHeader: session.cookieHeader,
            recoveryHint: '请先到 Gemini 会话中下载本次结果，不要直接重新生成。'
        });
        results.push({ ...downloaded, metadata: item });
    }
    return results;
}

export async function generateGeminiImageHttp({
    prompt,
    aspectRatio = '1:1',
    referenceImageInputs = [],
    libraryDir,
    timeoutMinutes = 10,
    signal
}) {
    const cleanPrompt = requireNonEmptyPrompt(prompt, `${PROVIDER_NAME} 图片`);
    const session = await getGeminiSession({ signal, forceRefresh: true });
    const assets = referenceImageInputs.length
        ? await uploadGeminiImages(referenceImageInputs, libraryDir, { session, signal })
        : [];

    const payloads = await streamGenerate({
        session,
        prompt: applyAspectRatio(cleanPrompt, aspectRatio, 'image'),
        assets,
        conversation: {},
        mode: GEMINI_MODE.image,
        submitted: true,
        signal,
        timeoutSeconds: Math.max(120, timeoutMinutes * 60)
    });

    const { images } = extractGeneratedMedia(payloads);
    if (images.length === 0) {
        // Gemini 用自然语言拒绝（额度耗尽 / 内容策略），HTTP 依然是 200。
        // 不识别的话会报成「协议可能已变化」，把用户引去查一个其实正常的协议。
        const refusal = detectRefusal(payloads);
        if (refusal) {
            throw new WebProviderError(`${PROVIDER_NAME}：${refusal.message}`, {
                provider: PROVIDER, code: refusal.code, submitted: false
            });
        }
        const hint = isGenerationPending(payloads)
            ? '生成仍在进行中，请到 Gemini 会话中查看结果，不要直接重新生成。'
            : '请到 Gemini 会话中确认结果，不要直接重新生成。';
        throw new WebProviderError(`${PROVIDER_NAME} 图片生成未返回可下载结果。${hint}`, {
            provider: PROVIDER, code: 'GENERATION_FAILED', submitted: true
        });
    }
    const downloaded = await downloadGeminiMedia(images, { session, expectedType: 'image' });
    // 保留首图字段：产品场景等单图调用方一直按 { buffer, extension } 读取结果。
    return { images: downloaded, ...downloaded[0], channel: 'http' };
}

export async function generateGeminiVideoHttp({
    prompt,
    aspectRatio = '16:9',
    referenceImageInputs = [],
    libraryDir,
    timeoutMinutes = 15,
    signal
}) {
    const cleanPrompt = requireNonEmptyPrompt(prompt, `${PROVIDER_NAME} 视频`);
    const session = await getGeminiSession({ signal, forceRefresh: true });
    const assets = referenceImageInputs.length
        ? await uploadGeminiImages(referenceImageInputs, libraryDir, { session, signal })
        : [];

    const payloads = await streamGenerate({
        session,
        prompt: applyAspectRatio(cleanPrompt, aspectRatio, 'video'),
        assets,
        conversation: {},
        mode: GEMINI_MODE.video,
        submitted: true,
        signal,
        timeoutSeconds: Math.max(300, timeoutMinutes * 60)
    });

    const { videos } = extractGeneratedMedia(payloads);
    if (videos.length === 0) {
        const refusal = detectRefusal(payloads);
        if (refusal) {
            throw new WebProviderError(`${PROVIDER_NAME}：${refusal.message}`, {
                provider: PROVIDER, code: refusal.code, submitted: false
            });
        }
        throw new WebProviderError(
            `${PROVIDER_NAME} 视频生成未返回可下载结果。生成配额可能已消耗，请到 Gemini 会话中查看，不要直接重新生成。`,
            { provider: PROVIDER, code: 'GENERATION_FAILED', submitted: true }
        );
    }
    const downloaded = await downloadGeminiMedia(videos, { session, expectedType: 'video' });
    return { videos: downloaded, ...downloaded[0], channel: 'http' };
}

/**
 * Gemini exposes no model-list API. The capabilities are fixed by the web app,
 * so the registry entry is static — but it lives here, next to the protocol,
 * rather than being spread across the UI.
 */
export async function discoverGeminiModels() {
    return {
        images: [{
            id: 'gemini-web-image',
            displayName: 'Gemini Web 生图',
            aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
            maxReferenceImages: 12,
            maxBatchCount: 1
        }],
        videos: [{
            id: 'gemini-web-video',
            displayName: 'Gemini Web 生视频',
            aspectRatios: ['16:9', '9:16'],
            supportsImageToVideo: true,
            supportsAudio: true,
            maxReferenceImages: 1,
            maxBatchCount: 1
        }],
        discovered: false
    };
}
