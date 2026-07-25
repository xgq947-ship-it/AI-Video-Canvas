/**
 * 即梦参数弹层回归：
 * 新版页面选择 2K 后可能留下 value=2048 的输入框覆盖提示词编辑器，
 * 导致 Playwright 的 editor.click() 被拦截 30 秒。
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
    const output = execFileSync(VENV_PYTHON, ['-c', script], {
        cwd: PYTHON_ROOT,
        encoding: 'utf8',
        env: { ...process.env, PYTHONPATH: PYTHON_ROOT }
    });
    return JSON.parse(output.trim().split('\n').pop());
}

test('Escape 失效时会切换设置按钮，确保即梦弹层关闭', {
    skip: ready ? false : '未配置 server/python/.venv'
}, () => {
    const result = runPython(`
import json
from ops_cli.platforms.image_to_video.providers import jimeng as j

class Keyboard:
    def __init__(self, page):
        self.page = page
    def press(self, key):
        self.page.keys.append(key)

class Popovers:
    def __init__(self, page):
        self.page = page
    def count(self):
        return self.page.popovers

class Page:
    def __init__(self):
        self.popovers = 1
        self.keys = []
        self.keyboard = Keyboard(self)
    def locator(self, selector):
        assert selector == ".lv-popover:visible"
        return Popovers(self)
    def wait_for_timeout(self, milliseconds):
        pass

class Trigger:
    def __init__(self, page):
        self.page = page
        self.force = False
    def click(self, force=False, timeout=0):
        self.force = force
        self.page.popovers = 0

page = Page()
trigger = Trigger(page)
j._close_transient_popovers(page, trigger=trigger)
print(json.dumps({
    "remaining": page.popovers,
    "escapes": page.keys.count("Escape"),
    "forcedToggle": trigger.force,
}))
`);

    assert.equal(result.remaining, 0);
    assert.equal(result.escapes, 3);
    assert.equal(result.forcedToggle, true);
});

test('提示词编辑器直接 focus 写入，不再使用会被浮层拦截的 click', {
    skip: ready ? false : '未配置 server/python/.venv'
}, () => {
    const result = runPython(`
import json
from ops_cli.platforms.image_to_video.providers import jimeng as j

class Editor:
    def __init__(self, visible=True):
        self.text = ""
        self.focused = False
        self.clicked = False
        self.visible = visible
    def is_visible(self):
        return self.visible
    def focus(self):
        self.focused = True
    def click(self):
        self.clicked = True
        raise AssertionError("不应使用鼠标点击编辑器")
    def inner_text(self):
        return self.text

class Keyboard:
    def __init__(self, editor):
        self.editor = editor
    def press(self, key):
        if key == "Backspace":
            self.editor.text = ""
    def insert_text(self, text):
        self.editor.text = text

class Page:
    def __init__(self):
        self.editors = [Editor(False), Editor(True)]
        self.keyboard = Keyboard(self.editors[1])
    def locator(self, selector):
        assert selector == j.PROMPT_EDITOR
        page = self
        class Editors:
            def count(self): return len(page.editors)
            def nth(self, index): return page.editors[index]
        return Editors()
    def wait_for_timeout(self, milliseconds):
        pass

page = Page()
j._fill_prompt(page, "一只戴红围巾的猫")
print(json.dumps({
    "hiddenFocused": page.editors[0].focused,
    "focused": page.editors[1].focused,
    "clicked": page.editors[1].clicked,
    "text": page.editors[1].text,
}, ensure_ascii=False))
`);

    assert.equal(result.hiddenFocused, false);
    assert.equal(result.focused, true);
    assert.equal(result.clicked, false);
    assert.equal(result.text, '一只戴红围巾的猫');
});

test('上传参考图后优先选择当前 composer，并重新解析重挂载的编辑器', {
    skip: ready ? false : '未配置 server/python/.venv'
}, () => {
    const result = runPython(`
import json
from ops_cli.platforms.image_to_video.providers import jimeng as j

class Editor:
    def __init__(self, name, score):
        self.name = name
        self.score = score
        self.text = "结合参考、输入文字或参考内容，描述你想如何调整图片。"
        self.focused = False
    def is_visible(self): return True
    def evaluate(self, script, arg=None):
        if arg is None:
            return self.score
        self.focused = True
        self.text = arg
        return True
    def inner_text(self): return self.text

class Editors:
    def __init__(self, nodes): self.nodes = nodes
    def count(self): return len(self.nodes)
    def nth(self, index): return self.nodes[index]

class Keyboard:
    def press(self, key): pass
    def insert_text(self, text): raise AssertionError("原子写入成功后不应走键盘兜底")

class Page:
    def __init__(self):
        self.stale = Editor("stale", 10)
        self.composer = Editor("composer", 100000)
        self.keyboard = Keyboard()
    def locator(self, selector):
        assert selector == j.PROMPT_EDITOR
        return Editors([self.stale, self.composer])
    def wait_for_timeout(self, milliseconds): pass

page = Page()
j._fill_prompt(page, "给这个@参考图1 戴一顶帽子")
print(json.dumps({
    "stale": page.stale.text,
    "composer": page.composer.text,
    "composerFocused": page.composer.focused,
}, ensure_ascii=False))
`);

    assert.match(result.stale, /结合参考/);
    assert.equal(result.composer, '给这个@参考图1 戴一顶帽子');
    assert.equal(result.composerFocused, true);
});

test('即梦多图按媒体路径去重，不把 p11/p26 CDN 副本当成两张图', {
    skip: ready ? false : '未配置 server/python/.venv'
}, () => {
    const result = runPython(`
import json
from ops_cli.platforms.text_to_image.providers import jimeng as j

class Page:
    def wait_for_timeout(self, milliseconds): pass

j._result_area_text = lambda page: ""
j._image_urls = lambda page: [
    "https://p11-dreamina-sign.byteimg.com/tos-cn-i/first~resize:360.webp?x-signature=one",
    "https://p26-dreamina-sign.byteimg.com/tos-cn-i/first~resize:360.webp?x-signature=two",
    "https://p11-dreamina-sign.byteimg.com/tos-cn-i/second~resize:360.webp?x-signature=three",
]
urls = j._wait_for_images(Page(), previous_urls=set(), expected=2, timeout_minutes=1)
print(json.dumps({
    "sameIdentity": j._image_identity(j._image_urls(None)[0]) == j._image_identity(j._image_urls(None)[1]),
    "urls": urls,
}))
`);

    assert.equal(result.sameIdentity, true);
    assert.equal(result.urls.length, 2);
    assert.match(result.urls[0], /first/);
    assert.match(result.urls[1], /second/);
});

test('即梦图片模式把有效 @参考图标签转成可提交文本', {
    skip: ready ? false : '未配置 server/python/.venv'
}, () => {
    const result = runPython(`
import json
from ops_cli.platforms.text_to_image.providers import jimeng as j

print(json.dumps({
    "withRefs": j._prompt_for_image_composer(
        "让@参考图1 和 @图片2 保持外观，忽略@参考图3",
        2,
    ),
    "withoutRefs": j._prompt_for_image_composer("保留@参考图1", 0),
}, ensure_ascii=False))
`);

    assert.equal(result.withRefs, '让参考图1 和 图片2 保持外观，忽略@参考图3');
    assert.equal(result.withoutRefs, '保留@参考图1');
});

test('即梦上传参考图后的素材合规弹窗会点击特定确认按钮', {
    skip: ready ? false : '未配置 server/python/.venv'
}, () => {
    const result = runPython(`
import json
from ops_cli.platforms.image_to_video.providers import jimeng as j

class Confirm:
    def __init__(self): self.clicked = False
    def count(self): return 1
    def nth(self, index): return self
    def is_visible(self): return True
    def click(self, timeout=0): self.clicked = True

class Dialog:
    def __init__(self, confirm): self.confirm = confirm
    def is_visible(self): return True
    def inner_text(self, timeout=0): return "素材合规校验\\n确认"
    def get_by_text(self, pattern): return self.confirm

class Dialogs:
    def __init__(self, dialog): self.dialog = dialog
    def count(self): return 1
    def nth(self, index): return self.dialog

class Page:
    def __init__(self):
        self.confirm = Confirm()
        self.dialogs = Dialogs(Dialog(self.confirm))
    def locator(self, selector): return self.dialogs
    def wait_for_timeout(self, milliseconds): pass

page = Page()
j._dismiss_overlays(page)
print(json.dumps({"confirmed": page.confirm.clicked}))
`);

    assert.equal(result.confirmed, true);
});

test('即梦结果采集只读取主记录区并要求足够的显示尺寸', {
    skip: ready ? false : '未配置 server/python/.venv'
}, () => {
    const result = runPython(`
import json
from ops_cli.platforms.text_to_image.providers import jimeng as j

class Images:
    def evaluate_all(self, script):
        assert "renderedWidth >= 96" in script
        assert "renderedHeight >= 96" in script
        return ["https://p11-dreamina-sign.byteimg.com/result.webp"]

class Area:
    def locator(self, selector):
        assert selector == "img"
        return Images()

class Areas:
    def count(self): return 1
    @property
    def first(self): return Area()

class Page:
    def locator(self, selector):
        assert selector == "[class*='record-list']"
        return Areas()

print(json.dumps({"urls": j._image_urls(Page())}))
`);

    assert.deepEqual(result.urls, ['https://p11-dreamina-sign.byteimg.com/result.webp']);
});

test('即使游客页渲染了完整编辑器，也必须先报告未登录', {
    skip: ready ? false : '未配置 server/python/.venv'
}, () => {
    const result = runPython(`
import json
from ops_cli.platforms.image_to_video.providers import jimeng as j

class EmptyLocator:
    @property
    def first(self): return self
    def filter(self, **kwargs): return self
    def count(self): return 0
    def nth(self, index): raise IndexError(index)

class LoginControl:
    def count(self): return 1
    def nth(self, index): return self
    def is_visible(self): return True

class Page:
    url = "https://jimeng.jianying.com/ai-tool/home?type=image"
    def locator(self, selector): return EmptyLocator()
    def get_by_role(self, role, **kwargs):
        assert role == "menuitem"
        return LoginControl() if kwargs.get("name") == "登录" else EmptyLocator()
    def wait_for_timeout(self, milliseconds): pass

j._bring_login_browser_to_front = lambda: None
try:
    j._ensure_composer(Page(), timeout_seconds=1)
except j.JimengError as error:
    print(json.dumps({"code": error.error_code, "retryable": error.retryable}, ensure_ascii=False))
`);

    assert.equal(result.code, 'AUTH_REQUIRED');
    assert.equal(result.retryable, true);
});

test('即梦结果本地保存失败时保留 HTTP 地址给 Node 层接管', {
    skip: ready ? false : '未配置 server/python/.venv'
}, () => {
    const result = runPython(`
import json
from ops_cli.platforms.image_to_video.providers import jimeng as j

j._ensure_result_delivery(
    [{"path": None, "url": "https://example.test/result.mp4"}],
    error_code="VIDEO_DOWNLOAD_FAILED",
    media_label="视频",
)
try:
    j._ensure_result_delivery(
        [{"path": None, "url": "blob:https://jimeng.jianying.com/temp"}],
        error_code="VIDEO_DOWNLOAD_FAILED",
        media_label="视频",
    )
except j.JimengError as error:
    print(json.dumps({
        "httpAccepted": True,
        "code": error.error_code,
        "retryable": error.retryable,
        "hint": error.recovery_hint,
    }, ensure_ascii=False))
`);

    assert.equal(result.httpAccepted, true);
    assert.equal(result.code, 'VIDEO_DOWNLOAD_FAILED');
    assert.equal(result.retryable, false);
    assert.match(result.hint, /历史会话.*不要直接重新生成/);
});
