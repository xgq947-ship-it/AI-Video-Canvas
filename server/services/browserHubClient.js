import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function browserHubHome(environment = process.env, {
    platform = process.platform,
    homeDir = os.homedir()
} = {}) {
    const override = String(environment.AI_BROWSER_HUB_HOME || '').trim();
    if (override) return path.resolve(override);
    if (platform === 'darwin') {
        return path.join(homeDir, 'Library', 'Application Support', 'SankaiAI', 'AI Browser Hub');
    }
    if (platform === 'win32') {
        return path.join(
            String(environment.LOCALAPPDATA || '').trim() || path.join(homeDir, 'AppData', 'Local'),
            'SankaiAI',
            'AI Browser Hub'
        );
    }
    return path.join(
        String(environment.XDG_DATA_HOME || '').trim() || path.join(homeDir, '.local', 'share'),
        'sankaiai',
        'ai-browser-hub'
    );
}

async function readState(environment = process.env) {
    try {
        return JSON.parse(await fs.readFile(
            path.join(browserHubHome(environment), 'runtime', 'hub-state.json'),
            'utf8'
        ));
    } catch {
        return null;
    }
}

export async function browserHubRpc(method, params = {}, environment = process.env) {
    const state = await readState(environment);
    if (!state?.port || !state?.token) return null;
    try {
        const response = await fetch(`http://127.0.0.1:${state.port}/rpc`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${state.token}`,
                'content-type': 'application/json'
            },
            body: JSON.stringify({ method, params }),
            signal: AbortSignal.timeout(800)
        });
        const body = await response.json();
        return response.ok && body.ok ? body.result : null;
    } catch {
        return null;
    }
}

export async function isSharedBrowserReady(environment = process.env) {
    const status = await browserHubRpc('browser.status', {}, environment);
    const browser = status?.browser;
    return browser?.running === true
        && browser?.mode === 'background'
        && /^http:\/\/127\.0\.0\.1:\d+$/.test(String(browser?.cdpEndpoint || ''));
}

export function browserHubPayloadPath(environment = process.env) {
    const override = String(environment.AI_BROWSER_HUB_PAYLOAD || '').trim();
    return override
        ? path.resolve(override)
        : path.join(PROJECT_ROOT, 'desktop-runtime', 'current', 'browser-hub');
}

let hubClientPromise = null;

/**
 * 确保系统共享 Hub 已安装并运行。
 *
 * Electron 会在启动后端前调用同一份 SDK；这里再兜底一次，是为了让普通
 * `npm run dev` / `npm run server` 也保持完整的浏览器能力。
 */
export function ensureSharedBrowserHub(environment = process.env) {
    if (!hubClientPromise) {
        hubClientPromise = (async () => {
            const payloadDir = browserHubPayloadPath(environment);
            const sdkPath = path.join(payloadDir, 'server', 'sdk', 'node.mjs');
            try {
                await fs.access(sdkPath);
                const sdk = await import(pathToFileURL(sdkPath).href);
                return await sdk.ensureHub(payloadDir, { env: environment });
            } catch (error) {
                const wrapped = new Error(`共享浏览器组件启动失败：${error.message}`);
                wrapped.code = error.code || 'BROWSER_HUB_UNAVAILABLE';
                wrapped.sessionState = 'browser_unavailable';
                wrapped.cause = error;
                throw wrapped;
            }
        })().catch(error => {
            hubClientPromise = null;
            throw error;
        });
    }
    return hubClientPromise;
}
