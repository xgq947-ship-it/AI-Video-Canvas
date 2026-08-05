import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const runtimeBuilder = fs.readFileSync(
  new URL('../scripts/prepare-desktop-runtime.mjs', import.meta.url),
  'utf8'
);
const runtimeVerifier = fs.readFileSync(
  new URL('../scripts/verify-desktop-runtime.mjs', import.meta.url),
  'utf8'
);
const automationRuntimeSetup = fs.readFileSync(
  new URL('../scripts/setup-browser-models.mjs', import.meta.url),
  'utf8'
);
const installerWorkflow = fs.readFileSync(
  new URL('../.github/workflows/desktop-installers.yml', import.meta.url),
  'utf8'
);
const hubSyncWorkflow = fs.readFileSync(
  new URL('../.github/workflows/sync-browser-hub.yml', import.meta.url),
  'utf8'
);
const electronMain = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
const electronPreload = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
const serverMain = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const serverProjectRoutes = fs.readFileSync(new URL('../server/routes/projects.js', import.meta.url), 'utf8');
const serverProjectImport = fs.readFileSync(new URL('../server/services/projectImport.js', import.meta.url), 'utf8');
const browserHubClient = fs.readFileSync(
  new URL('../server/services/browserHubClient.js', import.meta.url),
  'utf8'
);
const opsCliRunner = fs.readFileSync(
  new URL('../server/services/opsCliRunner.js', import.meta.url),
  'utf8'
);
const installerInclude = fs.readFileSync(new URL('../build/installer.nsh', import.meta.url), 'utf8');

test('桌面安装包按目标平台原生构建并在打包前验收运行时', () => {
  assert.match(pkg.scripts['desktop:dist:mac'], /electron-builder --mac/);
  assert.match(pkg.scripts['desktop:dist:win'], /electron-builder --win --x64/);
  assert.match(pkg.scripts['desktop:dist:mac'], /--publish never/);
  assert.match(pkg.scripts['desktop:dist:win'], /--publish never/);
  assert.match(pkg.scripts['desktop:prepare'], /desktop:icons.*desktop:runtime.*desktop:verify/);
  assert.match(runtimeBuilder, /fs\.rmSync\(OUTPUT_ROOT/);
  assert.match(runtimeBuilder, /\['ffmpeg\.README', 'README\.md'\]/);
  assert.doesNotMatch(runtimeVerifier, /chrome-win64|chrome-mac-arm64|Chrome for Testing/);
  assert.match(runtimeVerifier, /用户电脑上的 Google Chrome/);
  assert.equal(pkg.build.extraResources.some(entry => entry.to === 'playwright-browsers'), false);
  assert.equal(pkg.build.extraResources.some(entry => entry.to === 'browser-hub'), true);
  assert.match(automationRuntimeSetup, /fs\.rmSync\(LEGACY_BROWSER_ROOT/);
  assert.doesNotMatch(automationRuntimeSetup, /playwright.+install/);
  assert.ok(pkg.build.files.includes('scripts/codex-image-queue.mjs'));
  assert.ok(pkg.build.files.includes('integrations/skills/twitcanva-codex-images/**/*'));
  assert.ok(pkg.build.asarUnpack.includes('integrations/skills/twitcanva-codex-images/**/*'));
});

test('Windows NSIS 保留用户数据并创建桌面和开始菜单快捷方式', () => {
  assert.equal(pkg.build.win.icon, 'build/icon.ico');
  assert.equal(pkg.build.nsis.oneClick, false);
  assert.equal(pkg.build.nsis.perMachine, false);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(pkg.build.nsis.createDesktopShortcut, 'always');
  assert.equal(pkg.build.nsis.createStartMenuShortcut, true);
  assert.equal(pkg.build.nsis.include, 'build/installer.nsh');
  assert.match(installerInclude, /App Paths\\chrome\.exe/);
  assert.match(installerInclude, /google\.com\/chrome/);
  assert.match(installerInclude, /Abort/);
});

test('macOS 首次启动缺少 Chrome 时显示阻断页并开放重试', () => {
  for (const channel of ['chrome:get-status', 'chrome:open-download', 'chrome:retry']) {
    assert.match(electronMain, new RegExp(`ipcMain\\.handle\\('${channel}'`));
    assert.ok(electronPreload.includes(channel));
  }
  assert.match(electronMain, /chromeRequiredPage/);
  assert.match(electronMain, /shell\.openExternal\(CHROME_DOWNLOAD_URL\)/);
  assert.match(electronMain, /createWindow\(chrome\.ready \? null : chromeRequiredPage\(chrome\)\)/);
});

test('关闭最后一个 Evan 窗口只退出本 App，不关闭共享 Chrome', () => {
  const block = electronMain.slice(electronMain.indexOf("app.on('window-all-closed'"));
  assert.match(block, /app\.quit\(\)/);
  assert.doesNotMatch(block, /process\.platform !== 'darwin'/);
  assert.match(electronMain, /backendProcess\.postMessage\(\{ type: 'shutdown' \}\)/);
  assert.match(electronMain, /ensureSharedBrowserHub/);
  assert.match(electronMain, /共享 Chrome 由 Hub 按租约空闲回收/);
  assert.doesNotMatch(electronMain, /closeDedicatedChromeFallback|browser', 'close/);
});

test('运行后端依赖属于 production，安装包不再显式收录整个 node_modules', () => {
  for (const dependency of ['express', 'cors', 'dotenv']) {
    assert.ok(pkg.dependencies[dependency], `${dependency} 应属于 dependencies`);
    assert.equal(pkg.devDependencies[dependency], undefined);
  }
  assert.equal(pkg.build.files.includes('node_modules/**/*'), false);
});

test('共享 Hub 载荷包含 Node 许可证并校验远程归档', () => {
  assert.equal(pkg.build.extraResources.some(item => item.to === 'browser-hub'), true);
  const prepareHub = fs.readFileSync(new URL('../scripts/prepare-browser-hub.mjs', import.meta.url), 'utf8');
  assert.match(prepareHub, /NODE-LICENSE/);
  assert.match(prepareHub, /createHash\('sha256'\)/);
  assert.match(prepareHub, /readBrowserHubLock/);
  assert.match(prepareHub, /lockedAsset\.sha256/);
  assert.match(runtimeVerifier, /NODE-LICENSE/);
  const electronHub = fs.readFileSync(new URL('../electron/browserHub.js', import.meta.url), 'utf8');
  assert.doesNotMatch(electronHub, /BROWSER_HUB_VERSION/);
  assert.doesNotMatch(prepareHub, /const HUB_VERSION = '\d/);
});

test('Hub stable Release 自动同步单一锁文件，验证失败不会写入 main', () => {
  assert.match(hubSyncWorkflow, /cron: '17 \*\/6 \* \* \*'/);
  assert.match(hubSyncWorkflow, /scripts\/sync-browser-hub-lock\.mjs/);
  assert.match(hubSyncWorkflow, /npm test/);
  assert.match(hubSyncWorkflow, /macos-15/);
  assert.match(hubSyncWorkflow, /git status --porcelain/);
  assert.match(hubSyncWorkflow, /git push origin HEAD:main/);
});

test('Electron 与普通 npm run dev 都会自动启动内置共享 Hub', () => {
  assert.match(pkg.scripts.dev, /^node scripts\/prepare-browser-hub\.mjs &&/);
  assert.match(browserHubClient, /sdk\.ensureHub\(payloadDir, \{ env: environment \}\)/);
  assert.match(opsCliRunner, /await ensureSharedBrowserHub\(\)/);
});

test('安装器 CI 同时使用原生 macOS 和 Windows runner', () => {
  assert.match(installerWorkflow, /os: macos-15/);
  assert.match(installerWorkflow, /os: windows-latest/);
  assert.match(installerWorkflow, /npm run desktop:dist:mac/);
  assert.match(installerWorkflow, /npm run desktop:dist:win/);
  assert.match(installerWorkflow, /actions\/upload-artifact@v4/);
  assert.match(installerWorkflow, /release\/\*\.dmg/);
  assert.match(installerWorkflow, /release\/\*\.exe/);
  assert.match(installerWorkflow, /actions\/download-artifact@v4/);
  assert.match(installerWorkflow, /gh release create/);
  assert.match(installerWorkflow, /actions: write/);
  assert.match(installerWorkflow, /retention-days: 1/);
  assert.match(installerWorkflow, /GITHUB_RUN_ID\/artifacts/);
  assert.match(installerWorkflow, /--method DELETE/);
});

test('自定义项目路径只通过 Electron 原生选择器和桌面令牌提交', () => {
  assert.match(electronMain, /project:select-location/);
  assert.match(electronMain, /showOpenDialog/);
  assert.match(electronMain, /X-Evan-Desktop-Token/);
  assert.match(electronPreload, /selectProjectLocation/);
  assert.match(electronPreload, /selectCodexCli/);
  assert.match(electronMain, /codex:select-cli/);
  assert.match(electronPreload, /openExternal/);
  assert.match(electronMain, /external:open/);
  assert.match(electronMain, /ALLOWED_EXTERNAL_HOSTS/);
  assert.match(electronMain, /url\.protocol !== 'https:'/);
  // 项目相关路由已从 server/index.js 搬到 server/routes/projects.js（行为未变）。
  assert.match(serverProjectRoutes, /EVAN_DESKTOP_TOKEN/);
  assert.match(serverProjectRoutes, /自定义项目路径必须通过桌面应用选择/);
});

test('本地已有项目通过原生文件夹选择器导入并注册', () => {
  assert.match(electronMain, /project:select-local/);
  assert.match(electronMain, /project:import-local/);
  assert.match(electronMain, /api\/projects\/import/);
  assert.match(electronMain, /X-Evan-Desktop-Token/);
  assert.match(electronPreload, /selectLocalProject/);
  assert.match(electronPreload, /importLocalProject/);
  assert.match(serverProjectRoutes, /importLocalProject/);
  // project.json 的实际读写在 projectImport 服务里，路由只负责调用它。
  assert.match(serverProjectImport, /project\.json/);
});

// ---------------------------------------------------------------------------
// 应用内更新
// ---------------------------------------------------------------------------

const electronUpdater = fs.readFileSync(new URL('../electron/updater.js', import.meta.url), 'utf8');
const changelog = JSON.parse(fs.readFileSync(new URL('../CHANGELOG.json', import.meta.url), 'utf8'));

test('更新源由 electron-builder 的 publish 配置生成，不再依赖外部配置文件', () => {
  // 之前用 provider:'generic' 读 resources/update-config.json，而这个文件从来没有
  // 任何构建步骤写入过 —— 打包版永远走 not_configured，更新功能实际是死的。
  const [target] = pkg.build.publish;
  assert.equal(target.provider, 'github');
  assert.equal(target.owner, 'xgq947-ship-it');
  assert.equal(target.repo, 'AI-Video-Canvas');
  assert.doesNotMatch(electronUpdater, /update-config\.json/);
  assert.doesNotMatch(electronUpdater, /provider: 'generic'/);
});

test('macOS 绝不走应用内安装：Squirrel.Mac 会校验签名而我们的包未签名', () => {
  // 未签名的 mac 包能检查到新版本，但安装必定失败。所以只允许 win32 应用内安装，
  // 其余平台一律跳转 GitHub 下载页。改这条之前请先确认 mac 包已经做了代码签名。
  assert.match(electronUpdater, /supportsInAppInstall = \(\) => process\.platform === 'win32'/);

  // 下载与安装两处都必须先过 supportsInAppInstall 这道闸。
  const downloadBlock = electronUpdater.slice(
    electronUpdater.indexOf('const download ='),
    electronUpdater.indexOf('const install =')
  );
  const installBlock = electronUpdater.slice(
    electronUpdater.indexOf('const install ='),
    electronUpdater.indexOf('const openDownloadPage =')
  );
  assert.match(downloadBlock, /if \(!supportsInAppInstall\(\)\)/);
  assert.match(downloadBlock, /shell\.openExternal\(RELEASES_PAGE_URL\)/);
  assert.match(installBlock, /if \(!supportsInAppInstall\(\)\)/);
  assert.match(installBlock, /shell\.openExternal\(RELEASES_PAGE_URL\)/);

  // 自动下载必须关掉：mac 上下载完也装不上，白占用户带宽和磁盘。
  assert.match(electronUpdater, /autoUpdater\.autoDownload = false/);
  assert.match(electronUpdater, /autoInstallOnAppQuit = supportsInAppInstall\(\)/);
});

test('更新的 IPC 通道在主进程注册并通过 preload 暴露', () => {
  for (const channel of [
    'app:info',
    'project:reveal',
    'update:get-state',
    'update:check',
    'update:download',
    'update:install',
    'update:open-download-page'
  ]) {
    assert.match(electronMain, new RegExp(`ipcMain\\.handle\\('${channel}'`), `缺少 ${channel}`);
    assert.ok(electronPreload.includes(channel), `preload 未暴露 ${channel}`);
  }
  // 状态是主进程主动推的，渲染进程必须能订阅而不是轮询。
  assert.match(electronPreload, /ipcRenderer\.on\('desktop:update-status'/);
  assert.match(electronPreload, /removeListener\('desktop:update-status'/);
});

test('CHANGELOG 最新条目与 package.json 版本一致', () => {
  // 发版时忘了写更新说明的话，用户在「新功能」里会看到上一版的内容。
  assert.ok(Array.isArray(changelog) && changelog.length > 0, 'CHANGELOG.json 不能为空');
  assert.equal(changelog[0].version, pkg.version);
  for (const entry of changelog) {
    assert.match(entry.version, /^\d+\.\d+\.\d+$/);
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('更新说明是静态打进前端包的，不依赖联网', () => {
  // CHANGELOG.json 由 vite 静态 import 打进渲染进程 bundle，所以不需要单独收录进
  // build.files。关键是不能改成运行时去拉 GitHub API —— 那样断网就看不到更新说明，
  // 而「刚更新完想看看改了什么」恰恰是最常见的使用时刻。
  const updatesHook = fs.readFileSync(new URL('../src/hooks/useAppUpdates.ts', import.meta.url), 'utf8');
  assert.match(updatesHook, /import changelogData from '\.\.\/\.\.\/CHANGELOG\.json'/);
  assert.doesNotMatch(updatesHook, /api\.github\.com/);
});

test('Release 只上传更新源需要的 yml，不带构建调试文件', () => {
  // latest.yml / latest-mac.yml 是 electron-updater 的更新源，必须在 Release 上；
  // builder-debug.yml 只是构建调试产物，之前被 release/*.yml 顺手带了上去。
  assert.match(installerWorkflow, /release\/latest\*\.yml/);
  assert.doesNotMatch(installerWorkflow, /release\/\*\.yml/);
});

test('build 配置能通过 electron-builder 自己的 schema 校验', async () => {
  // electron-builder 严格校验配置，任何未知属性都会让打包直接失败 ——
  // 包括 "//xxx" 这种注释键（npm 容忍，electron-builder 不容忍）。
  // 这类错误只在打 Tag 触发发布构建时才暴露，代价太高，所以在这里提前拦住。
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const Ajv = require('ajv');
  const schema = JSON.parse(
    fs.readFileSync(new URL('../node_modules/app-builder-lib/scheme.json', import.meta.url), 'utf8')
  );

  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
  const validate = ajv.compile(schema);

  assert.ok(
    validate(pkg.build),
    `build 配置不合法：${JSON.stringify(validate.errors?.slice(0, 3))}`
  );

  // 反向确认这道防线真的有效，而不是永远返回 true。
  assert.equal(validate({ ...pkg.build, '//note': '注释' }), false);
});

test('安装包文件名不含空格，否则更新源里的地址会 404', () => {
  // productName 是「Evan AI Video Canvas」，带空格。用 ${productName} 做 artifactName
  // 会让同一个文件出现三种名字：
  //   electron-builder 本地写盘  → "Evan AI Video Canvas-0.1.1-win-x64.exe"（空格）
  //   latest.yml 里的 url        → "Evan-AI-Video-Canvas-0.1.1-win-x64.exe"（连字符）
  //   GitHub 上传后的资产名       → "Evan.AI.Video.Canvas-0.1.1-win-x64.exe"（点号）
  // electron-updater 按 latest.yml 去下载，必然 404 —— v0.1.1 实测复现过。
  assert.doesNotMatch(pkg.build.artifactName, /\$\{productName\}/);
  assert.doesNotMatch(pkg.build.artifactName, / /);
  assert.match(pkg.build.artifactName, /\$\{version\}/);
  assert.match(pkg.build.artifactName, /\$\{ext\}$/);
});

test('AGENTS.md 的前置条件约束与实际实现一致', () => {
  // AGENTS.md 是下一个接手会话读的规则文件。这批改动把系统 Chrome 变成了硬性前置
  // 条件（macOS 阻断页 + Windows 安装器 Abort），规则文件必须同步，
  // 否则它会禁止 main 已经在做的事。
  const agents = fs.readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
  assert.doesNotMatch(agents, /不得重新引入系统 Chrome/);
  assert.doesNotMatch(agents, /内置 Chromium/);
  assert.match(agents, /正式版 Google Chrome/);
  assert.match(agents, /MIN_SUPPORTED_CHROME_MAJOR/);

  // README 与两份安装文档同样不能再宣称「不需要 Chrome」。
  for (const doc of ['../README.md', '../docs/首次安装使用-macOS.md', '../docs/首次安装使用-Windows.md']) {
    const text = fs.readFileSync(new URL(doc, import.meta.url), 'utf8');
    assert.match(text, /Google Chrome/, `${doc} 没有说明 Chrome 前置条件`);
  }
});
