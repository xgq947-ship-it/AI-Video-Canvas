import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveUninstallTargets } from '../electron/uninstall.js';

const MAC = {
    userDataDir: '/Users/tester/Library/Application Support/Evan AI Video Canvas',
    exePath: '/Applications/Evan AI Video Canvas.app/Contents/MacOS/Evan AI Video Canvas',
    platform: 'darwin',
    isPackaged: true
};

test('macOS 打包版：保留数据时只扔应用本体', () => {
    const plan = resolveUninstallTargets({ ...MAC, keepUserData: true });
    assert.equal(plan.supported, true);
    assert.deepEqual(plan.targets.map(target => target.path), [
        '/Applications/Evan AI Video Canvas.app'
    ]);
});

test('macOS 打包版：不保留数据时先扔数据再扔应用本体', () => {
    const plan = resolveUninstallTargets({ ...MAC, keepUserData: false });
    assert.equal(plan.supported, true);
    // 顺序有意义：应用本体被移走后再去算数据路径就没意义了。
    assert.deepEqual(plan.targets.map(target => target.path), [
        MAC.userDataDir,
        '/Applications/Evan AI Video Canvas.app'
    ]);
});

test('开发模式没有可卸载的应用包，且不返回任何删除目标', () => {
    const plan = resolveUninstallTargets({ ...MAC, isPackaged: false, keepUserData: false });
    assert.equal(plan.supported, false);
    assert.deepEqual(plan.targets, []);
    assert.match(plan.hint, /开发模式/);
});

test('Windows 交给系统卸载入口，不假装支持', () => {
    const plan = resolveUninstallTargets({
        userDataDir: 'C:\\Users\\tester\\AppData\\Roaming\\Evan',
        exePath: 'C:\\Program Files\\Evan\\Evan.exe',
        platform: 'win32',
        isPackaged: true,
        keepUserData: false
    });
    assert.equal(plan.supported, false);
    assert.deepEqual(plan.targets, []);
    assert.match(plan.hint, /已安装的应用/);
});

test('认不出 .app 位置时拒绝执行，而不是去扔一个猜出来的目录', () => {
    const plan = resolveUninstallTargets({
        ...MAC,
        exePath: '/usr/local/bin/evan',
        keepUserData: false
    });
    assert.equal(plan.supported, false);
    assert.deepEqual(plan.targets, []);
});
