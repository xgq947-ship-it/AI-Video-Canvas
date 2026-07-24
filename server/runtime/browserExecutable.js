import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PROJECT_ROOT } from './paths.js';

const executableSuffixes = {
    darwin: [
        path.join('chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        path.join('chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
    ],
    win32: [
        path.join('chrome-win64', 'chrome.exe'),
        path.join('chrome-win', 'chrome.exe')
    ],
    linux: [
        path.join('chrome-linux64', 'chrome'),
        path.join('chrome-linux', 'chrome')
    ]
};

export function resolveBundledBrowserExecutable(environment = process.env, {
    platform = process.platform,
    projectRoot = DEFAULT_PROJECT_ROOT
} = {}) {
    const explicit = String(
        environment.EVAN_BROWSER_EXECUTABLE || environment.SESSIONHUB_CHROME_APP || ''
    ).trim();
    if (explicit) return path.resolve(explicit);

    const browsersRoot = path.resolve(
        String(environment.PLAYWRIGHT_BROWSERS_PATH || '').trim()
        || path.join(projectRoot, 'server', 'python', '.browsers')
    );
    if (!fs.existsSync(browsersRoot)) return '';

    const chromiumDirs = fs.readdirSync(browsersRoot)
        .filter((name) => name.startsWith('chromium-'))
        .sort()
        .reverse();
    for (const directory of chromiumDirs) {
        for (const suffix of executableSuffixes[platform] || []) {
            const candidate = path.join(browsersRoot, directory, suffix);
            if (fs.existsSync(candidate)) return candidate;
        }
    }
    return '';
}
