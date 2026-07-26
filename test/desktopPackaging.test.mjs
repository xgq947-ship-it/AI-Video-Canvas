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
const installerWorkflow = fs.readFileSync(
  new URL('../.github/workflows/desktop-installers.yml', import.meta.url),
  'utf8'
);
const electronMain = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
const electronPreload = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
const serverMain = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');

test('桌面安装包按目标平台原生构建并在打包前验收运行时', () => {
  assert.match(pkg.scripts['desktop:dist:mac'], /electron-builder --mac/);
  assert.match(pkg.scripts['desktop:dist:win'], /electron-builder --win --x64/);
  assert.match(pkg.scripts['desktop:dist:mac'], /--publish never/);
  assert.match(pkg.scripts['desktop:dist:win'], /--publish never/);
  assert.match(pkg.scripts['desktop:prepare'], /desktop:icons.*desktop:runtime.*desktop:verify/);
  assert.match(runtimeBuilder, /fs\.rmSync\(OUTPUT_ROOT/);
  assert.match(runtimeBuilder, /\['ffmpeg\.README', 'README\.md'\]/);
  assert.match(runtimeVerifier, /chrome-win64/);
  assert.match(runtimeVerifier, /chrome-mac-arm64/);
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
});

test('运行后端依赖属于 production，安装包不再显式收录整个 node_modules', () => {
  for (const dependency of ['express', 'cors', 'dotenv']) {
    assert.ok(pkg.dependencies[dependency], `${dependency} 应属于 dependencies`);
    assert.equal(pkg.devDependencies[dependency], undefined);
  }
  assert.equal(pkg.build.files.includes('node_modules/**/*'), false);
});

test('安装器 CI 同时使用原生 macOS 和 Windows runner', () => {
  assert.match(installerWorkflow, /os: macos-latest/);
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
  assert.match(serverMain, /EVAN_DESKTOP_TOKEN/);
  assert.match(serverMain, /自定义项目路径必须通过桌面应用选择/);
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
