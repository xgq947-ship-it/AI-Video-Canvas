import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { defaultBrowserProfileDir, resolveRuntimePaths } from '../server/runtime/paths.js';

test('开发模式保持仓库内现有资源与素材目录布局', () => {
    const projectRoot = path.resolve('/tmp/evan-project');
    const paths = resolveRuntimePaths({}, { projectRoot });
    assert.equal(paths.resourcesDir, projectRoot);
    assert.equal(paths.dataDir, projectRoot);
    assert.equal(paths.libraryDir, path.join(projectRoot, 'library'));
    assert.equal(paths.pythonRoot, path.join(projectRoot, 'server', 'python'));
});

test('桌面模式把只读资源、App 数据和共享浏览器资料分离', () => {
    const resourcesDir = path.resolve('/Applications/Evan.app/Contents/Resources');
    const dataDir = path.resolve('/Users/demo/Library/Application Support/Evan');
    const homeDir = path.resolve('/Users/demo');
    const paths = resolveRuntimePaths({
        EVAN_RESOURCES_DIR: resourcesDir,
        EVAN_DATA_DIR: dataDir
    }, { projectRoot: path.resolve('/checkout'), platform: 'darwin', homeDir });

    assert.equal(paths.distDir, path.join(resourcesDir, 'dist'));
    assert.equal(paths.pythonRoot, path.join(resourcesDir, 'server', 'python'));
    assert.equal(paths.libraryDir, path.join(dataDir, 'library'));
    assert.equal(
        paths.browserProfileDir,
        path.join(homeDir, 'Library', 'Application Support', 'SankaiAI', 'AI Browser Hub', 'data', 'profile-v1')
    );
    assert.equal(paths.browserProfileDir.startsWith(dataDir), false);
});

test('显式资源与素材目录仍支持相对路径', () => {
    const resourcesDir = path.resolve('/opt/evan/resources');
    const dataDir = path.resolve('/var/evan');
    const paths = resolveRuntimePaths({
        EVAN_RESOURCES_DIR: resourcesDir,
        EVAN_DATA_DIR: dataDir,
        EVAN_LIBRARY_DIR: 'media',
        EVAN_PYTHON_ROOT: 'automation/python'
    }, { projectRoot: path.resolve('/checkout') });
    assert.equal(paths.libraryDir, path.join(dataDir, 'media'));
    assert.equal(paths.pythonRoot, path.join(resourcesDir, 'automation', 'python'));
});

test('macOS、Windows 与 Linux 都使用系统级共享 Profile', () => {
    const homeDir = path.resolve('/Users/demo');
    assert.equal(
        defaultBrowserProfileDir({}, { platform: 'darwin', homeDir }),
        path.join(homeDir, 'Library', 'Application Support', 'SankaiAI', 'AI Browser Hub', 'data', 'profile-v1')
    );
    assert.equal(
        defaultBrowserProfileDir({ LOCALAPPDATA: path.resolve('/local') }, { platform: 'win32', homeDir }),
        path.join(path.resolve('/local'), 'SankaiAI', 'AI Browser Hub', 'data', 'profile-v1')
    );
    assert.equal(
        defaultBrowserProfileDir({}, { platform: 'linux', homeDir }),
        path.join(homeDir, '.local', 'share', 'sankaiai', 'ai-browser-hub', 'data', 'profile-v1')
    );
});

test('App dataDir 改变不会搬走或复制共享登录态', () => {
    const homeDir = path.resolve('/Users/demo');
    const paths = resolveRuntimePaths({ EVAN_DATA_DIR: path.resolve('/custom/evan-data') }, {
        projectRoot: path.resolve('/checkout'),
        platform: 'darwin',
        homeDir
    });
    assert.equal(
        paths.browserProfileDir,
        path.join(homeDir, 'Library', 'Application Support', 'SankaiAI', 'AI Browser Hub', 'data', 'profile-v1')
    );
});

test('测试环境仍可显式覆盖 Profile，但生产默认不读取旧 App Profile', () => {
    const explicit = path.resolve('/tmp/hub-test-profile');
    const paths = resolveRuntimePaths({ EVAN_BROWSER_PROFILE_DIR: explicit }, {
        projectRoot: path.resolve('/checkout')
    });
    assert.equal(paths.browserProfileDir, explicit);

    const chromeRuntime = fs.readFileSync(
        new URL('../server/python/sessionhub/scene/chrome_cdp.py', import.meta.url), 'utf8'
    );
    assert.match(chromeRuntime, /"SankaiAI" \/ "AI Browser Hub"/);
    assert.match(chromeRuntime, /return base \/ "data" \/ "profile-v1"/);
});
