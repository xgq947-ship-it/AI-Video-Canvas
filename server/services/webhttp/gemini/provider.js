/**
 * Gemini Web HTTP provider.
 *
 * Replaces "find the input box → click → wait for DOM → click download" with
 * bootstrap → StreamGenerate → parse → HTTP download. The browser keeps only
 * the login, the bootstrap read and the `auto`-mode fallback.
 */

import {
    attachCurrentGenerationDetails,
    runProviderDownload,
    runProviderPoll
} from '../../generationRuntime/scheduler.js';
import { webContext, webFetch, cookieHeaderFor, buildRequestSpec } from '../bridge.js';
import { WebProviderError, classifyHttpFailure } from '../errors.js';
import { downloadResultMedia, loadReferenceImageFiles, requireNonEmptyPrompt } from '../media.js';
import {
    GEMINI_MODE,
    GEMINI_PROTOCOL_VERSION,
    GEMINI_VIDEO_POLL_RPC,
    applyAspectRatio,
    buildBatchRpcRequest,
    buildStreamBody,
    buildStreamPayload,
    buildStreamUrl,
    buildVideoPollArgs,
    buildUploadFinalizeRequest,
    buildUploadStartRequest,
    extractConversation,
    extractGeneratedMedia,
    extractGeminiBootstrap,
    extractLatestCandidateText,
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
const DEFAULT_TEXT_TASK_TIMEOUT_SECONDS = 180;
const MAX_TEXT_TASK_TIMEOUT_SECONDS = 20 * 60;
const TEXT_RECOVERY_POLL_INTERVAL_MS = 5_000;
const TEXT_RECOVERY_SESSION_REFRESH_MS = 90_000;
const TEXT_RECOVERY_PRIMER = '接下来我会发送一个结构化媒体分析任务。请只回复 READY，不要添加其他内容。';

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
            `${PROVIDER_NAME} 登录已失效，请在系统共享 Chrome 中重新登录 Google 账号`,
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

/** 上传调用方已经安全解析过的音频/视频文件，用于不消耗生成额度的媒体理解任务。 */
export async function uploadGeminiMediaFiles(files, { session, signal } = {}) {
    const list = (Array.isArray(files) ? files : []).filter(file =>
        Buffer.isBuffer(file?.buffer) && file.buffer.length > 0 && file.fileName && file.mimeType
    );
    if (list.length === 0) return [];
    const activeSession = session || await getGeminiSession({ signal });
    const assets = [];
    for (const file of list) assets.push(await uploadImage(file, { session: activeSession, signal }));
    return assets;
}

export function describeGeminiStreamFailure(response, timeoutSeconds) {
    const statusText = String(response?.statusText || '').trim();
    const timedOut = Number(response?.status) === 0
        && /abort|timeout|timed\s*out|time\s*out/i.test(statusText);
    if (timedOut) {
        return `${PROVIDER_NAME} 请求等待超过 ${Math.ceil(timeoutSeconds / 60)} 分钟，服务尚未返回结果，请重试当前任务`;
    }
    if (Number(response?.status) === 0) {
        return `${PROVIDER_NAME} 网络请求中断${statusText ? `（${statusText}）` : ''}，请检查网络后重试`;
    }
    if ([502, 503, 504].includes(Number(response?.status))) {
        return `${PROVIDER_NAME} 服务暂时繁忙（HTTP ${response.status}），正在尝试从 Gemini 会话恢复结果`;
    }
    return `${PROVIDER_NAME} 请求失败：HTTP ${response?.status}`;
}

export function extractGeminiTextForTurn(payloads, {
    previousCandidateId,
    recoveredText,
} = {}) {
    const recovered = String(recoveredText || '').trim();
    if (recovered) return recovered;
    const latest = extractLatestCandidateText(payloads, {
        excludeCandidateIds: [previousCandidateId],
    });
    return latest || extractText(payloads);
}

export function hasUsableGeminiTextPayload(payloads, { previousCandidateId } = {}) {
    if (!Array.isArray(payloads) || payloads.length === 0) return false;
    const latest = extractLatestCandidateText(payloads, {
        excludeCandidateIds: [previousCandidateId],
    });
    if (previousCandidateId) return Boolean(latest);
    const conversation = extractConversation(payloads);
    return Boolean(conversation.candidateId && (latest || extractText(payloads)));
}

export function shouldRecoverGeminiTextFailure(error) {
    const status = Number(error?.details?.status);
    return error instanceof WebProviderError
        && error.submitted === false
        && ([0, 502, 503, 504].includes(status) || error.code === 'BRIDGE_UNAVAILABLE');
}

/**
 * One StreamGenerate round trip.
 *
 * `submitted` is the caller's call: a text question costs nothing, an image or
 * video generation spends quota the moment the request lands.
 */
async function streamGenerate({
    session,
    prompt,
    assets,
    conversation,
    mode,
    submitted,
    signal,
    timeoutSeconds,
    acceptTextOnHttpFailure = false,
}) {
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
    const payloads = extractStreamPayloads(response.text);
    if (!response.ok) {
        // Gemini 偶尔会在长回答完成时把外层请求标成 502/503，但响应体里已经有
        // 完整的 wrb.fr candidate。先信任可严格解析的业务结果，不能只看 HTTP 状态。
        if (acceptTextOnHttpFailure && hasUsableGeminiTextPayload(payloads, {
            previousCandidateId: conversation?.candidateId,
        })) {
            console.warn(`[Gemini Web HTTP] 外层返回 HTTP ${response.status}，但响应体包含完整文本结果，继续处理`);
            return payloads;
        }
        // A 401/403 here means the bootstrap went stale between read and use.
        if (response.status === 401 || response.status === 403) clearGeminiSessionCache();
        const statusText = String(response.statusText || '').trim();
        throw new WebProviderError(
            describeGeminiStreamFailure(response, timeoutSeconds),
            {
                provider: PROVIDER,
                code: classifyHttpFailure(response.status, response.text),
                submitted,
                details: {
                    status: response.status,
                    statusText,
                    networkError: response.networkError,
                    timeoutSeconds,
                },
            }
        );
    }

    if (payloads.length === 0) {
        throw new WebProviderError(
            `${PROVIDER_NAME} 返回的响应无法解析（协议可能已变化）`,
            { provider: PROVIDER, code: 'PROTOCOL_CHANGED', submitted }
        );
    }
    return payloads;
}

async function createRecoverableTextConversation({ session, signal }) {
    const payloads = await streamGenerate({
        session,
        prompt: TEXT_RECOVERY_PRIMER,
        assets: [],
        conversation: {},
        mode: null,
        submitted: false,
        signal,
        timeoutSeconds: 120,
        acceptTextOnHttpFailure: true,
    });
    const conversation = extractConversation(payloads);
    if (!conversation.conversationId) {
        throw new WebProviderError(`${PROVIDER_NAME} 未能建立可恢复的分析会话，请重试`, {
            provider: PROVIDER,
            code: 'PROTOCOL_CHANGED',
            submitted: false,
        });
    }
    return conversation;
}

async function recoverGeminiTextConversation({
    session,
    conversation,
    signal,
    timeoutSeconds,
}) {
    if (!conversation?.conversationId) return null;
    const deadline = Date.now() + Math.max(15, Number(timeoutSeconds) || 120) * 1000;
    let activeSession = session;
    let refreshedAt = Date.now();
    while (Date.now() < deadline) {
        if (Date.now() - refreshedAt >= TEXT_RECOVERY_SESSION_REFRESH_MS) {
            activeSession = await getGeminiSession({ signal, forceRefresh: true });
            refreshedAt = Date.now();
        }
        requestIdSeed = nextRequestId(requestIdSeed);
        const spec = buildBatchRpcRequest({
            bl: activeSession.bl,
            fSid: activeSession.fSid,
            reqId: requestIdSeed,
            at: activeSession.at,
            rpcId: GEMINI_VIDEO_POLL_RPC,
            args: buildVideoPollArgs(conversation.conversationId),
            sourcePath: `/app/${conversation.conversationId.replace(/^c_/, '')}`,
        });
        try {
            const response = await webFetch(PROVIDER, buildRequestSpec(spec), {
                signal,
                timeoutSeconds: 120,
                submitted: false,
            });
            if (response.ok) {
                const payloads = extractStreamPayloads(response.text);
                const text = extractLatestCandidateText(payloads, {
                    excludeCandidateIds: [conversation.candidateId],
                });
                const clean = text.trim();
                const completeJson = clean.startsWith('{') && clean.endsWith('}');
                if (completeJson) {
                    return { payloads, session: activeSession, text: clean };
                }
            }
        } catch (error) {
            console.warn(`[Gemini Web HTTP] 分析结果回捞暂未成功：${error.message}`);
        }
        await sleep(TEXT_RECOVERY_POLL_INTERVAL_MS, signal);
    }
    return null;
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
        timeoutSeconds: 180,
        acceptTextOnHttpFailure: true,
    });

    const text = extractGeminiTextForTurn(payloads, {
        previousCandidateId: conversation?.candidateId,
    });
    if (!text) {
        throw new WebProviderError(`${PROVIDER_NAME} 没有返回文本回答`, {
            provider: PROVIDER, code: 'GENERATION_FAILED', submitted: false
        });
    }
    return { text, conversation: extractConversation(payloads), channel: 'http' };
}

/** 音视频理解任务；与图片识图共用真实 StreamGenerate 协议，但附件由调用方提供。 */
export async function runGeminiMediaTextTaskHttp({
    prompt,
    files = [],
    conversation,
    signal,
    timeoutSeconds = DEFAULT_TEXT_TASK_TIMEOUT_SECONDS,
    recoverRemoteResult = false,
    recoveryTimeoutSeconds = 180,
}) {
    const cleanPrompt = requireNonEmptyPrompt(prompt, PROVIDER_NAME);
    const normalizedTimeoutSeconds = Number.isFinite(Number(timeoutSeconds))
        ? Math.min(MAX_TEXT_TASK_TIMEOUT_SECONDS, Math.max(30, Math.round(Number(timeoutSeconds))))
        : DEFAULT_TEXT_TASK_TIMEOUT_SECONDS;
    const session = await getGeminiSession({ signal });
    let activeConversation = conversation || {};
    if (recoverRemoteResult && !activeConversation.conversationId) {
        try {
            activeConversation = await createRecoverableTextConversation({ session, signal });
        } catch (error) {
            // The primer only gives a future gateway-timeout request a known
            // conversation id. It must never become a harder dependency than
            // the actual analysis request itself. Authentication/protocol
            // failures still surface; transient bridge/gateway failures safely
            // degrade to the normal one-shot analysis path.
            if (!shouldRecoverGeminiTextFailure(error)) throw error;
            console.warn(`[Gemini Web HTTP] 建立结果回捞会话失败，降级为直接分析：${error.message}`);
            activeConversation = {};
        }
    }
    const assets = await uploadGeminiMediaFiles(files, { session, signal });
    let payloads;
    let recovered = false;
    let recoveredText = '';
    try {
        payloads = await streamGenerate({
            session,
            prompt: cleanPrompt,
            assets,
            conversation: activeConversation,
            mode: null,
            submitted: false,
            signal,
            timeoutSeconds: normalizedTimeoutSeconds,
            acceptTextOnHttpFailure: true,
        });
    } catch (error) {
        if (!recoverRemoteResult || !shouldRecoverGeminiTextFailure(error)) throw error;
        const recovery = await recoverGeminiTextConversation({
            session,
            conversation: activeConversation,
            signal,
            timeoutSeconds: recoveryTimeoutSeconds,
        });
        if (!recovery) {
            throw new WebProviderError(
                `${PROVIDER_NAME} 已返回远端会话，但暂时无法同步分析结果，请稍后重试当前镜头`,
                {
                    provider: PROVIDER,
                    code: 'POLL_TIMEOUT',
                    submitted: false,
                    retryable: true,
                    details: {
                        conversationId: activeConversation.conversationId,
                        originalStatus: error?.details?.status,
                    },
                    cause: error,
                }
            );
        }
        payloads = recovery.payloads;
        recoveredText = recovery.text;
        recovered = true;
    }
    // 会话查询会同时返回 READY、旧的纠错回答和最新回答。恢复路径必须使用上面
    // 明确选出的最新 candidate，不能再次用“最长文本”规则回退到旧回答。
    const text = extractGeminiTextForTurn(payloads, {
        previousCandidateId: activeConversation.candidateId,
        recoveredText,
    });
    if (!text) {
        throw new WebProviderError(`${PROVIDER_NAME} 没有返回媒体识别结果`, {
            provider: PROVIDER, code: 'GENERATION_FAILED', submitted: false
        });
    }
    return {
        text,
        conversation: { ...activeConversation, ...extractConversation(payloads) },
        channel: recovered ? 'http-recovered' : 'http',
    };
}

async function downloadGeminiMedia(items, { session, expectedType, signal }) {
    return Promise.all(items.map(item => runProviderDownload(PROVIDER, async () => {
        const downloaded = await downloadResultMedia(item.url, {
            providerName: PROVIDER_NAME,
            expectedType,
            cookieHeader: session.cookieHeader,
            recoveryHint: '请先到 Gemini 会话中下载本次结果，不要直接重新生成。'
        });
        return { ...downloaded, metadata: item };
    }, { signal, label: `${PROVIDER_NAME} ${expectedType === 'video' ? '视频' : '图片'}下载` })));
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
    const references = referenceImageInputs.filter(Boolean);
    if (references.length > 5) {
        throw new WebProviderError(`${PROVIDER_NAME} 图片当前最多支持 5 张参考图`, {
            provider: PROVIDER, code: 'INVALID_INPUT', submitted: false
        });
    }
    const session = await getGeminiSession({ signal, forceRefresh: true });
    const assets = references.length
        ? await uploadGeminiImages(references, libraryDir, { session, signal })
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
                provider: PROVIDER, code: refusal.code, submitted: false, retryable: false
            });
        }
        const hint = isGenerationPending(payloads)
            ? '生成仍在进行中，请到 Gemini 会话中查看结果，不要直接重新生成。'
            : '请到 Gemini 会话中确认结果，不要直接重新生成。';
        throw new WebProviderError(`${PROVIDER_NAME} 图片生成未返回可下载结果。${hint}`, {
            provider: PROVIDER, code: 'GENERATION_FAILED', submitted: true
        });
    }
    const downloaded = await downloadGeminiMedia(images, { session, expectedType: 'image', signal });
    // 保留首图字段：产品场景等单图调用方一直按 { buffer, extension } 读取结果。
    return { images: downloaded, ...downloaded[0], channel: 'http' };
}

const VIDEO_POLL_INTERVAL_MS = 60_000;
const VIDEO_POLL_SESSION_REFRESH_MS = 90_000;

/**
 * Gemini acknowledges video generation immediately, then exposes the finished
 * turn through the hNvQHb conversation RPC. Each poll is a short authenticated
 * request; it never re-submits the prompt and therefore cannot double bill.
 */
async function waitForGeminiVideo({ session, conversationId, timeoutMinutes, signal }) {
    const deadline = Date.now() + timeoutMinutes * 60_000;
    let activeSession = session;
    let refreshedAt = Date.now();
    while (Date.now() < deadline) {
        await sleep(VIDEO_POLL_INTERVAL_MS, signal);
        if (Date.now() - refreshedAt >= VIDEO_POLL_SESSION_REFRESH_MS) {
            activeSession = await getGeminiSession({ signal, forceRefresh: true });
            refreshedAt = Date.now();
        }
        requestIdSeed = nextRequestId(requestIdSeed);
        const spec = buildBatchRpcRequest({
            bl: activeSession.bl,
            fSid: activeSession.fSid,
            reqId: requestIdSeed,
            at: activeSession.at,
            rpcId: GEMINI_VIDEO_POLL_RPC,
            args: buildVideoPollArgs(conversationId),
            sourcePath: `/app/${conversationId.replace(/^c_/, '')}`
        });
        try {
            const response = await runProviderPoll(PROVIDER, () => webFetch(
                PROVIDER,
                buildRequestSpec(spec),
                { signal, timeoutSeconds: 120, submitted: true }
            ), { signal, label: `${PROVIDER_NAME} 视频轮询` });
            if (!response.ok) {
                throw new WebProviderError(`${PROVIDER_NAME} 视频状态查询失败：HTTP ${response.status}`, {
                    provider: PROVIDER,
                    code: response.status === 401 || response.status === 403 ? 'AUTH_EXPIRED' : 'GENERATION_FAILED',
                    submitted: true
                });
            }
            const payloads = extractStreamPayloads(response.text);
            if (payloads.length === 0) continue;
            if (extractGeneratedMedia(payloads).videos.length > 0) {
                return { payloads, session: activeSession };
            }

            const refusal = detectRefusal(payloads);
            if (refusal) {
                throw new WebProviderError(`${PROVIDER_NAME}：${refusal.message}`, {
                    provider: PROVIDER, code: refusal.code, submitted: true
                });
            }
        } catch (error) {
            if (error instanceof WebProviderError
                && (error.code === 'CONTENT_POLICY' || error.code === 'QUOTA_EXHAUSTED')) {
                throw error;
            }
            // Do not hammer Gemini after a transport/rate-limit failure. The
            // fixed 60s interval is the backoff; the periodic refresh before a
            // later poll replaces short-lived bl/f.sid/at values.
            // The task is already paid for. A transient lookup failure must not
            // turn into a second generation through auto/browser fallback.
            console.warn(`[Gemini Web HTTP] 视频状态查询失败，继续等待：${error.message}`);
        }
    }
    throw new WebProviderError(
        `${PROVIDER_NAME} 视频在 ${timeoutMinutes} 分钟内未完成。生成配额可能已经消耗。`
        + `会话 ID：${conversationId}。请到 Gemini 会话中查看结果，不要直接重新生成。`,
        {
            provider: PROVIDER,
            code: 'POLL_TIMEOUT',
            submitted: true,
            details: { conversationId }
        }
    );
}

export async function generateGeminiVideoHttp({
    prompt,
    aspectRatio = '16:9',
    duration = 10,
    referenceImageInputs = [],
    libraryDir,
    timeoutMinutes = 15,
    signal
}) {
    const cleanPrompt = requireNonEmptyPrompt(prompt, `${PROVIDER_NAME} 视频`);
    if (Number(duration) !== 10) {
        throw new WebProviderError(`${PROVIDER_NAME} 视频当前固定生成 10 秒`, {
            provider: PROVIDER, code: 'INVALID_INPUT', submitted: false, retryable: false
        });
    }
    const references = referenceImageInputs.filter(Boolean);
    if (references.length > 1) {
        throw new WebProviderError(`${PROVIDER_NAME} 视频当前只支持 1 张首帧参考图`, {
            provider: PROVIDER, code: 'INVALID_INPUT', submitted: false
        });
    }
    let session = await getGeminiSession({ signal, forceRefresh: true });
    const assets = references.length
        ? await uploadGeminiImages(references, libraryDir, { session, signal })
        : [];

    let payloads = await streamGenerate({
        session,
        prompt: applyAspectRatio(cleanPrompt, aspectRatio, 'video'),
        assets,
        conversation: {},
        mode: GEMINI_MODE.video,
        submitted: true,
        signal,
        timeoutSeconds: Math.max(300, timeoutMinutes * 60)
    });

    let { videos } = extractGeneratedMedia(payloads);
    const conversation = extractConversation(payloads);
    if (conversation.conversationId) {
        attachCurrentGenerationDetails(PROVIDER, { conversationId: conversation.conversationId });
    }
    if (videos.length === 0 && isGenerationPending(payloads)) {
        if (!conversation.conversationId) {
            throw new WebProviderError(
                `${PROVIDER_NAME} 已接受视频任务，但没有返回可查询的 conversationId。请到 Gemini 会话中查看结果，不要直接重新生成。`,
                { provider: PROVIDER, code: 'PROTOCOL_CHANGED', submitted: true }
            );
        }
        const completed = await waitForGeminiVideo({
            session,
            conversationId: conversation.conversationId,
            timeoutMinutes,
            signal
        });
        payloads = completed.payloads;
        session = completed.session;
        ({ videos } = extractGeneratedMedia(payloads));
    }
    if (videos.length === 0) {
        const refusal = detectRefusal(payloads);
        if (refusal) {
            throw new WebProviderError(`${PROVIDER_NAME}：${refusal.message}`, {
                provider: PROVIDER, code: refusal.code, submitted: false, retryable: false
            });
        }
        throw new WebProviderError(
            `${PROVIDER_NAME} 视频生成未返回可下载结果。生成配额可能已消耗，请到 Gemini 会话中查看，不要直接重新生成。`,
            { provider: PROVIDER, code: 'GENERATION_FAILED', submitted: true }
        );
    }
    const downloaded = await downloadGeminiMedia(videos, { session, expectedType: 'video', signal });
    return {
        videos: downloaded,
        ...downloaded[0],
        runId: conversation.conversationId || '',
        channel: 'http'
    };
}

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const cancelled = () => new WebProviderError(
            '任务已取消', { provider: PROVIDER, code: 'UNKNOWN', submitted: true }
        );
        if (signal?.aborted) {
            reject(cancelled());
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(cancelled());
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
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
            maxReferenceImages: 5,
            maxBatchCount: 1
        }],
        videos: [{
            id: 'gemini-web-video',
            displayName: 'Gemini Web 生视频',
            aspectRatios: ['16:9', '9:16'],
            durations: [10],
            supportsImageToVideo: true,
            supportsAudio: true,
            maxReferenceImages: 1,
            maxBatchCount: 1
        }],
        discovered: false
    };
}
