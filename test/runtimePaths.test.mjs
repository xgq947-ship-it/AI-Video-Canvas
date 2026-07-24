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
    const paths = resolveRuntimePaths({
        EVAN_RESOURCES_DIR: '/Applications/Evan.app/Contents/Resources',
        EVAN_DATA_DIR: '/Users/demo/Library/Application Support/Evan'
    }, { projectRoot: '/checkout' });

    assert.equal(paths.distDir, '/Applications/Evan.app/Contents/Resources/dist');
    assert.equal(paths.pythonRoot, '/Applications/Evan.app/Contents/Resources/server/python');
    assert.equal(paths.libraryDir, '/Users/demo/Library/Application Support/Evan/library');
    assert.equal(paths.browserProfileDir, '/Users/demo/Library/Application Support/Evan/browser-profile');
});

test('显式目录支持相对于对应根目录解析', () => {
    const paths = resolveRuntimePaths({
        EVAN_RESOURCES_DIR: '/opt/evan/resources',
        EVAN_DATA_DIR: '/var/evan',
        EVAN_LIBRARY_DIR: 'media',
        EVAN_PYTHON_ROOT: 'automation/python'
    }, { projectRoot: '/checkout' });

    assert.equal(paths.libraryDir, '/var/evan/media');
    assert.equal(paths.pythonRoot, '/opt/evan/resources/automation/python');
});
