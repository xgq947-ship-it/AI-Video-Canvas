/**
 * 锁定即梦等待循环对「页面状态」的判定。
 *
 * 背景：即梦拒绝素材时页面原话是「你上传的图片不符合平台规则，请修改后重试」，
 * 而原有的 FAILURE_MARKERS（生成失败/审核不通过/内容不合规/内容风险）一个都匹配不上，
 * 导致等待循环一直空转到超时或页面关闭，最后报一个与真实原因无关的错误。
 *
 * 这类缺陷靠人工点一次很难复现（要真被审核拦一次），所以用测试钉住。
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

/** 在 venv 里跑一段 Python，返回它打印的 JSON。 */
function runPython(script) {
    const out = execFileSync(VENV_PYTHON, ['-c', script], {
        cwd: PYTHON_ROOT,
        encoding: 'utf8',
        env: { ...process.env, PYTHONPATH: PYTHON_ROOT }
    });
    return JSON.parse(out.trim().split('\n').pop());
}

const PROBE = `
import json, sys
sys.path.insert(0, '.')
from ops_cli.platforms.image_to_video.providers import jimeng as j

class FakePage:
    def __init__(self, text='', exc=None):
        self.text, self.exc = text, exc
    def locator(self, sel):
        page = self
        class L:
            def count(self):
                if page.exc: raise page.exc
                return 1
            @property
            def first(self): return self
            def inner_text(self, timeout=0):
                if page.exc: raise page.exc
                return page.text
            def evaluate_all(self, s): return []
        return L()
    def wait_for_timeout(self, ms): pass

def probe(text=None, exc=None):
    try:
        j._wait_for_videos(FakePage(text or '', exc), previous_urls=set(), expected=1, timeout_minutes=1)
        return {"code": None}
    except j.JimengError as e:
        return {"code": e.error_code, "retryable": e.retryable,
                "message": str(e), "hint": e.recovery_hint or ""}

print(json.dumps(probe(%%ARG%%)))
`;

test('即梦拒绝素材时立刻失败，并带回页面原话（不再空转）', { skip: ready ? false : '未配置 server/python/.venv' }, () => {
    // 与即梦页面实际文案一致
    const real = '你上传的图片不符合平台规则，请修改后重试 | 反馈';
    const r = runPython(PROBE.replace('%%ARG%%', `text=${JSON.stringify(real)}`));

    assert.equal(r.code, 'JIMENG_CONTENT_REJECTED');
    // 同一张素材重试多少次都会被拦，必须标记为不可重试
    assert.equal(r.retryable, false);
    // 必须把页面原话带回去，只回关键词用户判断不了是图片被拒还是提示词被拒
    assert.match(r.message, /不符合平台规则/);
    assert.match(r.hint, /更换参考图/);
});

test('提交后浏览器被关闭时进入状态未知，禁止直接重试', { skip: ready ? false : '未配置 server/python/.venv' }, () => {
    const closed = 'Locator.count: Target page, context or browser has been closed';
    const r = runPython(PROBE.replace('%%ARG%%', `exc=Exception(${JSON.stringify(closed)})`));

    assert.equal(r.code, 'SUBMISSION_UNKNOWN');
    assert.equal(r.retryable, false);
    // 任务可能已提交，必须提醒先去即梦确认，否则重试会重复扣积分
    assert.match(r.hint, /历史会话/);
});

test('普通生成失败与积分不足仍走各自分支（未被新判定误伤）', { skip: ready ? false : '未配置 server/python/.venv' }, () => {
    const fail = runPython(PROBE.replace('%%ARG%%', `text="生成失败，请重试"`));
    assert.equal(fail.code, 'JIMENG_GENERATION_FAILED');
    assert.equal(fail.retryable, true);

    const credits = runPython(PROBE.replace('%%ARG%%', `text="积分不足"`));
    assert.equal(credits.code, 'JIMENG_CREDITS_INSUFFICIENT');
});
