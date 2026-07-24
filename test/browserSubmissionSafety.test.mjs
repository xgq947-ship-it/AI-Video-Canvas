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

test('Flow 提交后连续读页失败标记 submission unknown，不允许直接重试', {
    skip: ready ? false : '未配置 server/python/.venv'
}, () => {
    const result = runPython(`
import json
from ops_cli.platforms import _google_flow_common as c

class Locator:
    def inner_text(self, timeout=0):
        raise Exception("temporary DOM read failure")

class Page:
    def locator(self, selector): return Locator()
    def is_closed(self): return False

c.time.sleep = lambda seconds: None
try:
    c.wait_for_new_media(
        Page(),
        context=None,
        project_url="https://labs.google/fx/tools/flow/project/test",
        collect_urls=lambda page: [],
        previous_urls=set(),
        previous_failure_count=0,
        timeout_minutes=1,
    )
except c.GoogleFlowError as error:
    print(json.dumps({
        "code": error.error_code,
        "retryable": error.retryable,
        "hint": error.recovery_hint,
    }, ensure_ascii=False))
`);

    assert.equal(result.code, 'SUBMISSION_UNKNOWN');
    assert.equal(result.retryable, false);
    assert.match(result.hint, /项目历史/);
    assert.match(result.hint, /避免/);
});

test('Flow 等待超时视为已提交但结果未知', {
    skip: ready ? false : '未配置 server/python/.venv'
}, () => {
    const result = runPython(`
import json
from ops_cli.platforms import _google_flow_common as c

try:
    c.wait_for_new_media(
        object(),
        context=None,
        project_url="https://labs.google/fx/tools/flow/project/test",
        collect_urls=lambda page: [],
        previous_urls=set(),
        previous_failure_count=0,
        timeout_minutes=0,
    )
except c.GoogleFlowError as error:
    print(json.dumps({
        "code": error.error_code,
        "retryable": error.retryable,
        "hint": error.recovery_hint,
    }, ensure_ascii=False))
`);

    assert.equal(result.code, 'SUBMISSION_UNKNOWN');
    assert.equal(result.retryable, false);
    assert.match(result.hint, /项目历史/);
});
