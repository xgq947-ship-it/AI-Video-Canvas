/**
 * 锁定 Gemini Web 的「提交阶段」判定。
 *
 * 背景（实测于 gemini.google.com）：
 *   1. 主文档里没有 input[type=file]，参考图只能走「Upload & tools」菜单上传；
 *   2. 附件上传后发送按钮**已渲染但 disabled**，两张 512×512 小图也要约 2 秒才可用；
 *   3. 输入框为空时发送按钮根本不存在。
 *
 * 旧实现上传后只等 1 秒就提交，此时找不到「可用」的发送按钮，于是退回 press("Enter")，
 * 而 Enter 在附件处理期间会被页面吞掉 —— 请求从未发出，却要空等满 5 分钟才报
 * GENERATION_TIMEOUT。界面上就是那句「Gemini 文本任务失败：GENERATION_TIMEOUT」。
 *
 * 浏览器自动化没法在 CI 里真跑，所以用假 page 钉住这几个判定。
 * 未配置轨道 B（无 server/python/.venv）时自动跳过。
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

/** 一个够用的假 Playwright page：按 CSS 选择器返回预置节点，并记录所有交互。 */
const FAKE_PAGE = `
import json, sys
sys.path.insert(0, '.')
from ops_cli.platforms import _gemini_web_common as g

class Node:
    def __init__(self, page, key, index, visible=True, enabled=True, text=''):
        self._page, self._key, self._index = page, key, index
        self._visible, self._enabled, self._text = visible, enabled, text
    def is_visible(self): return self._visible
    def is_enabled(self):
        return self._enabled() if callable(self._enabled) else self._enabled
    def inner_text(self, timeout=None):
        return self._text() if callable(self._text) else self._text
    def click(self, **kw): self._page.events.append(('click', self._key, self._index))
    def press(self, key): self._page.events.append(('press', self._key, key))
    def press_sequentially(self, text, delay=0): self._page.events.append(('type', self._key, text))
    def fill(self, value): self._page.events.append(('fill', self._key, value))

class Locator:
    def __init__(self, page, key, nodes):
        self._page, self._key, self._nodes = page, key, nodes
    def count(self): return len(self._nodes)
    def nth(self, index): return self._nodes[index]
    @property
    def last(self): return self._nodes[-1]
    def inner_text(self, timeout=None): return self._nodes[0].inner_text() if self._nodes else ''

class FakePage:
    """selectors: {css: [Node工厂...]}；未列出的选择器一律返回空。"""
    def __init__(self, selectors, url='https://gemini.google.com/app', body=''):
        self.url = url
        self.body = body
        self.events = []
        self.waits = 0
        self._selectors = selectors
    def locator(self, value):
        if value == 'body':
            return Locator(self, 'body', [Node(self, 'body', 0, text=self.body)])
        spec = self._selectors.get(value, [])
        nodes = [Node(self, value, i, **kw) for i, kw in enumerate(spec)]
        return Locator(self, value, nodes)
    def wait_for_timeout(self, ms): self.waits += ms
    def is_closed(self): return False
`;

test('附件未就绪时不会提交：发送按钮 disabled 期间必须继续等待', { skip: !ready && '未配置 server/python/.venv' }, () => {
    const result = runPython(`${FAKE_PAGE}
# 场景：两张附件已出现，但发送按钮前 3 次轮询都是 disabled（真实页面约 2 秒）。
attempts = {'n': 0}
def enabled():
    attempts['n'] += 1
    return attempts['n'] > 3

page = FakePage({
    'gem-media-attachment': [{}, {}],
    'button[aria-label*="send" i]': [{'enabled': enabled}],
})
g._wait_attachments_ready(page, 2, 30)
print(json.dumps({'polls': attempts['n'], 'waited_ms': page.waits}))
`);
    assert.ok(result.polls > 3, '发送按钮可用前就放行了，附件其实还没处理完');
    assert.ok(result.waited_ms > 0, '没有真正等待，等于回到 wait_for_timeout(1000) 的老毛病');
});

test('附件迟迟不就绪报 REFERENCE_UPLOAD_TIMEOUT，而不是拖到生成超时', { skip: !ready && '未配置 server/python/.venv' }, () => {
    const result = runPython(`${FAKE_PAGE}
page = FakePage({'gem-media-attachment': [{}]})  # 永远没有发送按钮
try:
    g._wait_attachments_ready(page, 2, 0)
    out = {'raised': False}
except g.GeminiWebError as exc:
    out = {'raised': True, 'code': exc.error_code, 'retryable': exc.retryable, 'submitted': exc.submitted}
print(json.dumps(out))
`);
    assert.equal(result.raised, true);
    assert.equal(result.code, 'REFERENCE_UPLOAD_TIMEOUT');
    assert.equal(result.retryable, true);
    assert.equal(result.submitted, false, '还没提交就不能标记 submitted，否则 Node 侧不敢重试');
});

test('发送按钮存在但不可用时，_first_visible 仍能选中输入框（不再要求唯一命中）', { skip: !ready && '未配置 server/python/.venv' }, () => {
    const result = runPython(`${FAKE_PAGE}
# 真实页面里 rich-textarea 下同时有一个隐藏镜像节点；旧的「恰好一个可见」判定会整组作废。
page = FakePage({
    '[contenteditable="true"][role="textbox"]': [{'visible': True, 'text': ''}, {'visible': False}],
})
node = g._first_visible(page, 'prompt_input')
print(json.dumps({'found': node is not None}))
`);
    assert.equal(result.found, true, '存在隐藏镜像节点时选不中输入框，会退化成 Enter 提交');
});

test('提交未落地时抛 SUBMIT_FAILED（可重试、未提交），不冒充已提交', { skip: !ready && '未配置 server/python/.venv' }, () => {
    const result = runPython(`${FAKE_PAGE}
# 输入框始终留着提示词、没有新回答、没有停止按钮 —— 即「Enter 被页面吞掉」的样子。
page = FakePage({
    '[contenteditable="true"][role="textbox"]': [{'text': '提示词还在'}],
})
g.SEND_ENABLED_TIMEOUT_SECONDS = 0
g.SUBMISSION_CONFIRM_TIMEOUT_SECONDS = 0
try:
    g._submit(page, '提示词还在')
    out = {'raised': False}
except g.GeminiWebError as exc:
    out = {'raised': True, 'code': exc.error_code, 'retryable': exc.retryable, 'submitted': exc.submitted}
print(json.dumps(out))
`);
    assert.equal(result.raised, true);
    assert.equal(result.code, 'SUBMIT_FAILED');
    assert.equal(result.submitted, false, '请求没发出去却标成已提交，会让上层拒绝重试');
});

test('输入框被清空即视为提交成功', { skip: !ready && '未配置 server/python/.venv' }, () => {
    const result = runPython(`${FAKE_PAGE}
page = FakePage({
    '[contenteditable="true"][role="textbox"]': [{'text': ''}],
    'button[aria-label*="send" i]': [{}],
})
g._submit(page, '识别这两张图片')
print(json.dumps({'events': [list(map(str, e)) for e in page.events]}))
`);
    const kinds = result.events.map(event => event[0]);
    assert.ok(kinds.includes('fill'), '没有把提示词填进输入框');
    assert.ok(kinds.includes('click'), '有可用发送按钮时应该点击，而不是依赖 Enter');
});

test('模型回答容器不含用户提问，避免把自己的提示词当结果返回', { skip: !ready && '未配置 server/python/.venv' }, () => {
    const result = runPython(`${FAKE_PAGE}
print(json.dumps({'selectors': list(g.SELECTORS['assistant_messages'])}))
`);
    for (const selector of result.selectors) {
        assert.ok(
            !/^message-content$/.test(selector) && !/user-query/.test(selector),
            `${selector} 会同时命中用户提问，新增消息计数会先撞上我们刚发出去的提示词`
        );
    }
    assert.ok(result.selectors.includes('model-response'));
});

test('回答要等稳定才返回，不能抓到第一个字就走', { skip: !ready && '未配置 server/python/.venv' }, () => {
    const result = runPython(`${FAKE_PAGE}
# 流式输出：前几轮文本还在增长且停止按钮可见。
chunks = ['识别中', '识别中：这是', '识别中：这是一台白色圆形按摩仪']
state = {'i': 0}
def text():
    value = chunks[min(state['i'], len(chunks) - 1)]
    state['i'] += 1
    return value

class Streaming(FakePage):
    def locator(self, value):
        if value == 'model-response':
            return Locator(self, value, [Node(self, value, 0, text=text)])
        if value in g.SELECTORS['stop_button'] and state['i'] < len(chunks):
            return Locator(self, value, [Node(self, value, 0)])
        return super().locator(value)
    def wait_for_timeout(self, ms):
        self.waits += ms

page = Streaming({})
g.RESPONSE_STABLE_SECONDS = 0
text_out = g._wait_text_response(page, 0, 1)
print(json.dumps({'text': text_out}))
`);
    assert.equal(result.text, '识别中：这是一台白色圆形按摩仪', '返回了流式输出的中间态，识图结果被截断');
});

test('剥掉 model-response 的无障碍标签，只返回回答正文', { skip: !ready && '未配置 server/python/.venv' }, () => {
    const result = runPython(`${FAKE_PAGE}
page = FakePage({'model-response': [{'text': 'Gemini said\\n\\n第一张图片的主色调是红色。'}]})
print(json.dumps({'text': g._latest_response_text(page)}))
`);
    assert.equal(result.text, '第一张图片的主色调是红色。', '「Gemini said」会被当成识别结果喂给下游提示词');
});
