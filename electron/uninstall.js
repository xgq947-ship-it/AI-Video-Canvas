/**
 * 卸载计划：把「要移到废纸篓的东西」算成一个纯函数，方便在不真的删任何东西的
 * 前提下测试和预览。
 *
 * 用废纸篓而不是 rm -rf：卸载是不可逆动作里最容易点错的一个，进了废纸篓至少还能
 * 拖回来。执行侧对应 Electron 的 shell.trashItem。
 *
 * 平台差异是真实的，不做假装支持：
 * - macOS 是拖 .app 进废纸篓的分发方式，可以自己把自己扔掉。
 * - Windows 走 electron-builder 的 NSIS 安装器，没有「一个 bundle」可以扔，
 *   必须由系统的卸载入口执行，这里只给指引。
 */
import path from 'node:path';

export const UNINSTALL_UNSUPPORTED_HINTS = {
    win32: '请在 Windows「设置 → 应用 → 已安装的应用」里找到 Evan 并卸载。',
    linux: '请用安装 Evan 时使用的包管理器卸载。',
    dev: '开发模式下没有可卸载的应用包。请直接删除源码目录，或先打包成桌面应用。'
};

/**
 * @param {object} options
 * @param {string} options.userDataDir  Electron 的 userData 目录（含 library、codex-home、浏览器 profile）
 * @param {string} options.exePath      process.execPath
 * @param {string} options.platform
 * @param {boolean} options.isPackaged
 * @param {boolean} options.keepUserData 保留用户数据时只扔应用本体
 * @returns {{ supported: boolean, hint?: string, targets: {path: string, label: string}[] }}
 */
export function resolveUninstallTargets({
    userDataDir,
    exePath,
    platform,
    isPackaged,
    keepUserData
}) {
    if (!isPackaged) {
        return { supported: false, hint: UNINSTALL_UNSUPPORTED_HINTS.dev, targets: [] };
    }
    if (platform !== 'darwin') {
        return {
            supported: false,
            hint: UNINSTALL_UNSUPPORTED_HINTS[platform] || UNINSTALL_UNSUPPORTED_HINTS.linux,
            targets: []
        };
    }

    // /Applications/Evan.app/Contents/MacOS/Evan → /Applications/Evan.app
    const bundlePath = path.resolve(exePath, '..', '..', '..');
    if (!bundlePath.endsWith('.app')) {
        return {
            supported: false,
            hint: `没有从 ${exePath} 识别出应用包（.app）位置，请手动把 Evan 拖到废纸篓。`,
            targets: []
        };
    }

    const targets = [];
    // 先扔数据再扔应用本体：反过来的话，应用被移动后再算数据路径就没有意义了。
    if (!keepUserData && userDataDir) {
        targets.push({ path: userDataDir, label: '应用数据（素材、登录态、配置、日志）' });
    }
    targets.push({ path: bundlePath, label: '应用本体' });
    return { supported: true, targets };
}
