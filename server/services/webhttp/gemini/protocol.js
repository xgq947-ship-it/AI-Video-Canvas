/**
 * Gemini Web (BardFrontendService) HTTP protocol.
 *
 * Pure functions: bootstrap extraction, `f.req` construction, batchexecute
 * stream parsing and result extraction. No network, no browser.
 *
 * Protocol constants live in `GEMINI_MODE` and nowhere else. The document is
 * explicit that 14 / 11 / 17 are observed internal values with no stable
 * meaning — they must never leak into React components, node UI or workflows.
 */

export const GEMINI_ORIGIN = 'https://gemini.google.com';
export const GEMINI_STREAM_PATH =
    '/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate';
export const GEMINI_BATCH_PATH = '/_/BardChatUi/data/batchexecute';
export const GEMINI_VIDEO_POLL_RPC = 'hNvQHb';
export const GEMINI_UPLOAD_ENDPOINT = 'https://push.clients6.google.com/upload/';

/**
 * Observed generation-mode values, kept together so a Gemini Web build change
 * is a one-line edit. Versioned so a future adapter can branch on it.
 */
export const GEMINI_PROTOCOL_VERSION = '2026-07-web-97';
export const GEMINI_MODE = Object.freeze({
    image: 14,
    video: 11,
    videoCapability: 16,
    /** Current Videos tool marker nested in the message tuple. */
    videoMessage: [null, null, null, null, null, null, [[null, null, null, 1]]]
});

/** Bootstrap keys as they appear in the Gemini app document. */
const BOOTSTRAP_PATTERNS = Object.freeze({
    at: [/"SNlM0e"\s*:\s*"([^"]+)"/, /SNlM0e\\":\\"([^\\"]+)/, /'SNlM0e'\s*:\s*'([^']+)'/],
    bl: [/"cfb2h"\s*:\s*"([^"]+)"/, /cfb2h\\":\\"([^\\"]+)/, /'cfb2h'\s*:\s*'([^']+)'/],
    fSid: [/"FdrFJe"\s*:\s*"([^"]+)"/, /FdrFJe\\":\\"([^\\"]+)/, /'FdrFJe'\s*:\s*'([^']+)'/]
});

/**
 * Extract `at` / `bl` / `f.sid` from the Gemini app HTML.
 *
 * Multiple patterns per key on purpose: the document warns against relying on a
 * single regex, and the escaped variants show up when the value is embedded in
 * a nested JSON string rather than the top-level bootstrap object.
 */
export function extractGeminiBootstrap(html) {
    const source = String(html || '');
    const result = {};
    for (const [key, patterns] of Object.entries(BOOTSTRAP_PATTERNS)) {
        for (const pattern of patterns) {
            const match = source.match(pattern);
            if (match?.[1]) {
                result[key] = match[1];
                break;
            }
        }
    }
    if (!result.at || !result.bl || !result.fSid) {
        const missing = ['at', 'bl', 'fSid'].filter(key => !result[key]);
        const error = new Error(`Gemini bootstrap 参数缺失：${missing.join(', ')}`);
        error.missing = missing;
        throw error;
    }
    return result;
}

/**
 * Conversation tuple. An all-empty tuple starts a brand new conversation —
 * the doc is explicit that HTTP mode must not click "New chat".
 */
export function buildConversationTuple(conversation = {}) {
    return [
        conversation.conversationId || '',
        conversation.responseId || '',
        conversation.candidateId || '',
        null, null, null, null, null, null,
        conversation.contextToken || ''
    ];
}

/**
 * Attachment list, exactly as recorded in doc §11/§12. Works unchanged for one
 * or many images, which is why recognition and reference-image generation share
 * this one builder.
 */
export function buildAttachments(assets = []) {
    const list = (assets || []).filter(asset => asset?.resourcePath);
    if (list.length === 0) return null;
    return list.map(asset => [
        [asset.resourcePath, 1, null, asset.mimeType || 'image/png'],
        asset.fileName || 'image.png'
    ]);
}

/**
 * Build the inner `f.req` payload.
 *
 * `mode` is one of GEMINI_MODE.image / GEMINI_MODE.video, or null for plain
 * text. Everything mode-specific is confined to this function.
 */
export function buildStreamPayload({ prompt, assets = [], conversation = {}, mode = null, language = 'en' }) {
    const attachments = buildAttachments(assets);
    const message = [String(prompt ?? ''), 0, null, attachments, null, null, 0];

    const base = [message, [language], buildConversationTuple(conversation)];

    // 图片请求实测不再接受旧的 mode=14 字段；意图由 Prompt 识别。
    //
    // 视频不同：当前 Videos 工具使用 97 项请求信封。mode=11 位于索引 49，
    // capability=16 位于索引 55；把旧字段直接追加到三项基础 payload 会得到
    // HTTP 400，而只发三项则会被当成普通文本问答。
    //
    // 这些数字只留在 protocol 层，不向路由/UI 暴露。
    if (mode === GEMINI_MODE.video) {
        message.push(null, null, GEMINI_MODE.videoMessage);
        const payload = Array(97).fill(null);
        payload[0] = message;
        payload[1] = base[1];
        payload[2] = base[2];
        // The live UI sends an optional opaque client-context blob at index 3.
        // It is not part of auth and the server accepts ordinary requests without
        // it, so HTTP mode deliberately leaves it null instead of scraping an
        // unstable Angular object.
        payload[4] = crypto.randomUUID().replaceAll('-', '');
        payload[6] = [0];
        payload[7] = 1;
        payload[10] = 1;
        payload[11] = 0;
        payload[17] = [[0]];
        payload[18] = 0;
        payload[27] = 1;
        payload[30] = [4];
        payload[41] = [1];
        payload[49] = GEMINI_MODE.video;
        payload[53] = 0;
        payload[54] = [];
        payload[55] = [[GEMINI_MODE.videoCapability]];
        payload[59] = crypto.randomUUID().toUpperCase();
        payload[61] = [];
        payload[67] = 0;
        payload[68] = 1;
        payload[79] = 1;
        payload[80] = 1;
        payload[91] = 0;
        payload[96] = 0;
        return payload;
    }

    return base;
}

/** Serialize the payload into the `f.req` + `at` form body. */
export function buildStreamBody({ payload, at }) {
    const body = new URLSearchParams();
    body.set('f.req', JSON.stringify([null, JSON.stringify(payload)]));
    body.set('at', at);
    return body.toString();
}

export function buildStreamUrl({ bl, fSid, reqId, language = 'en' }) {
    const query = new URLSearchParams({
        bl,
        'f.sid': fSid,
        hl: language,
        _reqid: String(reqId),
        rt: 'c'
    });
    return `${GEMINI_ORIGIN}${GEMINI_STREAM_PATH}?${query.toString()}`;
}

/** Current batchexecute envelope used to poll an asynchronous video turn. */
export function buildBatchRpcRequest({ bl, fSid, reqId, at, rpcId, args, sourcePath = '/app', language = 'en' }) {
    const query = new URLSearchParams({
        rpcids: rpcId,
        'source-path': sourcePath,
        bl,
        'f.sid': fSid,
        hl: language,
        _reqid: String(reqId),
        rt: 'c'
    });
    const body = new URLSearchParams();
    body.set('f.req', JSON.stringify([[[rpcId, JSON.stringify(args), null, 'generic']]]));
    body.set('at', at);
    return {
        url: `${GEMINI_ORIGIN}${GEMINI_BATCH_PATH}?${query.toString()}`,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: body.toString()
    };
}

/** Current conversation lookup arguments used while an async video is running. */
export function buildVideoPollArgs(conversationId) {
    return [conversationId, 10, null, 1, [0], [4], null, 1];
}

/** `_reqid` is a per-request sequence; the web app seeds it randomly. */
export function nextRequestId(previous) {
    if (!previous) return Math.floor(Math.random() * 900_000) + 100_000;
    return previous + 100_000;
}

/**
 * Prompt-level aspect ratio.
 *
 * The doc explicitly could not find an aspect-ratio API field but verified that
 * describing the ratio in the prompt works. Inventing a field would be worse
 * than this, so the ratio is appended here and only here.
 */
export function applyAspectRatio(prompt, ratio, kind = 'image') {
    if (!ratio) return prompt;
    const label = kind === 'video' ? '视频尺寸比例' : '输出画面比例';
    return `${prompt}\n${label}：${ratio}`;
}

// ---------------------------------------------------------------------------
// Stream parsing
// ---------------------------------------------------------------------------

/**
 * Parse a batchexecute stream body into its decoded envelope payloads.
 *
 * Wire format: an anti-JSON-hijacking prefix, then repeating
 * `<byte length>\n<JSON chunk>` pairs. Each chunk is an array of envelopes;
 * `wrb.fr` envelopes carry the real payload as a JSON *string* at index 2.
 *
 * Length-prefix walking is preferred, but a malformed length must not lose the
 * whole response, so the walker falls back to brace-balanced scanning.
 */
export function parseBatchExecuteChunks(raw) {
    let source = String(raw || '');
    const prefix = source.indexOf(")]}'");
    if (prefix >= 0) source = source.slice(prefix + 4);

    const chunks = [];
    let cursor = 0;
    while (cursor < source.length) {
        const newline = source.indexOf('\n', cursor);
        if (newline < 0) break;
        const header = source.slice(cursor, newline).trim();
        const length = Number(header);
        if (Number.isInteger(length) && length > 0 && header !== '') {
            const body = source.slice(newline + 1, newline + 1 + length);
            try {
                chunks.push(JSON.parse(body));
                cursor = newline + 1 + length;
                continue;
            } catch {
                // Length was wrong (multi-byte accounting); fall through.
            }
        }
        const balanced = readBalancedArray(source, newline + 1);
        if (!balanced) break;
        try {
            chunks.push(JSON.parse(balanced.text));
        } catch {
            // Skip an unparseable chunk rather than abandoning later ones.
        }
        cursor = balanced.end;
    }
    return chunks;
}

function readBalancedArray(source, from) {
    const start = source.indexOf('[', from);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
        const char = source[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === '[') depth += 1;
        else if (char === ']') {
            depth -= 1;
            if (depth === 0) return { text: source.slice(start, index + 1), end: index + 1 };
        }
    }
    return null;
}

/** Decode the `wrb.fr` envelopes into their nested payload arrays. */
export function extractStreamPayloads(raw) {
    const payloads = [];
    for (const chunk of parseBatchExecuteChunks(raw)) {
        if (!Array.isArray(chunk)) continue;
        for (const envelope of chunk) {
            if (!Array.isArray(envelope) || envelope[0] !== 'wrb.fr') continue;
            const inner = envelope[2];
            if (typeof inner !== 'string' || !inner) continue;
            try {
                payloads.push(JSON.parse(inner));
            } catch {
                // A single unparseable envelope must not drop the rest.
            }
        }
    }
    return payloads;
}

const CONVERSATION_PREFIXES = Object.freeze({ conversationId: 'c_', responseId: 'r_', candidateId: 'rc_' });

/**
 * Walk a decoded payload for the conversation identifiers.
 *
 * Matches on the `c_` / `r_` / `rc_` prefixes rather than on array indices, so
 * a layout change on Gemini's side does not silently break session continuity.
 */
export function extractConversation(payloads) {
    const conversation = {};
    walk(payloads, value => {
        if (typeof value !== 'string') return;
        for (const [key, prefix] of Object.entries(CONVERSATION_PREFIXES)) {
            if (conversation[key]) continue;
            if (value.startsWith(prefix) && /^[a-z_]+[0-9a-f]{8,}$/i.test(value)) {
                conversation[key] = value;
            }
        }
        // The continuation token has no prefix; it is a long base64-ish blob.
        if (!conversation.contextToken && /^[A-Za-z0-9+/_-]{24,}={0,2}$/.test(value) && value.startsWith('Aw')) {
            conversation.contextToken = value;
        }
    });
    return conversation;
}

/**
 * Is this string plausibly the model's prose answer rather than machine data?
 *
 * Needed because the stream carries a lot of long strings — grounding-source
 * URLs, map tile references, opaque tokens — and a naive "longest string" pick
 * happily returns a `//www.google.com/maps/vt/data=…` blob, which is exactly
 * what happened against the live API.
 */
function looksLikeProse(value) {
    if (typeof value !== 'string') return false;
    const text = value.trim();
    if (text.length < 2 || text.length > 200_000) return false;
    if (/^(https?:)?\/\//.test(text)) return false;
    if (text.includes('://')) return false;
    if (/^(c_|r_|rc_)/.test(text)) return false;
    if (text.startsWith('/contrib_service/')) return false;
    if (/^[A-Za-z0-9+/_-]{40,}={0,2}$/.test(text)) return false;
    // Real answers are mostly letters/CJK/punctuation; token blobs are not.
    const wordish = (text.match(/[\p{L}\p{N}\s，。！？、；：""''.,!?;:]/gu) || []).length;
    return wordish / text.length > 0.8;
}

/**
 * Extract the assistant's text answer.
 *
 * Primary path is structural but *not* index-based: a candidate node is
 * recognisable by its `rc_…` id sitting at position 0 with the reply text in
 * the array right after it. That survives Gemini reshuffling the outer layout,
 * which fixed index paths do not.
 *
 * Fallback is the longest prose-looking string, for the case where the
 * candidate wrapper itself changes shape.
 */
export function extractText(payloads) {
    // StreamGenerate is progressive: every chunk repeats the answer so far, so
    // the candidates appear shortest-first. Taking the first match returns a
    // truncated reply — keep the longest instead.
    let structural = '';
    walkNodes(payloads, node => {
        if (!Array.isArray(node) || node.length < 2) return;
        if (typeof node[0] !== 'string' || !node[0].startsWith('rc_')) return;
        const body = node[1];
        if (!Array.isArray(body)) return;
        const text = body.find(looksLikeProse);
        if (text && text.length > structural.length) structural = text;
    });
    if (structural) return structural.trim();

    let best = '';
    walk(payloads, value => {
        if (!looksLikeProse(value)) return;
        if (value.length > best.length) best = value;
    });
    return best.trim();
}

const IMAGE_MIME = /^image\/(png|jpe?g|webp)$/i;
const VIDEO_MIME = /^video\/(mp4|webm)$/i;
const MEDIA_HOST = /^https?:\/\/(lh3\.googleusercontent\.com|[a-z0-9.-]*usercontent\.google\.com)\//i;

/**
 * Extract generated media from a decoded stream payload.
 *
 * Doc §25 is explicit: do not key off fixed array indices. This collects every
 * array node that simultaneously contains a media URL and either a media
 * mimeType or a media-looking filename, then pulls dimensions/size from the
 * numbers sitting alongside it.
 */
export function extractGeneratedMedia(payloads) {
    /**
     * Every node that *contains* a media URL matches, including the whole
     * response. Keeping the first match would mix unrelated numbers from
     * sibling branches into width/height, so each URL keeps only its tightest
     * enclosing node — the one with the fewest scalars.
     */
    const byUrl = new Map();

    walkNodes(payloads, node => {
        if (!Array.isArray(node)) return;
        const flat = flattenScalars(node);
        const urls = flat.strings.filter(value => MEDIA_HOST.test(value));
        if (urls.length === 0) return;

        const mime = flat.strings.find(value => IMAGE_MIME.test(value) || VIDEO_MIME.test(value)) || '';
        const fileName = flat.strings.find(value => /\.(png|jpe?g|webp|mp4|webm)$/i.test(value)) || '';
        if (!mime && !fileName) return;

        const weight = flat.strings.length + flat.numbers.length;
        for (const url of urls) {
            const existing = byUrl.get(url);
            if (!existing || weight < existing.weight) {
                byUrl.set(url, { weight, flat, mime, fileName, urls });
            }
        }
    });

    const imagesByUrl = new Map();
    const videosByUrl = new Map();
    for (const [url, candidate] of byUrl) {
        const { flat, mime, fileName } = candidate;
        const isVideo = VIDEO_MIME.test(mime) || /\.(mp4|webm)$/i.test(fileName);
        const downloadUrls = candidate.urls.filter(candidateUrl => {
            try {
                const declared = new URL(candidateUrl).searchParams.get('filename') || '';
                if (!declared) return true;
                return isVideo ? /\.(mp4|webm)$/i.test(declared) : /\.(png|jpe?g|webp)$/i.test(declared);
            } catch {
                return true;
            }
        });
        if (!downloadUrls.includes(url)) continue;
        const preferredUrl = downloadUrls.find(candidateUrl => {
            try {
                return /usercontent\.google\.com$/i.test(new URL(candidateUrl).hostname)
                    && Boolean(new URL(candidateUrl).searchParams.get('filename'));
            } catch {
                return false;
            }
        }) || url;
        const dimensions = flat.numbers.filter(value => value >= 16 && value <= 16_384);
        const sizeCandidates = flat.numbers.filter(value => value > 16_384);
        const entry = {
            fileName: fileName || (isVideo ? 'video.mp4' : 'image.png'),
            mimeType: mime || (isVideo ? 'video/mp4' : 'image/png'),
            url: preferredUrl,
            downloadUrls,
            width: dimensions[0],
            height: dimensions[1],
            // Current media tuples put byte size last; max() incorrectly selects
            // the epoch timestamp (about 1.7e9) for 2–4 MB videos.
            sizeBytes: sizeCandidates.length ? sizeCandidates.at(-1) : undefined
        };
        const target = isVideo ? videosByUrl : imagesByUrl;
        if (!target.has(preferredUrl)) target.set(preferredUrl, entry);
    }

    return { images: [...imagesByUrl.values()], videos: [...videosByUrl.values()] };
}

/**
 * Gemini refuses in prose rather than with a status code.
 *
 * A quota-exhausted image request still returns HTTP 200 with a friendly
 * sentence and no media. Without this the caller reports "生成未返回结果（协议可能
 * 已变化）", sending the user to debug a protocol that is working fine.
 *
 * @returns {{code: string, message: string}|null}
 */
export function detectRefusal(payloads) {
    const text = extractText(payloads);
    if (!text) return null;

    const quota = /额度|配额|quota|limit.*(reset|reached)|用完|上限/i.test(text)
        && /图片|视频|image|video|创建|生成|create|generate/i.test(text);
    if (quota) return { code: 'QUOTA_EXHAUSTED', message: text.slice(0, 200) };

    if (/无法(生成|创建)|不能(生成|创建)|policy|违反|不适当|can't (create|generate)|unable to (create|generate)/i.test(text)) {
        return { code: 'CONTENT_POLICY', message: text.slice(0, 200) };
    }
    return null;
}

/** True when the stream says generation is still running rather than done. */
export function isGenerationPending(payloads) {
    const { images, videos } = extractGeneratedMedia(payloads);
    if (images.length > 0 || videos.length > 0) return false;
    let pending = false;
    walk(payloads, value => {
        if (typeof value !== 'string') return;
        if (/正在(创建|生成)|generating|creating your (image|video)/i.test(value)) pending = true;
    });
    return pending;
}

function flattenScalars(node, depth = 0) {
    const strings = [];
    const numbers = [];
    const visit = (value, level) => {
        if (level > 4) return;
        if (typeof value === 'string') strings.push(value);
        else if (typeof value === 'number' && Number.isFinite(value)) numbers.push(value);
        else if (Array.isArray(value)) value.forEach(item => visit(item, level + 1));
    };
    visit(node, depth);
    return { strings, numbers };
}

function walk(value, visitor, depth = 0) {
    if (depth > 40) return;
    if (Array.isArray(value)) {
        value.forEach(item => walk(item, visitor, depth + 1));
        return;
    }
    if (value && typeof value === 'object') {
        Object.values(value).forEach(item => walk(item, visitor, depth + 1));
        return;
    }
    visitor(value);
}

function walkNodes(value, visitor, depth = 0) {
    if (depth > 40) return;
    if (Array.isArray(value)) {
        visitor(value);
        value.forEach(item => walkNodes(item, visitor, depth + 1));
    }
}

// ---------------------------------------------------------------------------
// Image upload (push.clients6.google.com resumable protocol)
// ---------------------------------------------------------------------------

/**
 * @param {string} feedId  Scotty feed name (`feeds/<id>`), read from the app
 *   document at runtime. Without it the server rejects the upload with
 *   "Request without ClientId (Feed name)" — verified against the live endpoint.
 */
export function buildUploadStartRequest({ fileName, byteLength, feedId }) {
    const headers = {
        'x-goog-upload-command': 'start',
        'x-goog-upload-header-content-length': String(byteLength),
        'x-goog-upload-protocol': 'resumable',
        'x-tenant-id': 'bard-storage',
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
    };
    if (feedId) headers['push-id'] = feedId;
    return {
        url: GEMINI_UPLOAD_ENDPOINT,
        method: 'POST',
        headers,
        body: `File name: ${fileName}`
    };
}

/**
 * The resumable upload URL comes back in a header. Google has used several
 * names for it over time, so check each rather than assuming one.
 */
export function resolveUploadUrl(headers) {
    const lookup = key => headers?.[key] ?? headers?.[key.toLowerCase()] ?? '';
    return String(
        lookup('x-goog-upload-url')
        || lookup('X-Goog-Upload-URL')
        || lookup('location')
        || ''
    );
}

export function buildUploadFinalizeRequest({ uploadUrl, buffer }) {
    return {
        url: uploadUrl,
        method: 'POST',
        headers: {
            'x-goog-upload-command': 'upload, finalize',
            'x-goog-upload-offset': '0',
            'x-tenant-id': 'bard-storage'
        },
        body: buffer
    };
}

/** Finalize returns the `/contrib_service/...` resource path as plain text. */
export function parseUploadedResourcePath(text) {
    const value = String(text || '').trim();
    if (!value.startsWith('/contrib_service/')) return '';
    return value;
}
