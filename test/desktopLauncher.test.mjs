import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const launcher = fs.readFileSync(
  new URL('../scripts/desktop-launcher.mjs', import.meta.url),
  'utf8'
);
const startApp = fs.readFileSync(
  new URL('../scripts/macos-start-evan.applescript', import.meta.url),
  'utf8'
);
const stopApp = fs.readFileSync(
  new URL('../scripts/macos-stop-evan.applescript', import.meta.url),
  'utf8'
);
const controller = fs.readFileSync(
  new URL('../scripts/EvanProjectController.swift', import.meta.url),
  'utf8'
);
const controllerBuild = fs.readFileSync(
  new URL('../scripts/build-evan-project-controller.sh', import.meta.url),
  'utf8'
);
const gitignore = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');

test('桌面启动器位于项目内，不依赖会被清空的用户数据目录', () => {
  assert.match(startApp, /AI-Video-Canvas.*desktop-launcher\.mjs/s);
  assert.match(stopApp, /AI-Video-Canvas.*desktop-launcher\.mjs/s);
  assert.doesNotMatch(startApp, /Application Support/);
  assert.doesNotMatch(stopApp, /Application Support/);
});

test('启动器构建前端、记录 Electron PID 并防止重复启动', () => {
  assert.match(launcher, /VITE_ENTRY/);
  assert.match(launcher, /already_running/);
  assert.match(launcher, /fs\.writeFileSync\(PID_FILE/);
  assert.match(launcher, /Electron 启动后立即退出/);
  assert.doesNotMatch(launcher, /focusExistingInstance/);
});

test('关闭器只回收 Evan Electron，不触碰其他 App 共用的 Chrome', () => {
  assert.match(launcher, /signalAll\(electronPids, 'SIGTERM'\)/);
  assert.match(launcher, /signalAll\(electronPids, 'SIGKILL'\)/);
  assert.match(launcher, /prepareBrowserHub/);
  assert.match(launcher, /shared-hub-managed/);
  assert.doesNotMatch(launcher, /dedicatedChromePids|remainingChromePids|--user-data-dir=/);
  assert.match(launcher, /GRACEFUL_STOP_TIMEOUT_MS = 15_000/);
  assert.match(launcher, /waitForExit\(electronPids, GRACEFUL_STOP_TIMEOUT_MS\)/);
});

test('macOS 桌面 App 验证路径，并通过可自注销的用户任务调用启动器', () => {
  for (const [source, command] of [[startApp, 'start'], [stopApp, 'stop']]) {
    assert.match(source, /\/bin\/test -f/);
    assert.match(source, /command -v node/);
    assert.match(source, /\/bin\/launchctl submit -l/);
    assert.match(source, /\/bin\/launchctl remove/);
    assert.match(source, /-- \/bin\/sh -c/);
    assert.match(source, new RegExp(`${command}; result=\\$\\?`));
    assert.match(source, /timeout of 30 seconds/);
    assert.match(source, /activate/);
    assert.doesNotMatch(source, /display notification/);
  }
  assert.match(startApp, /com\.evan\.desktop-launcher\.start/);
  assert.match(stopApp, /com\.evan\.desktop-launcher\.stop/);
  assert.match(startApp, /不会重复创建 Evan 进程/);
  assert.match(stopApp, /共享 Chrome 仍由 Hub 在所有 App 空闲后回收/);
});

test('启动器提供可查询状态和单命令重启，PID 只信任精确 Electron 命令', () => {
  assert.match(launcher, /command === 'status'/);
  assert.match(launcher, /command === 'restart'/);
  assert.match(launcher, /await stop\(\{ emitResult: false \}\)/);
  assert.match(launcher, /await start\(\{ emitResult: false, resultStatus: 'restarted' \}\)/);
  assert.doesNotMatch(launcher, /\.\.\.\(isAlive\(recordedPid\)/);
});

test('原生控制器统一调用项目启动器，并提供启动、重启、停止和状态刷新', () => {
  assert.match(controller, /desktop-launcher\.mjs/);
  assert.match(controller, /Bundle\.main\.bundleURL/);
  assert.match(controller, /EVAN_PROJECT_ROOT/);
  assert.match(controller, /EVAN_NODE_PATH/);
  assert.match(controller, /\.local\/bin\/node/);
  assert.match(controller, /process\.executableURL = nodeURL/);
  assert.doesNotMatch(controller, /\/Users\//);
  assert.match(controller, /case \.start/);
  assert.match(controller, /case \.restart/);
  assert.match(controller, /case \.stop/);
  assert.match(controller, /title: "关闭"/);
  assert.match(controller, /model\.refresh\(\)/);
  assert.match(controller, /Task\.sleep\(nanoseconds: 3_000_000_000\)/);
  assert.match(controller, /phase != \.failed/);
  assert.match(controller, /applicationShouldTerminateAfterLastWindowClosed/);
  assert.match(controller, /window\.styleMask\.insert\(\.fullSizeContentView\)/);
  assert.match(controller, /\.ignoresSafeArea\(\.container, edges: \.top\)/);
  assert.match(controllerBuild, /xcrun swiftc/);
  assert.match(controllerBuild, /codesign --force --deep --sign -/);
  assert.match(controllerBuild, /project_root}\/Evan 项目控制器\.app/);
  assert.match(gitignore, /\/Evan 项目控制器\.app\//);
  assert.doesNotMatch(controller, /osascript|display dialog/);
});
