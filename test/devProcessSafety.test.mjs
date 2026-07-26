import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const electronMain = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');

test('开发服务端口冲突时整组退出，不产生隐藏的重复画布进程', () => {
    assert.match(pkg.scripts.dev, /--kill-others-on-fail/);
    assert.match(pkg.scripts.dev, /vite --strictPort/);
});

test('Electron 使用单实例锁，重复启动只聚焦现有窗口', () => {
    assert.match(electronMain, /app\.requestSingleInstanceLock\(\)/);
    assert.match(electronMain, /app\.on\('second-instance'/);
    assert.match(electronMain, /mainWindow\.focus\(\)/);
});

test('Electron 后台异常退出时有限次自动重启并重新加载页面', () => {
    assert.match(electronMain, /const BACKEND_RESTART_LIMIT = 3/);
    assert.match(electronMain, /scheduleBackendRestart\(code\)/);
    assert.match(electronMain, /if \(!shuttingDown && !backendProcess\) launchBackend\(\)/);
    assert.match(electronMain, /loadBackendOrigin\(message\.origin\)/);
    assert.match(electronMain, /backendCrashTimes\.length > BACKEND_RESTART_LIMIT/);
});

test('主窗口先隐藏、ready-to-show 后再显示，避免启动闪白', () => {
    // show: true 会让窗口立刻绘制一帧空白/未样式化内容，也让 ready-to-show 失去意义。
    assert.match(electronMain, /^\s+show: false,/m);
    assert.doesNotMatch(electronMain, /^\s+show: true,/m);
    assert.match(electronMain, /once\('ready-to-show'/);
    // ready-to-show 万一不来，也必须有兜底显示，否则用户对着空气等。
    assert.match(electronMain, /if \(mainWindow && !mainWindow\.isVisible\(\)\) mainWindow\.show\(\)/);
});

test('后端就绪时不抢焦点，只在窗口尚未显示时才显示', () => {
    // 后端就绪可能是启动后好几秒的事；用户此时可能已经切去别的应用。
    const loadBackendOrigin = electronMain.slice(
        electronMain.indexOf('function loadBackendOrigin'),
        electronMain.indexOf('function launchBackend')
    );
    assert.ok(loadBackendOrigin.length > 0, '没找到 loadBackendOrigin');
    assert.doesNotMatch(loadBackendOrigin, /app\.focus\(\{ steal: true \}\)/);
    assert.match(loadBackendOrigin, /!mainWindow\.isVisible\(\)/);
});

test('退出时会主动关掉常驻的无头浏览器', () => {
    // 无头 Chromium 是 detached 启动的，不主动关就会在用户退出 Evan 之后继续占内存。
    const desktopEntry = fs.readFileSync(new URL('../server/desktop-entry.js', import.meta.url), 'utf8');
    assert.match(desktopEntry, /closeBrowserForShutdown/);
    // 关闭浏览器不能拖死退出流程：Electron 主进程只给 5.5 秒。
    assert.match(desktopEntry, /setTimeout\(\(\) => process\.exit\(1\), 4_500\)/);
});
