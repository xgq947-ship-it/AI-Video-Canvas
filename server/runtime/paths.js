import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROJECT_ROOT = path.resolve(RUNTIME_DIR, '..', '..');

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
    projectRoot = DEFAULT_PROJECT_ROOT
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
        browserProfileDir: absoluteFrom(
            environment.EVAN_BROWSER_PROFILE_DIR,
            path.join(dataDir, 'browser-profile'),
            dataDir
        ),
        pythonRoot,
        distDir: path.join(resourcesDir, 'dist'),
        remotionDir: path.join(resourcesDir, 'remotion')
    });
}

export const RUNTIME_PATHS = resolveRuntimePaths();
