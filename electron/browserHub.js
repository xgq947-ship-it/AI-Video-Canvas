import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
            return sdk.ensureHub(payloadDir);
        })().catch(error => {
            clientPromise = null;
            throw error;
        });
    }
    return clientPromise;
}
