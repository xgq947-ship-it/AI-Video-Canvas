/**
 * 即梦 reference-image upload via ByteDance ImageX / TOS.
 *
 * Two different auth systems meet here, and the doc is explicit that they must
 * not be merged:
 *
 *   - 即梦's own `/mweb/v1/*` API: signed by the page (sign / msToken / a_bogus).
 *   - ImageX: AWS SigV4 over a short-lived STS credential.
 *
 * Split of work:
 *   - The STS credential is fetched from 即梦's API (page-signed, so no secret
 *     handling in Node beyond holding it in memory for the call).
 *   - SigV4 is computed here in Node — it is a documented algorithm, unlike
 *     `a_bogus`.
 *   - Every request is *issued* through the page so the Origin matches what the
 *     ImageX and TOS endpoints CORS-allow.
 *
 * Upload failures are reported as UPLOAD_FAILED with `submitted:false`: the
 * generator has not been billed, so the HTTP dispatcher may safely retry the
 * upload. DOM-click fallback no longer exists.
 */

import crypto from 'node:crypto';

import { buildRequestSpec, webFetch } from '../bridge.js';
import { WebProviderError } from '../errors.js';
import { JIMENG_AID, apiUrl, jimengBusinessError } from './protocol.js';

const PROVIDER = 'jimeng';
const IMAGEX_ENDPOINT = 'https://imagex.bytedanceapi.com/';
const IMAGEX_REGION = 'cn-north-1';
const IMAGEX_SERVICE = 'imagex';
export const IMAGEX_SERVICE_ID = 'tb4s082cfz';

// ---------------------------------------------------------------------------
// AWS SigV4
// ---------------------------------------------------------------------------

const sha256Hex = value => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();

function amzDate(now = new Date()) {
    const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    return { full: iso, short: iso.slice(0, 8) };
}

/**
 * Sign an ImageX request. Returns headers only — the caller performs the fetch
 * through the page so the browser supplies Origin/Referer.
 */
export function signImageXRequest({ method, url, body = '', credentials, now = new Date() }) {
    const target = new URL(url);
    const { full, short } = amzDate(now);
    const payloadHash = sha256Hex(body || '');

    const headers = {
        host: target.host,
        'x-amz-date': full,
        'x-amz-content-sha256': payloadHash
    };
    if (credentials.sessionToken) headers['x-amz-security-token'] = credentials.sessionToken;

    const canonicalHeaders = Object.keys(headers)
        .sort()
        .map(key => `${key}:${String(headers[key]).trim()}\n`)
        .join('');
    const signedHeaders = Object.keys(headers).sort().join(';');

    const canonicalQuery = [...target.searchParams.entries()]
        .map(([key, value]) => [encodeURIComponent(key), encodeURIComponent(value)])
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(pair => pair.join('='))
        .join('&');

    const canonicalRequest = [
        method.toUpperCase(),
        target.pathname || '/',
        canonicalQuery,
        canonicalHeaders,
        signedHeaders,
        payloadHash
    ].join('\n');

    const scope = `${short}/${IMAGEX_REGION}/${IMAGEX_SERVICE}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', full, scope, sha256Hex(canonicalRequest)].join('\n');

    const signingKey = ['aws4_request'].reduce(
        (key, part) => hmac(key, part),
        hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, short), IMAGEX_REGION), IMAGEX_SERVICE)
    );
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const { host: _host, ...requestHeaders } = headers;
    return {
        ...requestHeaders,
        authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, `
            + `SignedHeaders=${signedHeaders}, Signature=${signature}`
    };
}

// ---------------------------------------------------------------------------
// CRC32 — TOS rejects an upload whose Content-CRC32 does not match.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value;
    }
    return table;
})();

export function crc32Hex(buffer) {
    let crc = -1;
    for (let index = 0; index < buffer.length; index += 1) {
        crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff];
    }
    return ((crc ^ -1) >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// STS credentials
// ---------------------------------------------------------------------------

/**
 * Fetch a temporary ImageX credential.
 *
 * The doc could not locate this endpoint, so several known 即梦/ByteDance shapes
 * are tried in order and the first usable one wins. Credentials stay in memory
 * for the duration of the upload and are never logged or persisted.
 */
export async function fetchImageXCredentials({ signal } = {}) {
    const attempts = [
        { path: '/get_upload_token', body: { scene: 2, aid: JIMENG_AID } },
        { path: '/get_upload_token', body: { scene: 1, aid: JIMENG_AID } },
        { path: '/upload_token', body: { aid: JIMENG_AID } }
    ];

    const failures = [];
    for (const attempt of attempts) {
        try {
            const response = await webFetch(PROVIDER, buildRequestSpec({
                url: apiUrl(attempt.path),
                method: 'POST',
                json: attempt.body
            }), { signal });
            if (!response.ok) {
                failures.push(`${attempt.path} HTTP ${response.status}`);
                continue;
            }
            const payload = response.json();
            const businessError = jimengBusinessError(payload);
            if (businessError) {
                failures.push(`${attempt.path} ${businessError}`);
                continue;
            }
            const credentials = normalizeCredentials(payload);
            if (credentials) return credentials;
            failures.push(`${attempt.path} 响应中没有临时凭证`);
        } catch (error) {
            failures.push(`${attempt.path} ${error.message}`);
        }
    }

    throw new WebProviderError(
        `即梦未能获取 ImageX 上传凭证（${failures.join('；')}）`,
        { provider: PROVIDER, code: 'UPLOAD_FAILED', submitted: false }
    );
}

/** ByteDance has shipped several casings for the same credential block. */
function normalizeCredentials(payload) {
    let found = null;
    const visit = (node, depth = 0) => {
        if (found || !node || depth > 6 || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            node.forEach(item => visit(item, depth + 1));
            return;
        }
        const accessKeyId = node.AccessKeyID || node.AccessKeyId || node.access_key_id;
        const secretAccessKey = node.SecretAccessKey || node.secret_access_key;
        const sessionToken = node.SessionToken || node.session_token;
        if (accessKeyId && secretAccessKey) {
            found = { accessKeyId, secretAccessKey, sessionToken: sessionToken || '' };
            return;
        }
        Object.values(node).forEach(value => visit(value, depth + 1));
    };
    visit(payload);
    return found;
}

// ---------------------------------------------------------------------------
// Upload steps
// ---------------------------------------------------------------------------

export function buildApplyUploadUrl(byteLength) {
    const url = new URL(IMAGEX_ENDPOINT);
    url.searchParams.set('Action', 'ApplyImageUpload');
    url.searchParams.set('Version', '2018-08-01');
    url.searchParams.set('ServiceId', IMAGEX_SERVICE_ID);
    url.searchParams.set('FileSize', String(byteLength));
    url.searchParams.set('s', crypto.randomBytes(6).toString('hex'));
    return url.toString();
}

export function parseApplyUploadResponse(payload) {
    const address = payload?.Result?.UploadAddress || payload?.Result?.upload_address;
    const store = address?.StoreInfos?.[0];
    if (!store?.StoreUri) return null;
    return {
        storeUri: store.StoreUri,
        auth: store.Auth,
        uploadId: store.UploadID || store.UploadId,
        uploadHost: address.UploadHosts?.[0] || '',
        sessionKey: address.SessionKey || ''
    };
}

export function buildBinaryUploadRequest({ apply, buffer }) {
    return {
        url: `https://${apply.uploadHost}/upload/v1/${apply.storeUri}`,
        method: 'POST',
        headers: {
            authorization: apply.auth,
            'content-type': 'application/octet-stream',
            'content-crc32': crc32Hex(buffer),
            'content-disposition': 'attachment; filename="undefined"'
        },
        body: buffer
    };
}

export function buildCommitUploadUrl() {
    const url = new URL(IMAGEX_ENDPOINT);
    url.searchParams.set('Action', 'CommitImageUpload');
    url.searchParams.set('Version', '2018-08-01');
    url.searchParams.set('ServiceId', IMAGEX_SERVICE_ID);
    return url.toString();
}

/**
 * Full three-step upload. Returns `{ imageUri }` — the `StoreUri` that
 * `aigc_draft/generate` consumes as `image_uri`.
 *
 * Everything here happens before submission, so all failures carry
 * `submitted:false` and remain browser-fallback eligible.
 */
export async function uploadReferenceImage({ buffer, credentials, signal }) {
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    const applyUrl = buildApplyUploadUrl(bytes.length);
    const applyResponse = await webFetch(PROVIDER, buildRequestSpec({
        url: applyUrl,
        method: 'GET',
        headers: signImageXRequest({ method: 'GET', url: applyUrl, body: '', credentials }),
        credentials: 'omit'
    }), { signal });
    if (!applyResponse.ok) {
        throw new WebProviderError(`即梦参考图上传申请失败：HTTP ${applyResponse.status}`, {
            provider: PROVIDER, code: 'UPLOAD_FAILED', submitted: false
        });
    }
    const apply = parseApplyUploadResponse(applyResponse.json());
    if (!apply?.uploadHost || !apply?.auth) {
        throw new WebProviderError('即梦参考图上传申请缺少上传地址或凭证（协议可能已变化）', {
            provider: PROVIDER, code: 'UPLOAD_FAILED', submitted: false
        });
    }

    const binaryResponse = await webFetch(PROVIDER, buildRequestSpec({
        ...buildBinaryUploadRequest({ apply, buffer: bytes }),
        credentials: 'omit',
        timeoutSeconds: 180
    }), { signal, timeoutSeconds: 180 });
    if (!binaryResponse.ok) {
        throw new WebProviderError(
            `即梦参考图二进制上传失败：HTTP ${binaryResponse.status}。`
            + '该步骤在协议文档中标记为需实测校验，可切换到浏览器模式继续。',
            { provider: PROVIDER, code: 'UPLOAD_FAILED', submitted: false }
        );
    }

    const commitUrl = buildCommitUploadUrl();
    const commitBody = JSON.stringify({ SessionKey: apply.sessionKey });
    const commitResponse = await webFetch(PROVIDER, buildRequestSpec({
        url: commitUrl,
        method: 'POST',
        headers: {
            ...signImageXRequest({ method: 'POST', url: commitUrl, body: commitBody, credentials }),
            'content-type': 'application/json'
        },
        body: commitBody,
        credentials: 'omit'
    }), { signal });
    if (!commitResponse.ok) {
        throw new WebProviderError(`即梦参考图提交失败：HTTP ${commitResponse.status}`, {
            provider: PROVIDER, code: 'UPLOAD_FAILED', submitted: false
        });
    }

    return { imageUri: apply.storeUri };
}
