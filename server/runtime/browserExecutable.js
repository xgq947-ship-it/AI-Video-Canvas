import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const MIN_SUPPORTED_CHROME_MAJOR = 136;
export const CHROME_DOWNLOAD_URL = 'https://www.google.com/chrome/';

function unique(values) {
    return [...new Set(values.filter(Boolean).map(value => path.resolve(value)))];
}

export function systemChromeCandidates(environment = process.env, {
    platform = process.platform,
    homeDir = os.homedir()
} = {}) {
    const explicit = String(
        environment.EVAN_CHROME_EXECUTABLE
        || environment.EVAN_BROWSER_EXECUTABLE
        || environment.SESSIONHUB_CHROME_APP
        || ''
    ).trim();

    if (platform === 'darwin') {
        return unique([
            explicit,
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            path.join(homeDir, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome')
        ]);
    }
    if (platform === 'win32') {
        return unique([
            explicit,
            environment.PROGRAMFILES && path.join(environment.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            environment['PROGRAMFILES(X86)'] && path.join(environment['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
            environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
        ]);
    }
    return unique([
        explicit,
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/opt/google/chrome/google-chrome'
    ]);
}

export function resolveSystemChromeExecutable(environment = process.env, options = {}) {
    return systemChromeCandidates(environment, options)
        .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || '';
}

export function parseChromeVersion(output) {
    const match = String(output || '').match(/(?:Google Chrome|Chrome)\s+(\d+)(?:\.(\d+)){0,3}/i);
    if (!match) return null;
    return {
        version: String(output).trim().replace(/^Google Chrome\s+/i, ''),
        major: Number(match[1])
    };
}

export function probeSystemChromeCompatibility(environment = process.env, {
    platform = process.platform,
    homeDir = os.homedir(),
    spawnSyncImpl = spawnSync,
    minMajor = MIN_SUPPORTED_CHROME_MAJOR
} = {}) {
    const executable = resolveSystemChromeExecutable(environment, { platform, homeDir });
    if (!executable) {
        return {
            ready: false,
            executable: '',
            version: null,
            major: null,
            reason: 'not-installed',
            message: '未找到 Google Chrome，请先安装后重新打开 Evan。',
            downloadUrl: CHROME_DOWNLOAD_URL
        };
    }

    const result = spawnSyncImpl(executable, ['--version'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5_000
    });
    const parsed = parseChromeVersion(`${result.stdout || ''}${result.stderr || ''}`);
    if (result.error || result.status !== 0 || !parsed) {
        return {
            ready: false,
            executable,
            version: null,
            major: null,
            reason: 'probe-failed',
            message: 'Google Chrome 已安装，但 Evan 无法读取其版本。',
            downloadUrl: CHROME_DOWNLOAD_URL
        };
    }
    if (parsed.major < minMajor) {
        return {
            ready: false,
            executable,
            ...parsed,
            reason: 'unsupported-version',
            message: `Google Chrome ${parsed.version} 版本过低，请更新到 ${minMajor} 或更高版本。`,
            downloadUrl: CHROME_DOWNLOAD_URL
        };
    }
    return {
        ready: true,
        executable,
        ...parsed,
        reason: null,
        message: `Google Chrome ${parsed.version} 可用`,
        downloadUrl: CHROME_DOWNLOAD_URL
    };
}

// 兼容旧调用方；运行时已经不再解析 Playwright 下载目录。
export const resolveBundledBrowserExecutable = resolveSystemChromeExecutable;

// ---------------------------------------------------------------------------
// 带缓存的探针
//
// probeSystemChromeCompatibility 内部是 spawnSync(chrome, ['--version'])，会**同步
// 阻塞整个事件循环**，超时上限 5 秒。而它被挂在了热路径上：opsEnvironment() 每次
// spawn 都调一次（含每个重试尝试），ensureReady() 每次 runOpsCli 也调一次。一次生成
// 因此要付 2~4 次阻塞式 Chrome 启动，期间后端无法响应生成状态轮询、保存等请求。
//
// 更要命的是退出路径：closeBrowserForShutdown 先探针（最多 5 秒）再关浏览器（8 秒），
// 合计可能超过 desktop-entry.js 的 9.5 秒硬退出 —— Chrome 没关成就被强杀，
// 正好破坏这批改动要保证的事情。
//
// Chrome 的安装路径和版本在应用运行期间几乎不变，所以缓存结果。用户中途安装/升级
// Chrome 的场景由 chrome:retry 显式 force 刷新覆盖。
// ---------------------------------------------------------------------------

/** 探到「可用」时缓存久一点：这个结论在一次会话里基本不会翻转。 */
const CHROME_READY_TTL_MS = 5 * 60_000;
/**
 * 探到「不可用」只缓存几秒。
 *
 * probe-failed 可能只是 Windows 杀软拖慢了一次 --version（撞 5 秒超时）。
 * 把这种瞬时失败缓存几分钟，会让 Flow/即梦所有模型平白置灰一整段时间。
 */
const CHROME_NOT_READY_TTL_MS = 3_000;

let cachedChromeProbe = null;

/**
 * 读取 Chrome 兼容性，默认走缓存。
 *
 * @param {NodeJS.ProcessEnv} [environment]
 * @param {{ force?: boolean, now?: () => number }} [options] force 用于用户刚装完 Chrome 的重新检测
 */
export function getChromeCompatibility(
    environment = process.env,
    { force = false, now = Date.now, ...probeOptions } = {}
) {
    const timestamp = now();
    if (!force && cachedChromeProbe) {
        const ttl = cachedChromeProbe.status.ready ? CHROME_READY_TTL_MS : CHROME_NOT_READY_TTL_MS;
        if (timestamp - cachedChromeProbe.at < ttl) return cachedChromeProbe.status;
    }
    const status = probeSystemChromeCompatibility(environment, probeOptions);
    cachedChromeProbe = { at: timestamp, status };
    return status;
}

/** 丢弃缓存，下次读取重新探测。 */
export function invalidateChromeCompatibility() {
    cachedChromeProbe = null;
}
