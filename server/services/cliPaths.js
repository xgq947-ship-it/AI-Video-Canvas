import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const CHATGPT_CODEX_PATH = '/Applications/ChatGPT.app/Contents/Resources/codex';
const DEFAULT_PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let runtimeCodexPath = '';

export function setRuntimeCodexPath(value = '') {
    runtimeCodexPath = String(value || '').trim();
}

export function getProjectCliPath(projectRoot, cliName, platform = process.platform) {
    const executable = platform === 'win32' ? `${cliName}.cmd` : cliName;
    return path.join(projectRoot, 'node_modules', '.bin', executable);
}

export function getManagedCliPath(projectRoot, cliName, platform = process.platform) {
    const executable = platform === 'win32' ? `${cliName}.cmd` : cliName;
    return path.join(projectRoot, '.local-ai-cli', 'node_modules', '.bin', executable);
}

function firstExisting(candidates, exists = fs.existsSync) {
    return candidates.find(candidate => candidate && exists(candidate)) || '';
}

function executableCandidatesFromPath(cliName, environment, platform) {
    const delimiter = platform === 'win32' ? ';' : ':';
    const directories = String(environment.PATH || '')
        .split(delimiter)
        .map(value => value.trim())
        .filter(Boolean);
    const filenames = platform === 'win32'
        ? [`${cliName}.cmd`, `${cliName}.exe`, `${cliName}.bat`, cliName]
        : [cliName];
    return directories.flatMap(directory => filenames.map(filename => path.join(directory, filename)));
}

export function resolveCodexBin({
    projectRoot = DEFAULT_PROJECT_ROOT,
    configuredPath = '',
    environment = process.env,
    platform = process.platform,
    exists = fs.existsSync
} = {}) {
    if (configuredPath) return configuredPath;
    if (runtimeCodexPath) return runtimeCodexPath;
    if (environment.CODEX_CLI_PATH) return environment.CODEX_CLI_PATH;
    const homeDir = environment.HOME || environment.USERPROFILE || os.homedir();
    return firstExisting([
        ...executableCandidatesFromPath('codex', environment, platform),
        platform === 'darwin' ? path.join(homeDir, '.local', 'bin', 'codex') : '',
        platform === 'darwin' ? path.join(homeDir, '.npm-global', 'bin', 'codex') : '',
        platform === 'darwin' ? '/opt/homebrew/bin/codex' : '',
        platform === 'darwin' ? '/usr/local/bin/codex' : '',
        platform === 'win32' && environment.APPDATA
            ? path.join(environment.APPDATA, 'npm', 'codex.cmd')
            : '',
        getManagedCliPath(projectRoot, 'codex', platform),
        getProjectCliPath(projectRoot, 'codex', platform),
        platform === 'darwin' ? CHATGPT_CODEX_PATH : ''
    ], exists) || 'codex';
}

export function resolveClaudeBin({
    projectRoot = DEFAULT_PROJECT_ROOT,
    configuredPath = '',
    environment = process.env,
    platform = process.platform,
    exists = fs.existsSync
} = {}) {
    if (configuredPath) return configuredPath;
    if (environment.CLAUDE_CLI_PATH) return environment.CLAUDE_CLI_PATH;
    return firstExisting([
        getManagedCliPath(projectRoot, 'claude', platform),
        getProjectCliPath(projectRoot, 'claude', platform)
    ], exists) || 'claude';
}
