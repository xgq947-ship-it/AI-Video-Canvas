/**
 * 项目级编辑锁的回归测试。
 *
 * 这是一个「项目级」约束，不是某个事件的补丁：没有当前项目时，**所有**会改动
 * 画布数据的入口都必须被同一道闸门挡住，并给同一条提示。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const APP = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const MENU = fs.readFileSync(new URL('../src/hooks/useContextMenuHandlers.ts', import.meta.url), 'utf8');
const LOCK = fs.readFileSync(new URL('../src/hooks/useCanvasEditLock.ts', import.meta.url), 'utf8');
const GUIDE = fs.readFileSync(new URL('../src/components/modals/StartupSetupGuideModal.tsx', import.meta.url), 'utf8');

test('编辑锁以「有没有当前项目」为唯一判据', () => {
    assert.match(LOCK, /Boolean\(workflowId\)/);
    assert.match(LOCK, /CANVAS_LOCKED_MESSAGE = '请先新建项目，再开始编辑画布'/);
});

test('双击与右键在无项目时不弹出添加节点菜单', () => {
    // 双击必须在 setContextMenu 之前就被拦下，否则菜单已经弹出来了再提示毫无意义。
    const doubleClick = MENU.slice(
        MENU.indexOf('const handleDoubleClick'),
        MENU.indexOf('const handleGlobalContextMenu')
    );
    assert.ok(doubleClick.indexOf('allowEdit()') < doubleClick.indexOf('setContextMenu({'),
        '双击必须先过闸门再弹菜单');

    const contextMenu = MENU.slice(
        MENU.indexOf('const handleGlobalContextMenu'),
        MENU.indexOf('// NODE OPERATIONS')
    );
    assert.ok(contextMenu.includes('allowEdit()'), '右键菜单同样要过闸门');
});

test('不止修双击：工具栏 / 拖入 / 粘贴入口都接了同一道闸门', () => {
    // 需求明确要求这是项目级锁，逐个事件打补丁会漏。
    const newNodeMenu = APP.slice(APP.indexOf('const openNewNodeMenu'), APP.indexOf('const openNewNodeMenu') + 700);
    assert.match(newNodeMenu, /canvasEditLock\.guard\(\)/, '工具栏「新建节点」未接闸门');

    const drop = APP.slice(APP.indexOf('const handleCanvasDrop'), APP.indexOf('const handleCanvasDrop') + 500);
    assert.match(drop, /canvasEditLock\.guard\(\)/, '拖入资源未接闸门');

    assert.match(APP, /onPaste=\{canvasEditLock\.withGuard\(handlePaste\)\}/, '粘贴未接闸门');
    assert.match(APP, /canEdit: canvasEditLock\.guard/, '右键/双击未接闸门');
});

test('闸门拦截时给用户提示，而不是静默失败', () => {
    assert.match(LOCK, /notify\?\.\(CANVAS_LOCKED_MESSAGE\)/);
    assert.match(APP, /useCanvasEditLock\(\{[\s\S]{0,200}notify:/);
});

test('无项目时画布上有可见的只读提示', () => {
    assert.match(APP, /!canEditCanvas &&/);
    assert.match(APP, /请先新建项目，再开始编辑画布/);
});

test('新建项目后立即恢复编辑，不需要重启', () => {
    // canEditCanvas 直接由 workflowId 推导，创建项目会更新它，因此天然即时恢复；
    // 这里锁定「不得引入额外的一次性开关」这一点。
    assert.match(LOCK, /useMemo\(\s*\(\)\s*=>\s*Boolean\(workflowId\) && ready/);
    assert.equal(/useState/.test(LOCK), false, '编辑锁不应有自己的状态，否则可能与项目状态不同步');
});

test('启动配置页本次启动只自动检测一次', () => {
    // 之前每次打开设置都会重新跑三平台 HTTP 登录检测，用户每次都要等数秒。
    assert.match(GUIDE, /let hasAutoDetectedThisSession = false/);
    assert.match(GUIDE, /const shouldAutoDetect = !hasAutoDetectedThisSession/);
    assert.match(GUIDE, /hasAutoDetectedThisSession = true/);
    assert.match(GUIDE, /void loadStatus\(shouldAutoDetect\)/);
    // 标记必须在模块作用域：组件每次打开都会重新挂载，组件内的标记起不到作用。
    const componentStart = GUIDE.indexOf('export const StartupSetupGuideModal');
    assert.ok(GUIDE.indexOf('let hasAutoDetectedThisSession') < componentStart,
        '一次性标记必须在组件外');
});

test('手动检测入口仍然保留', () => {
    // 自动检测只发生一次，但用户主动点击时必须能强制刷新。
    assert.match(GUIDE, /void loadStatus\(true\)/, '「重新检查」应强制检测');
    assert.match(GUIDE, /checkProviderLogin/, '单平台「检查登录状态」应保留');
});
