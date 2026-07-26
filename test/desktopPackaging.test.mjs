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
