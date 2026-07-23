import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const CHATGPT_CODEX_PATH = '/Applications/ChatGPT.app/Contents/Resources/codex';
const DEFAULT_PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

export function resolveCodexBin({
    projectRoot = DEFAULT_PROJECT_ROOT,
    configuredPath = '',
    environment = process.env,
    platform = process.platform,
    exists = fs.existsSync
} = {}) {
    if (configuredPath) return configuredPath;
    if (environment.CODEX_CLI_PATH) return environment.CODEX_CLI_PATH;
    return firstExisting([
        platform === 'darwin' ? CHATGPT_CODEX_PATH : '',
        getManagedCliPath(projectRoot, 'codex', platform),
        getProjectCliPath(projectRoot, 'codex', platform)
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
