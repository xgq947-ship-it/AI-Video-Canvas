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
