import fs from 'node:fs';
import path from 'node:path';
import { RUNTIME_PATHS } from '../runtime/paths.js';

export const BROWSER_SESSION_STATES = Object.freeze([
    'unknown',
    'checking',
    'authenticated',
    'expired',
    'reauthenticating',
    'browser_unavailable',
    'submission_unknown'
]);

const VALID_STATES = new Set(BROWSER_SESSION_STATES);
const PROVIDERS = Object.freeze(['google-flow', 'jimeng', 'gemini-web']);

function initialProviderState(provider) {
    return {
        provider,
        state: 'unknown',
        updatedAt: null,
        errorCode: null,
        message: null
    };
}

function emptyDocument() {
    return {
        version: 1,
        providers: Object.fromEntries(PROVIDERS.map(provider => [
            provider,
            initialProviderState(provider)
        ]))
    };
}

/**
 * Small persisted state store for browser-backed provider sessions.
 *
 * It intentionally stores no cookies or credentials. Playwright's persistent
 * profile owns authentication data; this file only exposes health/state to the
 * backend and UI and survives application updates.
 */
export class BrowserSessionStateStore {
    constructor({
        filePath = path.join(RUNTIME_PATHS.runtimeDir, 'browser-sessions.json'),
        now = () => new Date().toISOString()
    } = {}) {
        this.filePath = filePath;
        this.now = now;
        this.document = this.#read();
    }

    #read() {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            const document = emptyDocument();
            for (const provider of PROVIDERS) {
                const saved = parsed?.providers?.[provider];
                if (saved && VALID_STATES.has(saved.state)) {
                    // “已验证”只能代表本次进程内真实页面探针的结果。应用重启后必须
                    // 重新验证，不能把上次任务的历史成功状态直接展示成当前已登录。
                    const staleSuccess = ['authenticated', 'checking', 'reauthenticating'].includes(saved.state);
                    document.providers[provider] = {
                        ...initialProviderState(provider),
                        ...saved,
                        provider,
                        state: staleSuccess ? 'unknown' : saved.state,
                        errorCode: staleSuccess ? null : saved.errorCode,
                        message: staleSuccess ? '等待本次启动重新验证登录状态' : saved.message
                    };
                }
            }
            return document;
        } catch (error) {
            if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
            return emptyDocument();
        }
    }

    #write() {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
        fs.writeFileSync(temporaryPath, `${JSON.stringify(this.document, null, 2)}\n`, 'utf8');
        fs.renameSync(temporaryPath, this.filePath);
    }

    get(provider) {
        const state = this.document.providers[provider];
        return state ? { ...state } : initialProviderState(provider);
    }

    list() {
        return Object.fromEntries(PROVIDERS.map(provider => [provider, this.get(provider)]));
    }

    transition(provider, state, { errorCode = null, message = null } = {}) {
        if (!PROVIDERS.includes(provider)) {
            throw new Error(`Unknown browser provider: ${provider}`);
        }
        if (!VALID_STATES.has(state)) {
            throw new Error(`Invalid browser session state: ${state}`);
        }
        this.document.providers[provider] = {
            provider,
            state,
            updatedAt: this.now(),
            errorCode,
            message
        };
        this.#write();
        return this.get(provider);
    }
}

export function inferBrowserProvider(args = []) {
    const values = Array.isArray(args) ? args.map(value => String(value)) : [];
    if (values.includes('gemini-web')) return 'gemini-web';
    if (values.includes('google-flow')) return 'google-flow';
    if (values.includes('jimeng')) return 'jimeng';
    return null;
}

export function browserStateForError(error) {
    if (['AUTH_REQUIRED', 'SCENE_CAPTURE_FAILED'].includes(error?.code)) return 'expired';
    if (error?.code === 'SUBMISSION_UNKNOWN') return 'submission_unknown';
    if (['BROWSER_CLOSED', 'BROWSER_MODELS_NOT_READY'].includes(error?.code)) {
        return 'browser_unavailable';
    }
    return null;
}

export const browserSessionState = new BrowserSessionStateStore();
