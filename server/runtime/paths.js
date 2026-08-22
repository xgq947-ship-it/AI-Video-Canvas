import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROJECT_ROOT = path.resolve(RUNTIME_DIR, '..', '..');

const BROWSER_HUB_VENDOR = 'SankaiAI';
const BROWSER_HUB_NAME = 'AI Browser Hub';

/**
 * 系统共享 AI Browser Hub 的持久 Profile；它独立于任何单个 App 的 userData。
 */
export function defaultBrowserProfileDir(environment = process.env, {
    platform = process.platform,
    homeDir = os.homedir()
} = {}) {
    const base = platform === 'darwin'
        ? path.join(homeDir, 'Library', 'Application Support', BROWSER_HUB_VENDOR, BROWSER_HUB_NAME)
        : platform === 'win32'
            ? path.join(
                String(environment.LOCALAPPDATA || '').trim() || path.join(homeDir, 'AppData', 'Local'),
                BROWSER_HUB_VENDOR,
                BROWSER_HUB_NAME
            )
            : path.join(
                String(environment.XDG_DATA_HOME || '').trim() || path.join(homeDir, '.local', 'share'),
                'sankaiai',
                'ai-browser-hub'
            );
    return path.join(base, 'data', 'profile-v1');
}

const absoluteFrom = (value, fallback, base) => {
    const candidate = String(value || '').trim();
    if (!candidate) return path.resolve(fallback);
    return path.resolve(base, candidate);
};

/**
 * Resolve all filesystem roots used by the backend.
 *
 * Development keeps the historical repository layout. The packaged desktop
 * process injects EVAN_RESOURCES_DIR and EVAN_DATA_DIR so replaceable app
 * resources never contain writable user data.
 */
export function resolveRuntimePaths(environment = process.env, {
    projectRoot = DEFAULT_PROJECT_ROOT,
    platform = process.platform,
    homeDir = os.homedir()
} = {}) {
    const normalizedProjectRoot = path.resolve(projectRoot);
    const resourcesDir = absoluteFrom(
        environment.EVAN_RESOURCES_DIR,
        normalizedProjectRoot,
        normalizedProjectRoot
    );
    const dataDir = absoluteFrom(
        environment.EVAN_DATA_DIR,
        normalizedProjectRoot,
        normalizedProjectRoot
    );
    const libraryDir = absoluteFrom(
        environment.EVAN_LIBRARY_DIR || environment.LIBRARY_DIR,
        path.join(dataDir, 'library'),
        dataDir
    );
    const pythonRoot = absoluteFrom(
        environment.EVAN_PYTHON_ROOT,
        path.join(resourcesDir, 'server', 'python'),
        resourcesDir
    );

    return Object.freeze({
        projectRoot: normalizedProjectRoot,
        resourcesDir,
        dataDir,
        libraryDir,
        logsDir: absoluteFrom(environment.EVAN_LOGS_DIR, path.join(dataDir, 'logs'), dataDir),
        runtimeDir: absoluteFrom(environment.EVAN_RUNTIME_DIR, path.join(dataDir, 'runtime'), dataDir),
        // 显式测试覆盖 > 系统共享 Hub Profile。业务 App 的 dataDir 不拥有登录资料。
        browserProfileDir: absoluteFrom(
            environment.EVAN_BROWSER_PROFILE_DIR,
            defaultBrowserProfileDir(environment, { platform, homeDir }),
            dataDir
        ),
        pythonRoot,
        // 旧版 Flow DOM provider 会把失败截图写进用户桌面的「GoogleFlow诊断」。
        // 任何可能拉起它的进程都必须带上这个重定向，否则用户桌面上就会多一个文件夹。
        googleFlowDiagnosticsDir: absoluteFrom(
            environment.GOOGLE_FLOW_DIAG_DIR,
            path.join(
                absoluteFrom(environment.EVAN_LOGS_DIR, path.join(dataDir, 'logs'), dataDir),
                'google-flow-diagnostics',
            ),
            dataDir
        ),
        distDir: path.join(resourcesDir, 'dist'),
        remotionDir: path.join(resourcesDir, 'remotion')
    });
}

export const RUNTIME_PATHS = resolveRuntimePaths();
