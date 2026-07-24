import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DEFAULT_PROJECT_ROOT } from './paths.js';

const require = createRequire(import.meta.url);

let bundledTools = null;
try {
    bundledTools = require('ffmpeg-ffprobe-static');
} catch {
    // Packaged desktop builds receive explicit paths from Electron.
}

export const resolveMediaToolPaths = (environment = process.env, {
    projectRoot = DEFAULT_PROJECT_ROOT,
    tools = bundledTools,
    platform = process.platform
} = {}) => {
    const extension = platform === 'win32' ? '.exe' : '';
    const packageRoot = path.join(projectRoot, 'node_modules', 'ffmpeg-ffprobe-static');
    const resolveExecutable = (environmentKey, bundledKey, filename) => {
        const explicit = String(environment[environmentKey] || '').trim();
        if (explicit) return path.resolve(explicit);
        const bundled = String(tools?.[bundledKey] || '').trim();
        if (bundled && fs.existsSync(bundled)) return bundled;
        return path.join(packageRoot, `${filename}${extension}`);
    };
    return Object.freeze({
        ffmpeg: resolveExecutable('EVAN_FFMPEG_PATH', 'ffmpegPath', 'ffmpeg'),
        ffprobe: resolveExecutable('EVAN_FFPROBE_PATH', 'ffprobePath', 'ffprobe')
    });
};

export const mediaToolPaths = resolveMediaToolPaths();
export const FFMPEG_PATH = mediaToolPaths.ffmpeg;
export const FFPROBE_PATH = mediaToolPaths.ffprobe;
