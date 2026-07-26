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
});

test('关闭器先优雅退出，再精确回收 Evan Electron 与专属 Chrome', () => {
  assert.match(launcher, /signalAll\(electronPids, 'SIGTERM'\)/);
  assert.match(launcher, /signalAll\(electronPids, 'SIGKILL'\)/);
  assert.match(launcher, /--user-data-dir=/);
  assert.match(launcher, /entry\.command\.startsWith\(root\)/);
  assert.match(launcher, /signalAll\(remainingChromePids, 'SIGTERM'\)/);
});
