import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const topBar = fs.readFileSync(new URL('../src/components/TopBar.tsx', import.meta.url), 'utf8');
const guide = fs.readFileSync(
  new URL('../src/components/modals/StartupSetupGuideModal.tsx', import.meta.url),
  'utf8'
);

test('每次桌面界面启动时主动显示服务连接指南，并可从设置再次打开', () => {
  assert.match(topBar, /useState\(true\)/);
  assert.match(topBar, /启动配置指南/);
  assert.match(topBar, /setShowSetupGuide\(true\)/);
});

test('启动指南包含两个浏览器平台、DeepSeek 和 ChatGPT Codex 的真实配置入口', () => {
  assert.match(guide, /https:\/\/jimeng\.jianying\.com\/ai-tool\/generate\?type=image/);
  assert.match(guide, /https:\/\/labs\.google\/fx\/tools\/flow/);
  assert.match(guide, /https:\/\/platform\.deepseek\.com\/api_keys/);
  assert.match(guide, /右上角「设置 → 配置 API 密钥 → Codex 服务」/);
  assert.match(guide, /api\/browser-sessions\/\$\{provider\}\/reauthenticate/);
  assert.match(guide, /window\.evanDesktop\.openExternal/);
});

test('启动指南读取真实登录、密钥与 Codex 状态而不是展示固定完成状态', () => {
  assert.match(guide, /fetch\('\/api\/capabilities'/);
  assert.match(guide, /fetch\('\/api\/settings\/api-keys'/);
  assert.match(guide, /fetch\('\/api\/settings\/codex'/);
  assert.match(guide, /state === 'authenticated'/);
  assert.match(guide, /DEEPSEEK_API_KEY/);
  assert.match(guide, /codex\.authenticated/);
});
