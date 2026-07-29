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

test('已有空白页直接成为 keepalive，不再额外制造 about:blank 标签', {
  skip: ready ? false : '未配置 server/python/.venv'
}, () => {
  const result = runPython(`
import json
from ops_cli import browser as b

class Page:
    def __init__(self):
        self.url = "about:blank"
        self.name = ""
        self.closed = False
    def is_closed(self): return self.closed
    def evaluate(self, script, value=None):
        if value is None: return self.name
        self.name = value
        return self.name

class Context:
    def __init__(self):
        self.pages = [Page()]
        self.created = 0
    def new_page(self):
        self.created += 1
        page = Page()
        self.pages.append(page)
        return page

context = Context()
keeper = b.ensure_keepalive_page(context)
print(json.dumps({
    "created": context.created,
    "same": keeper is context.pages[0],
    "name": keeper.name,
}))
`);
  assert.equal(result.created, 0);
  assert.equal(result.same, true);
  assert.equal(result.name, 'ops-cli:keepalive');
});

test('托管任务页无论成功失败都会关闭，原有未标记标签保持不变', {
  skip: ready ? false : '未配置 server/python/.venv'
}, () => {
  const result = runPython(`
import json
from ops_cli import browser as b

class Page:
    def __init__(self, url="about:blank"):
        self.url = url
        self.name = ""
        self.closed = False
    def is_closed(self): return self.closed
    def close(self): self.closed = True
    def evaluate(self, script, value=None):
        if value is None: return self.name
        self.name = value
        return self.name

class Context:
    def __init__(self):
        self.pages = [Page(), Page()]
    def new_page(self):
        page = Page()
        self.pages.append(page)
        return page

context = Context()
try:
    with b.managed_work_page(context, "test.generate", cleanup_before=True) as page:
        page.url = "https://jimeng.jianying.com/ai-tool/generate?type=image"
        raise RuntimeError("task failed")
except RuntimeError:
    pass

alive = [page for page in context.pages if not page.closed]
print(json.dumps({
    "alive": len(alive),
    "urls": [page.url for page in alive],
    "names": [page.name for page in alive],
}))
`);
  assert.equal(result.alive, 2);
  assert.deepEqual(result.urls, ['about:blank', 'about:blank']);
  assert.deepEqual(result.names, ['ops-cli:keepalive', '']);
});

test('清理器只关闭明确标记的重复项目标签，不按空白页或同 URL 误删', {
  skip: ready ? false : '未配置 server/python/.venv'
}, () => {
  const result = runPython(`
import json
from ops_cli.browser import build_tab_cleanup_plan

snapshots = [
    {"index": 0, "url": "about:blank", "window_name": ""},
    {"index": 1, "url": "about:blank", "window_name": ""},
    {"index": 2, "url": "https://labs.google/fx/tools/flow", "window_name": ""},
    {"index": 3, "url": "https://labs.google/fx/tools/flow", "window_name": ""},
    {"index": 4, "url": "https://labs.google/fx/tools/flow", "window_name": "ops-cli:webhttp:google-flow"},
    {"index": 5, "url": "https://labs.google/fx/tools/flow", "window_name": "ops-cli:webhttp:google-flow"},
    {"index": 6, "url": "https://gemini.google.com/app", "window_name": "ops-cli:webhttp:gemini-web"},
]
plan = build_tab_cleanup_plan(snapshots)
print(json.dumps({
    "kept": [item["index"] for item in plan["keep"]],
    "closed": [item["index"] for item in plan["close"]],
    "reasons": [item["reason"] for item in plan["close"]],
}))
`);

  assert.deepEqual(result.kept, [0, 1, 2, 3, 4, 6]);
  assert.deepEqual(result.closed, [5]);
  assert.deepEqual(result.reasons, ['duplicate_managed_marker']);
});
