import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { RUNTIME_PATHS } from '../server/runtime/paths.js';

export function sharedBrowserHubHome(environment = process.env, {
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

export function browserHubPayloadPath({ isPackaged, resourcesPath, projectRoot }) {
    return isPackaged
        ? path.join(resourcesPath, 'browser-hub')
        : path.join(projectRoot, 'desktop-runtime', 'current', 'browser-hub');
}

let clientPromise = null;

export function ensureBrowserHubRuntime({ isPackaged, resourcesPath, projectRoot }) {
    if (!clientPromise) {
        clientPromise = (async () => {
            const payloadDir = browserHubPayloadPath({ isPackaged, resourcesPath, projectRoot });
            const sdkUrl = pathToFileURL(path.join(payloadDir, 'server', 'sdk', 'node.mjs')).href;
            const sdk = await import(sdkUrl);
            // Hub 守护进程只在首次拉起时取一次环境。旧版 Flow DOM provider 会把失败
            // 截图写到用户桌面的「GoogleFlow诊断」；opsCliRunner 只给自己的子进程做了
            // 重定向，Hub 这条链路一直是裸的 process.env。
            return sdk.ensureHub(payloadDir, {
                env: {
                    ...process.env,
                    GOOGLE_FLOW_DIAG_DIR: RUNTIME_PATHS.googleFlowDiagnosticsDir,
                },
            });
        })().catch(error => {
            clientPromise = null;
            throw error;
        });
    }
    return clientPromise;
}
