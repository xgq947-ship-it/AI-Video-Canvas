/**
 * 锁定共享 Hub 的生命周期规则：业务层只申请/释放租约，不直接启动或关闭 Chrome。
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

test('HTTP 桥接只向 Hub 申请租约，并在 finally 释放', () => {
    const source = fs.readFileSync(path.join(PYTHON_ROOT, 'ops_cli', 'webhttp.py'), 'utf8');
    const block = source.slice(
        source.indexOf('def _connect('),
        source.indexOf('def _page_window_name(')
    );

    assert.match(block, /chrome_cdp\.start_chrome/);
    assert.match(block, /stop_chrome\(\)/);
    assert.match(block, /finally:/);
    assert.doesNotMatch(block, /subprocess\.Popen|_instance_is_headless|_instance_supports_playwright/);
});

test('HTTP 平台页按 targetId 注册给当前 Hub 租约', { skip: !ready }, () => {
    const script = `
import json, sys
sys.path.insert(0, 'sessionhub')
from scene import browser_hub as b

events = []
b._lease_id = 'lease-page-test'
b._page_key = 'ai-video-canvas:gemini-web'
b.rpc = lambda method, params=None: events.append({'method': method, 'params': params}) or {'registered': True}
result = b.register_page('target-gemini-1234')
print(json.dumps({'result': result, 'events': events}))
`;
    const result = runPython(script);
    assert.equal(result.result.registered, true);
    assert.deepEqual(result.events, [{
        method: 'page.register',
        params: { leaseId: 'lease-page-test', targetId: 'target-gemini-1234' }
    }]);

    const source = fs.readFileSync(path.join(PYTHON_ROOT, 'ops_cli', 'webhttp.py'), 'utf8');
    assert.match(source, /_register_hub_page\(initial_target_id\)/);
    assert.match(source, /_register_hub_page\(replacement_target_id\)/);
});

test('HTTP 页面只复用明确项目标签，不会占用同域未标记页面', { skip: !ready }, () => {
    const script = `
import json, os, tempfile
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
os.environ['EVAN_RUNTIME_DIR'] = tempfile.mkdtemp(prefix='evan-marker-test-')
from ops_cli.webhttp import WEBHTTP_HASH_KEY, WEBHTTP_WINDOW_PREFIX, _provider_page

class FakePage:
    def __init__(self, url, name='', session='', target_id=''):
        self.url = url
        self.name = name
        self.session = session
        self.target_id = target_id
        self.navigations = []
        self.closed = False
    def is_closed(self): return False
    def close(self): self.closed = True
    def set_default_timeout(self, value): pass
    def evaluate(self, script, arg=None):
        if 'window.sessionStorage.setItem' in script:
            self.name = arg['windowName']
            self.session = arg['provider']
            parsed = urlparse(self.url)
            pairs = [(k, v) for k, v in parse_qsl(parsed.fragment) if k != arg['hashKey']]
            pairs.append((arg['hashKey'], arg['provider']))
            self.url = urlunparse(parsed._replace(fragment=urlencode(pairs)))
            return {'windowName': self.name, 'href': self.url}
        if 'sessionMarker' in script:
            return {
                'windowName': self.name,
                'sessionMarker': self.session,
                'hashMarker': dict(parse_qsl(urlparse(self.url).fragment)).get(WEBHTTP_HASH_KEY, ''),
                'href': self.url,
            }
        if 'window.name ||' in script: return self.name
        return None
    def goto(self, url, **kwargs):
        self.navigations.append(url)
        self.url = url
    def wait_for_timeout(self, value): pass
    def wait_for_load_state(self, state, **kwargs): pass

marker = WEBHTTP_WINDOW_PREFIX + 'gemini-web'
managed = FakePage('https://www.google.com/sorry/index', marker, 'gemini-web', 'managed-target')
manual = FakePage('https://gemini.google.com/app', target_id='manual-target')
context = type('Context', (), {'pages': [managed, manual], 'new_page': lambda self: FakePage('about:blank', target_id='new-target')})()
chosen = _provider_page(context, 'gemini-web')
print(json.dumps({
    'picked_managed': chosen is managed,
    'managed_returned': managed.url.startswith('https://gemini.google.com/app'),
    'manual_untouched': manual.url == 'https://gemini.google.com/app' and not manual.closed and manual.name == '',
}))
`;
    const result = runPython(script);
    assert.deepEqual(result, {
        picked_managed: true,
        managed_returned: true,
        manual_untouched: true
    });
});

test('Flow reCAPTCHA action 由计费请求显式传入，认证探针不会预生成 token', () => {
    const pythonSource = fs.readFileSync(path.join(PYTHON_ROOT, 'ops_cli', 'webhttp.py'), 'utf8');
    const bridgeSource = fs.readFileSync(path.join(ROOT, 'server', 'services', 'webhttp', 'bridge.js'), 'utf8');
    const providerSource = fs.readFileSync(path.join(ROOT, 'server', 'services', 'webhttp', 'flow', 'provider.js'), 'utf8');

    assert.doesNotMatch(pythonSource, /action:\s*['"]generate['"]/);
    assert.match(pythonSource, /recaptchaAction/);
    assert.match(bridgeSource, /--recaptcha-action/);
    assert.match(providerSource, /recaptchaAction:\s*'IMAGE_GENERATION'/);
    assert.match(providerSource, /recaptchaAction:\s*'VIDEO_GENERATION'/);
    assert.match(providerSource, /Never cache a reCAPTCHA token/);
    assert.match(pythonSource, /\/v1\/flow\/models\/statuses/);
    assert.match(pythonSource, /result\.modelConfig\s*=\s*await response\.json\(\)/);
});

test('生成通过 Hub 获取动态 CDP，不直接启动本机 Chrome', { skip: !ready }, () => {
    const script = `
import json, os, sys
os.environ['AI_BROWSER_HUB_ENABLED'] = '1'
sys.path.insert(0, 'sessionhub')
from scene import chrome_cdp as c

events = []
c.browser_hub.acquire_browser = lambda url: (events.append({'event': 'acquire', 'url': url}) or ('http://127.0.0.1:45678', 4242))

target = 'https://labs.google/fx/tools/flow#evan-ai-video-canvas=google-flow'
ok, message = c.start_chrome(headless=True, initial_url=target)
print(json.dumps({'ok': ok, 'message': message, 'events': events, 'port': c.CDP_PORT}))
`;
    const result = runPython(script);

    assert.equal(result.ok, true);
    assert.deepEqual(result.events.map(event => event.event), ['acquire']);
    assert.equal(result.events[0].url, 'https://labs.google/fx/tools/flow#evan-ai-video-canvas=google-flow');
    assert.equal(result.port, 45678);
});

test('打开登录页委托 Hub，业务层不带 CDP 或自动化参数', { skip: !ready }, () => {
    const script = `
import json, os, sys
os.environ['AI_BROWSER_HUB_ENABLED'] = '1'
sys.path.insert(0, 'sessionhub')
from scene import chrome_cdp as c

events = []
c.browser_hub.open_login = lambda url: events.append({'event': 'login', 'url': url}) or {}

ok, message = c.start_login_chrome('https://labs.google/fx/tools/flow')
print(json.dumps({'ok': ok, 'message': message, 'events': events}))
`;
    const result = runPython(script);

    assert.equal(result.ok, true);
    assert.deepEqual(result.events.map(event => event.event), ['login']);
    assert.equal(result.events[0].url, 'https://labs.google/fx/tools/flow');
    assert.match(result.message, /共享/);
});

test('没有环境变量时落在系统共享 Profile', { skip: !ready }, () => {
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
    assert.match(dir, /SankaiAI/);
    assert.match(dir, /AI Browser Hub/);
    assert.match(dir, /profile-v1$/);
});

test('旧 App Profile 环境变量不能覆盖共享 Profile', { skip: !ready }, () => {
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
    assert.notEqual(path.normalize(runPython(script).dir), path.normalize('/tmp/evan-explicit-profile'));
    assert.match(runPython(script).dir, /AI Browser Hub/);
});
