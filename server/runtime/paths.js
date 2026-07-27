import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROJECT_ROOT = path.resolve(RUNTIME_DIR, '..', '..');

// 必须与 package.json 的 productName、Electron 的 app.getPath('userData')
// 以及 Python 侧 chrome_cdp._default_profile_dir() 三处一致。
const DESKTOP_APP_NAME = 'Evan AI Video Canvas';

/**
 * 桌面应用 userData 下的「Evan 专属 Chrome」Profile。
 *
 * 登录资料是用户数据，不该随「后端从哪个目录启动」而变。开发模式下没有
 * EVAN_DATA_DIR，dataDir 会回退成项目根目录，此前 Profile 也跟着落到
 * <项目目录>/browser-profile —— 而 Python 侧的默认值本来就是 userData。
 * 由于 opsCliRunner 会把这个值当作 SESSIONHUB_CHROME_PROFILE 传下去，
 * Node 的错误默认值反而**覆盖掉**了 Python 的正确默认值，结果是：
 * 用户在桌面应用里已经登录了即梦/Flow，`npm run dev` 却始终报
 * 「尚未创建 Evan 专属 Chrome 登录资料」，还会另起一个空 Profile 抢占 19222。
 * 这里改成和 Python 默认值对齐，两侧同源。
 */
export function defaultBrowserProfileDir(environment = process.env, {
    platform = process.platform,
    homeDir = os.homedir()
} = {}) {
    const base = platform === 'darwin'
        ? path.join(homeDir, 'Library', 'Application Support')
        : platform === 'win32'
            ? (String(environment.APPDATA || '').trim() || path.join(homeDir, 'AppData', 'Roaming'))
            : (String(environment.XDG_CONFIG_HOME || '').trim() || path.join(homeDir, '.config'));
    return path.join(base, DESKTOP_APP_NAME, 'data', 'browser-profile');
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
        // 显式配置 > 显式数据目录（打包应用两者都会给）> 桌面 userData 默认值。
        // 只有开发模式两个环境变量都没有，才落到 userData，从而与桌面应用共用一份登录。
        browserProfileDir: absoluteFrom(
            environment.EVAN_BROWSER_PROFILE_DIR,
            String(environment.EVAN_DATA_DIR || '').trim()
                ? path.join(dataDir, 'browser-profile')
                : defaultBrowserProfileDir(environment, { platform, homeDir }),
            dataDir
        ),
        pythonRoot,
        distDir: path.join(resourcesDir, 'dist'),
        remotionDir: path.join(resourcesDir, 'remotion')
    });
}

export const RUNTIME_PATHS = resolveRuntimePaths();
