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

test('Flow 设置菜单在 Escape 失效时由原按钮强制关闭', {
    skip: ready ? false : '未配置 server/python/.venv'
}, () => {
    const result = runPython(`
import json
from ops_cli.platforms import _google_flow_common as c

class Keyboard:
    def __init__(self, page): self.page = page
    def press(self, key): self.page.keys.append(key)

class Menu:
    def __init__(self, page): self.page = page
    def count(self): return 1 if self.page.open else 0
    def is_visible(self): return self.page.open

class Page:
    def __init__(self):
        self.open = True
        self.keys = []
        self.keyboard = Keyboard(self)
    def wait_for_timeout(self, milliseconds): pass

class Trigger:
    def __init__(self, page):
        self.page = page
        self.forced = False
    def click(self, force=False, timeout=0):
        self.forced = force
        self.page.open = False

page = Page()
trigger = Trigger(page)
c._close_settings_menu(page, Menu(page), trigger)
print(json.dumps({
    "open": page.open,
    "escapes": page.keys.count("Escape"),
    "forced": trigger.forced,
}))
`);

    assert.equal(result.open, false);
    assert.equal(result.escapes, 3);
    assert.equal(result.forced, true);
});

test('Flow 页面出现隐藏副本时选择唯一可见控件', {
    skip: ready ? false : '未配置 server/python/.venv'
}, () => {
    const result = runPython(`
import json
from ops_cli.platforms import _google_flow_common as c

class Node:
    def __init__(self, name, visible):
        self.name = name
        self.visible = visible
    def is_visible(self): return self.visible

class Locator:
    def __init__(self):
        self.nodes = [Node("hidden-copy", False), Node("active-copy", True)]
    def count(self): return len(self.nodes)
    def nth(self, index): return self.nodes[index]

selected = c._exact_count(Locator(), "PAGE_NAVIGATION_FAILED", "ambiguous")
print(json.dumps({"selected": selected.name}))
`);

    assert.equal(result.selected, 'active-copy');
});

test('Flow 生图每次显式选择模型，包括默认 Nano Banana 2', {
    skip: ready ? false : '未配置 server/python/.venv'
}, () => {
    const result = runPython(`
import json
from ops_cli.platforms.text_to_image.providers import google_flow as g

clicks = []

class Node:
    def __init__(self, name): self.name = name
    def filter(self, **kwargs): return self
    def click(self, **kwargs): clicks.append(self.name)
    def count(self): return 1
    def is_visible(self): return True

class Menu(Node):
    def get_by_role(self, role, name=None, exact=False):
        return Node(f"{role}:{name or 'filtered'}")
    def locator(self, selector):
        return Node("model-button")

class Page:
    def get_by_role(self, role, name=None, exact=False):
        return Node(f"{role}:{name}")
    def wait_for_timeout(self, milliseconds): pass

settings = Node("settings")
menu = Menu("menu")
closed = []
g._open_settings_menu = lambda page: (settings, menu)
g._exact_count = lambda locator, code, message: locator
g._close_settings_menu = lambda page, overlay, trigger: closed.append(True)
g._configure_image(Page(), aspect_ratio="1:1", count=1, model=g.DEFAULT_MODEL)
print(json.dumps({"clicks": clicks, "closed": closed}))
`);

    assert.ok(result.clicks.includes('model-button'));
    assert.ok(result.clicks.includes('menuitem:🍌 Nano Banana 2'));
    assert.ok(
        result.clicks.indexOf('menuitem:🍌 Nano Banana 2')
        < result.clicks.indexOf('tab:crop_square 1:1')
    );
    assert.deepEqual(result.closed, [true]);
});

test('Flow 已处于 Image 模式时允许页面省略模式 tab', {
    skip: ready ? false : '未配置 server/python/.venv'
}, () => {
    const result = runPython(`
import json
from ops_cli.platforms.text_to_image.providers import google_flow as g

clicks = []

class Empty:
    def filter(self, **kwargs): return self
    def count(self): return 0
    def nth(self, index): raise IndexError(index)

class Node:
    def __init__(self, name, text=""):
        self.name = name
        self.text = text
    def filter(self, **kwargs): return self
    def locator(self, selector):
        if selector in ('[role="tab"]', 'button', '[role="menuitem"]'):
            return Empty()
        return Node("model-button")
    def get_by_role(self, role, name=None, exact=False):
        return Node(f"{role}:{name}")
    def click(self, **kwargs): clicks.append(self.name)
    def count(self): return 1
    def is_visible(self): return True
    def inner_text(self): return self.text

class Page:
    def get_by_role(self, role, name=None, exact=False):
        return Node(f"{role}:{name}")
    def wait_for_timeout(self, milliseconds): pass

settings = Node("settings", "🍌 Nano Banana 2 crop_square 1x")
menu = Node("menu", "Nano Banana 2 16:9 1:1 1x x2 x3 x4")
g._open_settings_menu = lambda page: (settings, menu)
g._close_settings_menu = lambda page, overlay, trigger: None
g._configure_image(Page(), aspect_ratio="1:1", count=2, model=g.DEFAULT_MODEL)
print(json.dumps({"clicks": clicks}))
`);

    assert.ok(result.clicks.includes('model-button'));
    assert.ok(result.clicks.includes('tab:crop_square 1:1'));
    assert.ok(result.clicks.includes('tab:x2'));
});

test('Flow 多图等待按 URL 去重，不把响应式副本当成多张结果', {
    skip: ready ? false : '未配置 server/python/.venv'
}, () => {
    const result = runPython(`
import json
from ops_cli.platforms import _google_flow_common as c

class Body:
    def inner_text(self, timeout=0): return ""

class Page:
    def locator(self, selector): return Body()
    def wait_for_timeout(self, milliseconds): pass

page, urls = c.wait_for_new_media(
    Page(),
    context=None,
    project_url="https://labs.google/fx/tools/flow/project/test",
    collect_urls=lambda page: [
        "https://example.test/result-1.png",
        "https://example.test/result-1.png",
        "https://example.test/result-2.png",
    ],
    previous_urls=set(),
    previous_failure_count=0,
    timeout_minutes=1,
    min_new=2,
)
print(json.dumps({"urls": urls}))
`);

    assert.deepEqual(result.urls, [
        'https://example.test/result-1.png',
        'https://example.test/result-2.png'
    ]);
});

test('Flow 新版无文字提交按钮按 composer 右侧结构定位', {
    skip: ready ? false : '未配置 server/python/.venv'
}, () => {
    const result = runPython(`
import json
from ops_cli.platforms.text_to_image.providers import google_flow as g

class Control:
    def __init__(self, name, x, *, popup=False, label=""):
        self.name = name
        self.x = x
        self.popup = popup
        self.label = label
    def is_visible(self): return True
    def is_enabled(self): return True
    def get_attribute(self, name):
        if name == "aria-haspopup": return "dialog" if self.popup else None
        if name == "aria-label": return self.label or None
        return None
    def inner_text(self): return ""
    def bounding_box(self): return {"x": self.x, "y": 120, "width": 40, "height": 40}

class Controls:
    def __init__(self, nodes): self.nodes = nodes
    def count(self): return len(self.nodes)
    def nth(self, index): return self.nodes[index]

class Composer:
    def __init__(self, nodes): self.nodes = nodes
    def locator(self, selector): return Controls(self.nodes)

class Prompt:
    def __init__(self, nodes): self.nodes = nodes
    def bounding_box(self): return {"x": 100, "y": 100, "width": 500, "height": 80}
    def locator(self, selector): return Composer(self.nodes)

nodes = [
    Control("upload", 110, popup=True),
    Control("settings", 480, popup=True),
    Control("submit", 610),
]
selected = g._find_generate_button(object(), Prompt(nodes))
print(json.dumps({"selected": selected.name}))
`);

    assert.equal(result.selected, 'submit');
});

test('Flow 提交按钮优先接受 Generate 可访问名称', {
    skip: ready ? false : '未配置 server/python/.venv'
}, () => {
    const result = runPython(`
import json
from ops_cli.platforms.text_to_image.providers import google_flow as g

class Control:
    def __init__(self, name, label, x):
        self.name = name
        self.label = label
        self.x = x
    def is_visible(self): return True
    def is_enabled(self): return True
    def get_attribute(self, name):
        if name == "aria-label": return self.label
        return None
    def inner_text(self): return ""
    def bounding_box(self): return {"x": self.x, "y": 20, "width": 40, "height": 40}

class Controls:
    def __init__(self, nodes): self.nodes = nodes
    def count(self): return len(self.nodes)
    def nth(self, index): return self.nodes[index]

class Composer:
    def __init__(self, nodes): self.nodes = nodes
    def locator(self, selector): return Controls(self.nodes)

class Prompt:
    def __init__(self, nodes): self.nodes = nodes
    def bounding_box(self): return {"x": 100, "y": 100, "width": 500, "height": 80}
    def locator(self, selector): return Composer(self.nodes)

nodes = [
    Control("unrelated-right", "", 620),
    Control("generate", "Generate", 200),
]
selected = g._find_generate_button(object(), Prompt(nodes))
print(json.dumps({"selected": selected.name}))
`);

    assert.equal(result.selected, 'generate');
});
