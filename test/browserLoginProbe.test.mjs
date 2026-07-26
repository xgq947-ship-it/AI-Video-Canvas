/**
 * 锁定登录态探针的判定逻辑与「不做无谓重启」。
 *
 * 背景（本机实测，非推断）：
 * - 原来 Flow 探针访问 https://labs.google/fx/tools/flow，而该地址是**公开营销落地页**
 *   （Overview / Models / Pricing / "Create with Google Flow"），对已登录和未登录用户
 *   渲染的 DOM 完全相同。原先找的 editor / account / sign-in 三个选择器实测
 *   count 全为 0，探针只能空等到 25 秒超时报「未发现足够的登录证据」——
 *   这就是「Google Flow 检查不出来」的根因。Slate 编辑器只存在于
 *   /fx/tools/flow/project/<id> 应用页，首页上永远没有。
 * - check_browser_logins 原来无条件 stop_chrome()，而 start_chrome 自己就有复用分支，
 *   等于每次检查都主动摧毁复用、付一次完整冷启动。实测两个平台一起检查
 *   39.5s → 5.6s。
 *
 * 未配置 Python 运行时（无 server/python/.venv）时自动跳过。
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PYTHON_ROOT = path.join(ROOT, 'server', 'python');
const VENV_PYTHON = process.platform === 'win32'
    ? path.join(PYTHON_ROOT, '.venv', 'Scripts', 'python.exe')
    : path.join(PYTHON_ROOT, '.venv', 'bin', 'python');

const ready = fs.existsSync(VENV_PYTHON);

function runPython(script) {
    const out = execFileSync(VENV_PYTHON, ['-c', script], {
        cwd: PYTHON_ROOT,
        encoding: 'utf8',
        env: { ...process.env, PYTHONPATH: PYTHON_ROOT }
    });
    return JSON.parse(out.trim().split('\n').pop());
}

/** 假 page：goto 后把 url 换成脚本给定的落点，模拟重定向。 */
const PROBE = `
import json, sys
sys.path.insert(0, '.')
from ops_cli.browser import _probe_flow_login

class FakePage:
    def __init__(self, landing):
        self.url = 'about:blank'
        self._landing = landing
    def goto(self, url, **kwargs):
        self.url = self._landing
    def wait_for_timeout(self, ms):
        pass

cases = {
    'signed-in': 'https://myaccount.google.com/?pli=1',
    'redirect-to-accounts': 'https://accounts.google.com/ServiceLogin?continue=x',
    'redirect-to-google': 'https://www.google.com/',
}
out = {}
for name, landing in cases.items():
    out[name] = _probe_flow_login(FakePage(landing))
print(json.dumps(out))
`;

test('Flow 探针按重定向判定登录态', { skip: !ready }, () => {
    const results = runPython(PROBE);

    // 停在 myaccount 才算已登录。
    assert.equal(results['signed-in'].authenticated, true);
    assert.equal(results['signed-in'].reason, 'authenticated');

    // 被重定向走 = 明确未登录，而不是含糊的 unconfirmed。
    // 原实现在这两种情况下都只能报 unconfirmed，用户看到的就是「检查不出来」。
    for (const key of ['redirect-to-accounts', 'redirect-to-google']) {
        assert.equal(results[key].authenticated, false, key);
        assert.equal(results[key].reason, 'not-authenticated', key);
        assert.equal(results[key].evidence, 'redirected-to-signin', key);
    }
});

test('Flow 探针不再依赖那个公开营销页', () => {
    // 静态守卫：这条不需要 venv，任何机器都跑。
    const source = fs.readFileSync(path.join(PYTHON_ROOT, 'ops_cli', 'browser.py'), 'utf8');
    const probe = source.slice(
        source.indexOf('def _probe_flow_login'),
        source.indexOf('def _probe_jimeng_login')
    );
    assert.ok(probe.length > 0, '没找到 _probe_flow_login');

    // 营销页对登录/未登录渲染相同，拿它判定必然失败。
    assert.doesNotMatch(probe, /LOGIN_URLS\["google-flow"\]/);
    assert.doesNotMatch(probe, /data-slate-editor/);
    assert.match(probe, /GOOGLE_ACCOUNT_PROBE_URL/);
});

test('已经是无头 CDP 实例时不重启浏览器', () => {
    const source = fs.readFileSync(path.join(PYTHON_ROOT, 'ops_cli', 'browser.py'), 'utf8');
    const block = source.slice(
        source.indexOf('def check_browser_logins'),
        source.indexOf('def browser_status')
    );

    // 复用判定必须同时满足「无头」与「可被 Playwright 接管」。
    assert.match(block, /_instance_is_headless\(pid\)/);
    assert.match(block, /_instance_supports_playwright\(pid\)/);
    assert.match(block, /if not reusable:\s*\n\s*stop_chrome\(\)/);

    // 但绝不能把 stop_chrome 整个删掉：可见登录实例没有 CDP，
    // 且用户刚登录完的 Cookie 要等它优雅退出才落盘，
    // 跳过会读到没写盘的状态，报出「刚登录成功却显示未登录」。
    assert.match(block, /stop_chrome\(\)/);
});
