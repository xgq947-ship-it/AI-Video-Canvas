/**
 * 锁定 Evan 专属 Chrome 的生命周期规则：「不做无谓重启」，但该重启时必须重启。
 *
 * 登录态判定本身已经全部改成 HTTP（见 test/webAuthStatus.test.mjs 与
 * server/services/webhttp/auth.js），原来基于 DOM / 重定向的探针连同它们的用例
 * 一起删除。这里只保留仍然成立的浏览器实例复用规则。
 *
 * 背景（本机实测，非推断）：无条件 stop_chrome() 会摧毁 start_chrome 自带的复用分支，
 * 每次都要付一次完整冷启动；实测两个平台一起检查 39.5s → 5.6s。
 * 但可见登录实例没有 CDP，且刚登录的 Cookie 要等它优雅退出才落盘，
 * 所以不可复用的实例仍然必须先关掉。
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

test('已经是无头 CDP 实例时不重启浏览器', () => {
    // 这条规则随登录检测一起从 browser.py 迁到了 HTTP 桥接层：
    // 现在所有平台请求（含登录检测）都经由 webhttp._connect 拿到浏览器上下文。
    const source = fs.readFileSync(path.join(PYTHON_ROOT, 'ops_cli', 'webhttp.py'), 'utf8');
    const block = source.slice(
        source.indexOf('def _connect('),
        source.indexOf('def _page_window_name(')
    );

    // 复用判定必须同时满足「无头」与「可被 Playwright 接管」。
    assert.match(block, /_instance_is_headless\(pid\)/);
    assert.match(block, /_instance_supports_playwright\(pid\)/);
    assert.match(block, /if not reusable:\s*\n\s*chrome_cdp\.stop_chrome\(\)/);

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
