import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const common = fs.readFileSync(
  new URL('../server/python/ops_cli/platforms/_google_flow_common.py', import.meta.url),
  'utf8'
);
const chromeRuntime = fs.readFileSync(
  new URL('../server/python/sessionhub/scene/chrome_cdp.py', import.meta.url),
  'utf8'
);
const imageProvider = fs.readFileSync(
  new URL('../server/python/ops_cli/platforms/text_to_image/providers/google_flow.py', import.meta.url),
  'utf8'
);
const opsRunner = fs.readFileSync(
  new URL('../server/services/opsCliRunner.js', import.meta.url),
  'utf8'
);
const serverMain = fs.readFileSync(
  new URL('../server/index.js', import.meta.url),
  'utf8'
);
const jimengImage = fs.readFileSync(
  new URL('../server/python/ops_cli/platforms/text_to_image/providers/jimeng.py', import.meta.url),
  'utf8'
);
const jimengVideo = fs.readFileSync(
  new URL('../server/python/ops_cli/platforms/image_to_video/providers/jimeng.py', import.meta.url),
  'utf8'
);

test('Flow 新账号不再使用固定项目 UUID，并支持从首页进入或创建项目', () => {
  assert.doesNotMatch(common, /f58e4591-349f-478a-a328-90e5923c7e25/);
  assert.match(common, /GOOGLE_FLOW_HOME_URL/);
  assert.match(common, /_enter_or_create_project/);
  assert.match(common, /new\\s\+project\|新建项目/);
});

test('Evan 专属 Chrome 固定英文首选语言，Flow 生图关键操作使用图标结构定位', () => {
  assert.match(chromeRuntime, /--lang=en-US/);
  assert.match(imageProvider, /arrow_forward/);
  assert.match(imageProvider, /has_text=re\.compile/);
});

test('Flow 与即梦生成强制复用同一资料的无头实例，只有用户主动操作才显示浏览器', () => {
  assert.match(common, /start_chrome\(headless=True\)/);
  assert.match(common, /if foreground_allowed\(\):\s+start_chrome\(foreground=True\)/);
  assert.doesNotMatch(common, /ok, message = start_chrome\(\)/);
  assert.match(chromeRuntime, /--headless=new/);
  assert.match(chromeRuntime, /User-Agent/);
  assert.match(chromeRuntime, /HeadlessChrome/);
  assert.doesNotMatch(opsRunner, /process\.env\.EVAN_DESKTOP === '1'\s*\?\s*'1'/);
});

test('系统 Chrome 使用独立 Profile 和可被 Playwright 接管的低后台开销参数', () => {
  assert.match(chromeRuntime, /EVAN_CHROME_EXECUTABLE/);
  assert.match(chromeRuntime, /--remote-allow-origins=\*/);
  assert.doesNotMatch(chromeRuntime, /--enable-automation/);
  assert.match(chromeRuntime, /--disable-background-networking/);
  assert.match(chromeRuntime, /--disable-component-update/);
  assert.match(chromeRuntime, /_instance_supports_playwright/);
  assert.match(chromeRuntime, /restart_for_playwright/);
});

test('每个 Flow 与即梦任务使用独立临时页并在结束后清理', () => {
  assert.match(common, /managed_work_page\(context, owner, cleanup_before=True\)/);
  assert.doesNotMatch(common, /existing\s*=\s*_existing_project_page[\s\S]*yield existing/);
  assert.match(jimengImage, /managed_work_page\(context, "jimeng\.image\.generate", cleanup_before=True\)/);
  assert.match(jimengVideo, /managed_work_page\(context, "jimeng\.video\.generate", cleanup_before=True\)/);
});

test('主动登录使用普通 Chrome，且不把打开窗口误记为已认证', () => {
  assert.match(chromeRuntime, /def start_login_chrome/);
  const loginBlock = chromeRuntime.slice(
    chromeRuntime.indexOf('def start_login_chrome'),
    chromeRuntime.indexOf('def _system_events')
  );
  assert.doesNotMatch(loginBlock, /--remote-debugging-port|--enable-automation/);
  assert.match(serverMain, /successSessionState: 'reauthenticating'/);
  assert.doesNotMatch(serverMain, /trackSessionState: false/);
});
