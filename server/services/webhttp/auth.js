/**
 * HTTP-first login detection for Gemini Web / 即梦 / Flow.
 *
 * Per `Web三平台-HTTP登录态检测改造数据.md`, the判断 is made entirely from data the
 * platform itself returns — never from an avatar, a "sign in" button, or any
 * selector. The three probes below cost nothing: they create no task, spend no
 * credits and make no workspace.
 *
 *   Gemini  GET /app                      → WIZ_global_data.S06Grb + SNlM0e
 *   即梦    GET /ai-tool/generate         → window.__isLogined
 *   Flow    GET /fx/api/auth/session      → user.email + access_token (+ expires)
 *
 * All three were verified against live logged-in sessions on 2026-07-27.
 *
 * Requests go through the page-context bridge so the browser's own cookie jar
 * applies. The browser is otherwise only used for actually logging in.
 */

import { buildRequestSpec, webFetch } from './bridge.js';
import { redactSecrets } from './errors.js';

/** @typedef {'unknown'|'checking'|'logged-in'|'logged-out'|'expired'|'error'} AuthStatus */

export const WEB_AUTH_PROVIDERS = Object.freeze(['gemini-web', 'jimeng', 'google-flow']);

const AUTH_URLS = Object.freeze({
    'gemini-web': 'https://gemini.google.com/app',
    jimeng: 'https://jimeng.jianying.com/ai-tool/generate',
    'google-flow': 'https://labs.google/fx/api/auth/session'
});

function baseStatus(provider, status, extra = {}) {
    return { provider, status, source: 'http', checkedAt: Date.now(), ...extra };
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

/**
 * Read one `WIZ_global_data` field out of the app document.
 *
 * Several encodings occur depending on where the value is embedded, so each is
 * tried. An **empty** value must be distinguishable from a missing one: signed
 * out pages ship `S06Grb: ""` rather than omitting it.
 *
 * @returns {string|null} the value (possibly ''), or null when absent entirely
 */
export function readWizField(html, key) {
    const source = String(html || '');
    const patterns = [
        new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`),
        new RegExp(`'${key}'\\s*:\\s*'([^']*)'`),
        new RegExp(`${key}\\\\":\\\\"([^\\\\"]*)`)
    ];
    for (const pattern of patterns) {
        const match = source.match(pattern);
        if (match) return match[1];
    }
    return null;
}

/**
 * Gemini login state.
 *
 * `FdrFJe` is deliberately NOT consulted: it is present on signed-out pages too,
 * so keying on it reports every visitor as logged in. The signal is `S06Grb`
 * (the Google account id) plus `SNlM0e` (the bootstrap token) — verified live:
 * both non-empty on a working session.
 */
export function parseGeminiAuth(html) {
    const userId = readWizField(html, 'S06Grb');
    const at = readWizField(html, 'SNlM0e');

    if (!userId) {
        return baseStatus('gemini-web', 'logged-out', { reason: 'NO_ACCOUNT_ID' });
    }
    if (!at) {
        // Account present but no bootstrap token: the session exists yet cannot
        // drive StreamGenerate. That is an expiry, not a clean logout.
        return baseStatus('gemini-web', 'expired', { userId, reason: 'NO_BOOTSTRAP_TOKEN' });
    }
    return baseStatus('gemini-web', 'logged-in', { userId });
}

// ---------------------------------------------------------------------------
// 即梦
// ---------------------------------------------------------------------------

/**
 * Pull the optional user block out of `window.__userInfoStringify`.
 *
 * The document holds a JSON *string*, so every inner quote arrives escaped:
 *   window.__userInfoStringify="{\"ret\":\"0\",\"data\":{\"user_info\":{...}}}"
 * The value pattern therefore has to skip `\"` explicitly — a lazy `.*?` stops
 * at the first escaped quote and truncates the payload two characters in.
 */
export function parseJimengUserInfo(html) {
    const match = String(html || '').match(
        /window\.__userInfoStringify\s*=\s*"((?:[^"\\]|\\.)*)"/
    );
    if (!match) return null;
    try {
        // Reuse JSON's own unescaping for the outer string layer, then parse the
        // inner document. Hand-rolled unescaping misses \n, \/ and surrogates.
        const parsed = JSON.parse(JSON.parse(`"${match[1]}"`));
        const user = parsed?.data?.user_info || parsed?.user_info || parsed;
        if (!user || typeof user !== 'object') return null;
        // avatar_urls is an object keyed by size (avatar_url_large / …), not an
        // array — indexing it as one silently yields undefined.
        const avatars = user.avatar_urls;
        const avatar = typeof avatars === 'string' ? avatars
            : Array.isArray(avatars) ? avatars[0]
                : avatars && typeof avatars === 'object'
                    ? (avatars.avatar_url_large || Object.values(avatars).find(value => typeof value === 'string'))
                    : user.avatar_url;
        return {
            userId: user.user_id ? String(user.user_id) : undefined,
            name: user.nick_name || user.name || undefined,
            avatar: typeof avatar === 'string' ? avatar : undefined
        };
    } catch {
        return null;
    }
}

/**
 * 即梦 login state.
 *
 * `window.__isLogined` is the primary signal. Two things are explicitly not
 * used: the presence of the string `sec_uid` (it appears in signed-out pages'
 * model config too) and `get_account_info`'s `ret === '0'` (that only means the
 * call succeeded, it carries no identity).
 */
export function parseJimengAuth(html) {
    const match = String(html || '').match(/window\.__isLogined\s*=\s*(true|false)/);
    if (!match) {
        return baseStatus('jimeng', 'unknown', { reason: 'LOGIN_FLAG_NOT_FOUND' });
    }
    if (match[1] === 'false') {
        return baseStatus('jimeng', 'logged-out');
    }

    const user = parseJimengUserInfo(html);
    if (!user?.userId) {
        // Flag says logged in but the identity bootstrap did not parse — report
        // unknown rather than green-lighting a session we cannot confirm.
        return baseStatus('jimeng', 'unknown', { reason: 'USER_INFO_UNPARSED' });
    }
    return baseStatus('jimeng', 'logged-in', {
        userId: user.userId,
        name: user.name,
        avatar: user.avatar
    });
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

/**
 * Flow login state.
 *
 * Signed out, NextAuth answers `{}`. Signed in it returns user + expires +
 * access_token — the same token the aisandbox APIs need, so a successful check
 * doubles as a Bearer refresh (see `applyFlowSessionToAuthCache`).
 */
export function parseFlowAuth(session) {
    if (!session || typeof session !== 'object' || !session.user?.email || !session.access_token) {
        return baseStatus('google-flow', 'logged-out');
    }
    const expiresAt = session.expires ? Date.parse(session.expires) : undefined;
    const common = {
        email: session.user.email,
        name: session.user.name,
        avatar: session.user.image,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined
    };
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
        return baseStatus('google-flow', 'expired', common);
    }
    return baseStatus('google-flow', 'logged-in', common);
}

// ---------------------------------------------------------------------------
// Checker + cache
// ---------------------------------------------------------------------------

/**
 * TTL per doc §14. Short enough that a re-login shows up quickly, long enough
 * that opening settings or starting a batch does not hammer three platforms.
 */
export const AUTH_CACHE_TTL_MS = 60_000;

const cache = new Map();

export function invalidateWebAuthCache(provider) {
    if (provider) cache.delete(provider);
    else cache.clear();
}

/** Cached status without touching the network; used by non-blocking callers. */
export function peekWebAuthStatus(provider) {
    const entry = cache.get(provider);
    if (!entry) return null;
    return Date.now() - entry.checkedAt < AUTH_CACHE_TTL_MS ? entry : null;
}

/**
 * Run the HTTP login probe for one provider.
 *
 * Never throws: an unreachable browser is an `error` status, not an exception,
 * because callers render this in a status row.
 */
export async function checkWebAuthStatus(provider, { force = false, signal } = {}) {
    if (!WEB_AUTH_PROVIDERS.includes(provider)) {
        throw new Error(`未知的 Web 平台：${provider}`);
    }
    if (!force) {
        const cached = peekWebAuthStatus(provider);
        if (cached) return { ...cached, fromCache: true };
    }

    let status;
    try {
        const response = await webFetch(provider, buildRequestSpec({
            url: AUTH_URLS[provider],
            method: 'GET',
            headers: { accept: provider === 'google-flow' ? 'application/json' : 'text/html' }
        }), { signal, timeoutSeconds: 60, label: `${provider} 登录检测` });

        if (!response.ok) {
            status = baseStatus(provider, 'error', { reason: `HTTP_${response.status}` });
        } else if (provider === 'google-flow') {
            let payload = null;
            try {
                payload = JSON.parse(response.text);
            } catch {
                payload = null;
            }
            status = parseFlowAuth(payload);
            if (status.status === 'logged-in') {
                // Bearer 直接从这里刷新，不必再去页面里抓 —— 只留在内存。
                lastFlowAccessToken = payload.access_token;
            }
        } else if (provider === 'gemini-web') {
            status = parseGeminiAuth(response.text);
        } else {
            status = parseJimengAuth(response.text);
        }
    } catch (error) {
        status = baseStatus(provider, 'error', {
            reason: error?.code || 'PROBE_FAILED',
            message: redactSecrets(error?.message || String(error))
        });
    }

    cache.set(provider, status);
    return status;
}

export function checkAllWebAuthStatus({ force = false, signal, providers = WEB_AUTH_PROVIDERS } = {}) {
    return Promise.all(providers.map(provider => checkWebAuthStatus(provider, { force, signal })));
}

/**
 * Flow's Bearer, captured by the last successful check. Memory only — never
 * logged, never persisted (doc §19).
 */
let lastFlowAccessToken = '';

export function takeFlowAccessToken() {
    return lastFlowAccessToken;
}

export function clearFlowAccessToken() {
    lastFlowAccessToken = '';
}

// ---------------------------------------------------------------------------
// Mapping onto the persisted session store
// ---------------------------------------------------------------------------

/**
 * The doc's six statuses vs. the store's vocabulary.
 *
 * The persisted store keeps its existing states so the rest of the app (the
 * optimizer availability gate, the startup guide, the canvas indicator) keeps
 * working unchanged. The richer fields — email, expiresAt, source — travel in
 * the API response only: email is PII and must not be written to disk.
 */
export function toBrowserSessionState(status) {
    switch (status) {
        case 'logged-in': return 'authenticated';
        case 'logged-out':
        case 'expired': return 'expired';
        case 'checking': return 'checking';
        default: return 'unknown';
    }
}

const STATUS_MESSAGES = Object.freeze({
    'logged-in': '已通过平台接口确认登录',
    'logged-out': '当前未登录，请在 Evan 专属 Chrome 中登录',
    expired: '登录已过期，请重新登录',
    unknown: '未能确认登录状态',
    error: '登录检测失败'
});

export function describeAuthStatus(status) {
    return STATUS_MESSAGES[status?.status] || STATUS_MESSAGES.unknown;
}

/** Persist a probe result, keeping secrets and PII out of the state file. */
export function persistAuthStatus(store, status) {
    return store.transition(status.provider, toBrowserSessionState(status.status), {
        errorCode: status.status === 'logged-in' ? null : (status.reason || 'AUTH_REQUIRED'),
        message: status.message || describeAuthStatus(status)
    });
}
