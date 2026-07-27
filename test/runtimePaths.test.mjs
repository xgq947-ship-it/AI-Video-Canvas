import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { defaultBrowserProfileDir, resolveRuntimePaths } from '../server/runtime/paths.js';

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

test('开发模式的专属 Chrome Profile 落在桌面应用的 userData，而不是项目目录', () => {
    // 登录资料是用户数据，不该随「后端从哪个目录启动」而变。
    // 此前 dev 模式没有 EVAN_DATA_DIR，dataDir 回退成项目根目录，Profile 跟着落到
    // <项目目录>/browser-profile；而 opsCliRunner 会把它当 SESSIONHUB_CHROME_PROFILE
    // 传给 Python，**覆盖掉** Python 侧本来正确的 userData 默认值。
    // 结果：用户在桌面应用里已登录即梦/Flow，npm run dev 却一直报
    // 「尚未创建 Evan 专属 Chrome 登录资料」，还会另起一个空 Profile 抢占 19222。
    const homeDir = path.resolve('/Users/demo');
    const paths = resolveRuntimePaths({}, {
        projectRoot: path.resolve('/checkout'),
        platform: 'darwin',
        homeDir
    });

    assert.equal(
        paths.browserProfileDir,
        path.join(homeDir, 'Library', 'Application Support', 'Evan AI Video Canvas', 'data', 'browser-profile')
    );
    assert.notEqual(paths.browserProfileDir, path.join(path.resolve('/checkout'), 'browser-profile'));
});

test('各平台的默认 Profile 路径与 Python 侧 _default_profile_dir 保持一致', () => {
    // 两侧只要有一处算错，Node 传下去的 SESSIONHUB_CHROME_PROFILE 就会覆盖掉 Python
    // 的正确值，症状是「明明登录过却查不到登录」。
    const homeDir = path.resolve('/home/demo');
    assert.equal(
        defaultBrowserProfileDir({}, { platform: 'win32', homeDir }),
        path.join(homeDir, 'AppData', 'Roaming', 'Evan AI Video Canvas', 'data', 'browser-profile')
    );
    assert.equal(
        defaultBrowserProfileDir({ APPDATA: path.resolve('/roaming') }, { platform: 'win32', homeDir }),
        path.join(path.resolve('/roaming'), 'Evan AI Video Canvas', 'data', 'browser-profile')
    );
    assert.equal(
        defaultBrowserProfileDir({}, { platform: 'linux', homeDir }),
        path.join(homeDir, '.config', 'Evan AI Video Canvas', 'data', 'browser-profile')
    );
});

test('打包应用显式给了数据目录时，Profile 仍跟随数据目录', () => {
    // 桌面模式必须保持「可写用户数据集中在 dataDir」的边界，不能被上面的默认值改写。
    const dataDir = path.resolve('/Users/demo/Library/Application Support/Evan/data');
    const paths = resolveRuntimePaths({ EVAN_DATA_DIR: dataDir }, {
        projectRoot: path.resolve('/checkout'),
        platform: 'darwin',
        homeDir: path.resolve('/Users/demo')
    });
    assert.equal(paths.browserProfileDir, path.join(dataDir, 'browser-profile'));
});

test('三处应用名保持一致：productName / Node 默认值 / Python 默认值', () => {
    // Electron 的 app.getPath('userData') 用的是 package.json 的 productName。
    // 改名而这三处没同步，桌面应用的 userData 会搬家，Node 与 Python 却仍指向旧目录 ——
    // 症状正是「明明在桌面应用里登录过，却报尚未创建 Evan 专属 Chrome 登录资料」，
    // 而且不会有任何报错，纯靠人去猜。这是本仓库诊断成本最高的一类故障。
    const productName = JSON.parse(
        fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ).productName;
    assert.ok(productName, 'package.json 缺少 productName');

    assert.equal(
        defaultBrowserProfileDir({}, { platform: 'darwin', homeDir: path.resolve('/Users/demo') }),
        path.join(
            path.resolve('/Users/demo'),
            'Library', 'Application Support', productName, 'data', 'browser-profile'
        ),
        'Node 侧默认 Profile 路径与 package.json 的 productName 不一致'
    );

    const chromeRuntime = fs.readFileSync(
        new URL('../server/python/sessionhub/scene/chrome_cdp.py', import.meta.url), 'utf8'
    );
    assert.ok(
        chromeRuntime.includes(`app_name = "${productName}"`),
        `chrome_cdp.py 的 app_name 与 productName（${productName}）不一致`
    );
    // Python 侧同样要落在 data/browser-profile，否则两侧只差一层目录也会失联。
    assert.match(chromeRuntime, /return base \/ "data" \/ "browser-profile"/);
});
