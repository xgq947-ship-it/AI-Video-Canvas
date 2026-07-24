import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveRuntimePaths } from '../server/runtime/paths.js';

test('开发模式保持仓库内现有目录布局', () => {
    const projectRoot = path.resolve('/tmp/evan-project');
    const paths = resolveRuntimePaths({}, { projectRoot });

    assert.equal(paths.resourcesDir, projectRoot);
    assert.equal(paths.dataDir, projectRoot);
    assert.equal(paths.libraryDir, path.join(projectRoot, 'library'));
    assert.equal(paths.pythonRoot, path.join(projectRoot, 'server', 'python'));
});

test('桌面模式把只读资源与可写用户数据彻底分离', () => {
    const resourcesDir = path.resolve('/Applications/Evan.app/Contents/Resources');
    const dataDir = path.resolve('/Users/demo/Library/Application Support/Evan');
    const paths = resolveRuntimePaths({
        EVAN_RESOURCES_DIR: resourcesDir,
        EVAN_DATA_DIR: dataDir
    }, { projectRoot: path.resolve('/checkout') });

    assert.equal(paths.distDir, path.join(resourcesDir, 'dist'));
    assert.equal(paths.pythonRoot, path.join(resourcesDir, 'server', 'python'));
    assert.equal(paths.libraryDir, path.join(dataDir, 'library'));
    assert.equal(paths.browserProfileDir, path.join(dataDir, 'browser-profile'));
});

test('显式目录支持相对于对应根目录解析', () => {
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
