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
const browserCli = fs.readFileSync(
  new URL('../server/python/ops_cli/browser.py', import.meta.url),
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
  assert.match(chromeRuntime, /--enable-automation/);
  assert.match(chromeRuntime, /--disable-background-networking/);
  assert.match(chromeRuntime, /--disable-component-update/);
  assert.match(chromeRuntime, /_instance_supports_playwright/);
  assert.match(chromeRuntime, /restart_for_playwright/);
  assert.match(opsRunner, /30 \* 60_000/);
});

test('Flow 与即梦视频使用独立临时页，即梦生图在 Windows 优先复用已有页面', () => {
  assert.match(common, /managed_work_page\(context, owner, cleanup_before=True\)/);
  assert.doesNotMatch(common, /existing\s*=\s*_existing_project_page[\s\S]*yield existing/);
  assert.match(jimengImage, /managed_work_page\(context, "jimeng\.image\.generate", cleanup_before=True\)/);
  assert.match(jimengImage, /existing_page = _existing_jimeng_page\(context\)/);
  assert.match(jimengImage, /nullcontext\(existing_page\)/);
  assert.match(jimengVideo, /managed_work_page\(context, "jimeng\.video\.generate", cleanup_before=True\)/);
});

test('即梦生图只读取可见结果区，不能卡在 Windows 响应式隐藏副本', () => {
  assert.match(jimengImage, /def _visible_result_area/);
  assert.match(jimengImage, /if area\.is_visible\(\)/);
  assert.match(jimengImage, /root = _visible_result_area\(page\)/);
});

test('主动登录使用普通 Chrome，且不把打开窗口误记为已认证', () => {
  assert.match(chromeRuntime, /def start_login_chrome/);
  const loginBlock = chromeRuntime.slice(
    chromeRuntime.indexOf('def start_login_chrome'),
    chromeRuntime.indexOf('def _system_events')
  );
  assert.doesNotMatch(loginBlock, /--remote-debugging-port|--enable-automation/);
  assert.match(serverMain, /successSessionState: 'reauthenticating'/);
  const reauthRoute = serverMain.slice(
    serverMain.indexOf("app.post('/api/browser-sessions/:provider/reauthenticate'"),
    serverMain.indexOf("app.post('/api/browser-sessions/check'")
  );
  assert.doesNotMatch(reauthRoute, /trackSessionState: false/);
});

test('设置页登录状态只接受真实页面探针，不沿用打开登录页的结果', () => {
  assert.match(browserCli, /def check_browser_logins/);
  assert.match(browserCli, /def _probe_flow_login/);
  assert.match(browserCli, /def _probe_jimeng_login/);
  assert.match(browserCli, /"evidence": "account-api-user-id"/);
  assert.match(browserCli, /"evidence": "account-api-guest"/);
  assert.doesNotMatch(browserCli, /"evidence": "authenticated-composer"/);
  // Flow 的证据不再是页面元素。实测 https://labs.google/fx/tools/flow 是公开营销
  // 落地页，对已登录和未登录渲染完全相同，原来的 editor / account 选择器 count 恒为 0，
  // 探针只能空等到超时报 unconfirmed —— 即用户看到的「Flow 检查不出来」。
  // 现在按 myaccount.google.com 的重定向行为判定，详见 test/browserLoginProbe.test.mjs。
  assert.match(browserCli, /"evidence": "google-account-page"/);
  assert.match(browserCli, /"evidence": "redirected-to-signin"/);
  assert.match(serverMain, /app\.post\('\/api\/browser-sessions\/check'/);
  assert.match(serverMain, /enqueueBrowserWorkflow\(\(\) => runOpsCli/);
  assert.match(serverMain, /if \(result\.authenticated === true\)/);
  assert.match(serverMain, /LOGIN_PROBE_UNCONFIRMED/);
});

test('登录窗口优雅退出落盘 Profile，超时后才强杀', () => {
  const stopBlock = chromeRuntime.slice(
    chromeRuntime.indexOf('def stop_chrome'),
    chromeRuntime.indexOf('def start_chrome')
  );
  assert.match(stopBlock, /os\.kill\(main_pid, signal\.SIGTERM\)/);
  assert.match(stopBlock, /Chrome 会自行通知 Helper 退出并刷新 Cookie 数据库/);
  assert.ok(stopBlock.indexOf('signal.SIGTERM') < stopBlock.indexOf('signal.SIGKILL'));
});

test('Windows 关闭等待使用原生 PID 句柄，不在轮询中反复启动 PowerShell', () => {
  const stopBlock = chromeRuntime.slice(
    chromeRuntime.indexOf('def stop_chrome'),
    chromeRuntime.indexOf('def start_chrome')
  );
  const windowsBlock = stopBlock.slice(
    stopBlock.indexOf('if IS_WINDOWS:'),
    stopBlock.indexOf('main_pid = _instance_pid()')
  );

  assert.equal(
    (windowsBlock.match(/_instance_pid_windows\(\)/g) || []).length,
    1,
    '只能在没有 known_pid 时做一次 Profile 精确查询'
  );
  assert.match(windowsBlock, /_windows_pid_is_running\(pid\)/);
  assert.doesNotMatch(
    windowsBlock.slice(windowsBlock.indexOf('for _ in range(20):')),
    /_instance_pid_windows\(\)/
  );
});

// ---------------------------------------------------------------------------
// Material Symbols 连字定位
// ---------------------------------------------------------------------------

test('连字匹配用的是 textContent 的实际形态，不能要求尾部空白', () => {
  // 实测 Flow 的控件：
  //   innerText   = "play_circle\nVideo"   （换行来自 CSS 块级布局）
  //   textContent = "play_circleVideo"     ← Playwright 传正则时匹配的是这个
  // 旧写法 (^|\s)play_circle(\s|$) 要求连字后面是空白或结尾，而实际紧跟标签首字母，
  // 于是永远匹配不上 —— 这就是「未找到 Video 模式」的根因，同一写法还打断了
  // 提交按钮、Frames/Ingredients 子模式和上传控件的定位。
  const common = fs.readFileSync(
    new URL('../server/python/ops_cli/platforms/_google_flow_common.py', import.meta.url), 'utf8'
  );
  assert.match(common, /def ligature_text/);

  // 整个 platforms 目录都不允许再出现这种带尾部边界的连字正则。
  for (const relative of [
    '../server/python/ops_cli/platforms/_google_flow_common.py',
    '../server/python/ops_cli/platforms/image_to_video/providers/google_flow.py',
    '../server/python/ops_cli/platforms/text_to_image/providers/google_flow.py'
  ]) {
    const source = fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
    // 只看真正构造正则的地方；ligature_text 的 docstring 里把旧写法当反面例子引用了。
    assert.doesNotMatch(
      source,
      /re\.compile\(\s*\n?\s*r?"\(\^\|\\s\)[^"]*\(\\s\|\$\)"/,
      `${relative} 仍在用会失效的 (^|\\s)…(\\s|$) 连字正则`
    );
  }

  // 四个关键控件都改用 ligature_text 定位。
  const video = fs.readFileSync(
    new URL('../server/python/ops_cli/platforms/image_to_video/providers/google_flow.py', import.meta.url), 'utf8'
  );
  for (const ligature of ['play_circle', 'crop_free', 'chrome_extension', 'arrow_forward']) {
    assert.match(video, new RegExp(`ligature_text\\("${ligature}"`), `${ligature} 没有改用 ligature_text`);
  }
});

test('_exact_count 会等待，而不是对刚点开的菜单取快照', () => {
  // locator.count() 是快照。这些调用紧跟在 click() 之后，菜单往往还没渲染完，
  // 直接取 count 就会偶发判「没找到」——正是「时好时坏」的来源。
  const common = fs.readFileSync(
    new URL('../server/python/ops_cli/platforms/_google_flow_common.py', import.meta.url), 'utf8'
  );
  const block = common.slice(common.indexOf('def _exact_count'), common.indexOf('def _exact_count') + 1400);
  assert.match(block, /timeout_ms: int = /);
  assert.match(block, /deadline = time\.monotonic\(\)/);
  assert.match(block, /time\.sleep\(/);
  // 超时后仍要如实抛错，不能无限等下去。
  assert.match(block, /raise GoogleFlowError\(error_code, message\)/);
});
