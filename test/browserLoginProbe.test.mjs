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

test('即梦探针只接受账号接口的明确身份，不把游客编辑器当成登录成功', { skip: !ready }, () => {
    const script = `
import json, sys
sys.path.insert(0, '.')
from ops_cli.browser import _probe_jimeng_login

class FakePage:
    url = 'about:blank'
    def __init__(self, result):
        self.result = result
    def goto(self, url, **kwargs):
        self.url = 'https://jimeng.jianying.com/ai-tool/home'
    def evaluate(self, script, argument):
        return self.result

cases = {
    'signed-in': {'httpStatus': 200, 'message': 'success', 'errorCode': 0, 'hasUserId': True},
    'guest': {'httpStatus': 200, 'message': 'error', 'errorCode': 13, 'hasUserId': False},
    'unknown': {'httpStatus': 503, 'message': '', 'errorCode': None, 'hasUserId': False},
}
print(json.dumps({name: _probe_jimeng_login(FakePage(result)) for name, result in cases.items()}))
`;
    const results = runPython(script);
    assert.equal(results['signed-in'].authenticated, true);
    assert.equal(results['signed-in'].evidence, 'account-api-user-id');
    assert.equal(results.guest.authenticated, false);
    assert.equal(results.guest.reason, 'not-authenticated');
    assert.equal(results.guest.evidence, 'account-api-guest');
    assert.equal(results.unknown.reason, 'unconfirmed');
});

test('Gemini 探针按重定向判定，不再依赖 Gemini 页面 DOM', { skip: !ready }, () => {
    // 回归：原实现要求 gemini.google.com 上「输入框」与「账号态控件」同时可见才算登录。
    // 账号头像由 One Google Bar 以 iframe 注入，主文档选不到 —— 已登录用户也永远落到
    // unconfirmed，界面上就是那句「Gemini 页面结构异常，未获得可用登录证据」。
    const script = `
import json, sys
sys.path.insert(0, '.')
from ops_cli.platforms._gemini_web_common import probe_gemini_login

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
print(json.dumps({name: probe_gemini_login(FakePage(landing)) for name, landing in cases.items()}))
`;
    const results = runPython(script);
    assert.equal(results['signed-in'].authenticated, true);
    assert.equal(results['signed-in'].reason, 'authenticated');

    for (const key of ['redirect-to-accounts', 'redirect-to-google']) {
        assert.equal(results[key].authenticated, false, key);
        // 明确未登录，而不是含糊的 unconfirmed —— 用户看到的才是可操作的提示。
        assert.equal(results[key].reason, 'not-authenticated', key);
        assert.equal(results[key].evidence, 'redirected-to-signin', key);
    }
});

test('Gemini 探针不会因页面结构判 unconfirmed，且确认后回到 Gemini 页面', () => {
    // 静态守卫：不需要 venv。
    const source = fs.readFileSync(
        path.join(PYTHON_ROOT, 'ops_cli', 'platforms', '_gemini_web_common.py'),
        'utf8'
    );
    const probe = source.slice(
        source.indexOf('def probe_gemini_login'),
        source.indexOf('def _single_visible')
    );
    assert.ok(probe.length > 0, '没找到 probe_gemini_login');

    // DOM 形状不能再参与判定，unconfirmed 只能来自探针超时。
    assert.doesNotMatch(probe, /contenteditable/);
    assert.doesNotMatch(probe, /gemini-page-unrecognized/);
    assert.match(probe, /probe_google_account_login/);

    // 探针停在 myaccount.google.com，_ensure_authenticated 必须导航回 Gemini，
    // 否则后续找输入框/边栏会落在错误的站点上。
    const ensure = probe.slice(probe.indexOf('def _ensure_authenticated'));
    assert.match(ensure, /page\.goto\(GEMINI_HOME_URL/);
});

test('登录检查支持 Profile 缺失快速失败和进程内短期缓存', () => {
    const pythonSource = fs.readFileSync(path.join(PYTHON_ROOT, 'ops_cli', 'browser.py'), 'utf8');
    assert.match(pythonSource, /if not PROFILE_DIR\.exists\(\)/);
    assert.match(pythonSource, /"evidence": "profile-missing"/);

    const serverSource = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
    const route = serverSource.slice(
        serverSource.indexOf("app.post('/api/browser-sessions/check'"),
        serverSource.indexOf("app.post('/api/browser/open'")
    );
    assert.match(route, /2 \* 60_000/);
    assert.match(route, /evidence: 'session-cache'/);
    assert.match(route, /req\.body\?\.force === true/);
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

test('可见登录实例占用 Profile 时，生成先关闭它再启动无头 CDP', { skip: !ready }, () => {
    const script = `
import json, sys, tempfile
from pathlib import Path
sys.path.insert(0, 'sessionhub')
from scene import chrome_cdp as c

events = []
checks = iter([(False, 'no-cdp'), (True, 'cdp-ready')])

class FakeProcess:
    pid = 9001

def fake_popen(args, **kwargs):
    events.append({'event': 'launch', 'args': args})
    return FakeProcess()

c.IS_WINDOWS = True
c.CHROME_BIN = Path(sys.executable)
c.PROFILE_DIR = Path(tempfile.mkdtemp()) / 'browser-profile'
c.check_cdp = lambda: next(checks)
c._instance_details_windows = lambda: (
    4242,
    f'"chrome.exe" --user-data-dir="{c.PROFILE_DIR}" --new-window about:blank'
)
c.stop_chrome = lambda known_pid=None: (
    events.append({'event': 'stop', 'pid': known_pid}) or (True, 'closed')
)
c.subprocess.Popen = fake_popen

ok, message = c.start_chrome(headless=True)
print(json.dumps({'ok': ok, 'message': message, 'events': events}))
`;
    const result = runPython(script);

    assert.equal(result.ok, true);
    assert.deepEqual(result.events.map(event => event.event), ['stop', 'launch']);
    assert.equal(result.events[0].pid, 4242);
    assert.ok(result.events[1].args.includes('--headless=new'));
});

test('Windows 重复打开普通登录窗口直接复用，不关闭 Chrome', { skip: !ready }, () => {
    const script = `
import json, sys, tempfile
from pathlib import Path
sys.path.insert(0, 'sessionhub')
from scene import chrome_cdp as c

events = []

class FakeProcess:
    pid = 9002

def fake_popen(args, **kwargs):
    events.append({'event': 'launch', 'args': args})
    return FakeProcess()

c.IS_WINDOWS = True
c.CHROME_BIN = Path(sys.executable)
c.PROFILE_DIR = Path(tempfile.mkdtemp()) / 'browser-profile'
c._instance_details_windows = lambda: (
    4242,
    f'"chrome.exe" --user-data-dir="{c.PROFILE_DIR}" --new-window about:blank'
)
c.stop_chrome = lambda known_pid=None: (
    events.append({'event': 'stop', 'pid': known_pid}) or (True, 'closed')
)
c.subprocess.Popen = fake_popen

ok, message = c.start_login_chrome('https://labs.google/fx/tools/flow')
print(json.dumps({'ok': ok, 'message': message, 'events': events}))
`;
    const result = runPython(script);

    assert.equal(result.ok, true);
    assert.deepEqual(result.events.map(event => event.event), ['launch']);
    assert.match(result.message, /现有/);
});

test('没有环境变量时也落在同一个 Evan 专属 Profile 上', { skip: !ready }, () => {
    // 回归：此前回退到 ~/.sessionhub/evan-browser，于是任何没带
    // SESSIONHUB_CHROME_PROFILE 的调用都会另起一个全新的空 Chrome，还占住 19222。
    // 应用按自己的路径匹配不到进程 → 直接判「端口被占用」硬失败 →
    // 用户明明登录过，界面却永远停在「无法确认」。本机实测复现过。
    const script = `
import json, os, sys
for key in ('SESSIONHUB_CHROME_PROFILE', 'EVAN_BROWSER_PROFILE_DIR'):
    os.environ.pop(key, None)
sys.path.insert(0, 'sessionhub')
from scene.chrome_cdp import PROFILE_DIR
print(json.dumps({'dir': str(PROFILE_DIR)}))
`;
    const { dir } = runPython(script);

    // 必须与 Electron 的 app.getPath('userData') 同源，绝不能再落到 ~/.sessionhub。
    assert.doesNotMatch(dir, /\.sessionhub/);
    assert.match(dir, /Evan AI Video Canvas/);
    assert.match(dir, /browser-profile$/);
});

test('环境变量优先级：显式配置压过默认位置', { skip: !ready }, () => {
    const script = `
import json, os, sys
os.environ['SESSIONHUB_CHROME_PROFILE'] = '/tmp/evan-explicit-profile'
os.environ.pop('EVAN_BROWSER_PROFILE_DIR', None)
sys.path.insert(0, 'sessionhub')
from scene.chrome_cdp import PROFILE_DIR
print(json.dumps({'dir': str(PROFILE_DIR)}))
`;
    // Windows 上 pathlib 会把同一条路径渲染成 \tmp\evan-explicit-profile；
    // 这条断言要验的是「显式配置被采纳」，不是路径分隔符长什么样。
    // 直接比字面量会让 Windows 打包流水线卡在回归测试上（v0.2.0 首次发版实测）。
    assert.equal(path.normalize(runPython(script).dir), path.normalize('/tmp/evan-explicit-profile'));
});
