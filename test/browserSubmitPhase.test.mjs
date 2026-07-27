import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * 「提交阶段」标记的静态守卫。
 *
 * 这是保护用户配额的那道闸：生成请求一旦提交出去，平台就开始扣费了，
 * 此时任何自动重试都会变成二次提交。Python 侧必须如实上报提交阶段，
 * Node 侧才敢重试。
 *
 * 这几个 provider 都是浏览器自动化，没法在 CI 里真跑，所以用静态断言把
 * 结构锁住 —— 有人日后挪动 submitted = True 的位置时会立刻失败。
 */

const PROVIDERS = [
  ['text_to_image/providers/jimeng.py', 'JimengError'],
  ['text_to_image/providers/google_flow.py', 'GoogleFlowError'],
  ['image_to_video/providers/jimeng.py', 'JimengError'],
  ['image_to_video/providers/google_flow.py', 'GoogleFlowError'],
  ['_gemini_web_common.py', 'GeminiWebError']
];

const read = (relative) =>
  fs.readFileSync(new URL(`../server/python/ops_cli/platforms/${relative}`, import.meta.url), 'utf8');

test('四个 provider 都在提交点翻转 submitted 标记', () => {
  for (const [file] of PROVIDERS) {
    const source = read(file);
    // 必须先初始化，否则提交前失败会 UnboundLocalError。
    assert.match(source, /^    submitted = False$/m, `${file} 没有初始化 submitted`);
    assert.match(source, /^\s+submitted = True$/m, `${file} 没有在提交点翻转 submitted`);

    // 初始化必须出现在翻转之前。
    const initAt = source.search(/^    submitted = False$/m);
    const flipAt = source.search(/^\s+submitted = True$/m);
    assert.ok(initAt >= 0 && initAt < flipAt, `${file} 的 submitted 初始化位置不对`);
  }
});

test('提交后抛出的结构化错误会被打上 submitted 标记', () => {
  for (const [file, errorClass] of PROVIDERS) {
    const source = read(file);
    // 允许附加一个排除条件（NOT_SUBMITTED_ERROR_CODES）：平台**明确拒绝**且不会留下
    // 可补收结果的码（目前只有即梦积分不足）不该被标成已提交，否则界面会让用户去
    // 平台历史记录里找一个根本没产生的任务。排除名单的具体内容由
    // jimengResultRecovery.test.mjs 钉死，这里只放行「条件更严」这一种写法。
    assert.match(
      source,
      new RegExp(`except ${errorClass} as exc:[\\s\\S]{0,240}?if submitted(?: and [^\\n:]+)?:[\\s\\S]{0,60}?exc\\.submitted = True`),
      `${file} 的 ${errorClass} 重抛分支没有标记提交阶段`
    );
  }
});

test('兜底 except 把提交阶段一并传出去', () => {
  for (const [file, errorClass] of PROVIDERS) {
    const source = read(file);
    // 这个兜底 except 覆盖整个生成流程，包括提交之后的代码。
    // 不传 submitted 的话，提交后崩溃会被当成可重试，导致二次扣费。
    assert.match(
      source,
      new RegExp(`raise ${errorClass}\\([\\s\\S]{0,200}?submitted=submitted`),
      `${file} 的兜底 except 没有传 submitted`
    );
  }
});

test('两个错误类都接受并保存 submitted', () => {
  for (const relative of ['_google_flow_common.py', 'image_to_video/providers/jimeng.py']) {
    const source = read(relative);
    assert.match(source, /submitted: bool = False/, `${relative} 的错误类缺少 submitted 参数`);
    assert.match(source, /self\.submitted = submitted/, `${relative} 的错误类没有保存 submitted`);
  }
});

test('失败响应里带上 submitted，且拿不准时从严', () => {
  const execution = fs.readFileSync(
    new URL('../server/python/ops_cli/execution.py', import.meta.url), 'utf8'
  );
  // getattr 的默认值必须是 True：无法判断阶段时按「已提交」处理，
  // 宁可让用户手动重试，也不能自动二次提交。
  assert.match(execution, /"submitted": bool\(getattr\(exc, "submitted", True\)\)/);
  assert.match(execution, /data\.setdefault\("submitted", True\)/);
});

test('编辑器等待窗口可由环境变量放宽，且非法值回退到默认', () => {
  const jimeng = read('image_to_video/providers/jimeng.py');
  const flowCommon = read('_google_flow_common.py');
  for (const [name, source] of [['jimeng', jimeng], ['flow', flowCommon]]) {
    assert.match(source, /EVAN_EDITOR_READY_TIMEOUT_S/, `${name} 没有读取放宽用的环境变量`);
    assert.match(source, /except ValueError:/, `${name} 没有处理非法值`);
  }
  // flow 用到了模块级 os，必须在顶层导入（原文件只在函数内局部导入过）。
  assert.match(flowCommon, /^import os$/m);
});
