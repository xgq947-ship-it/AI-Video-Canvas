/**
 * 锁定「平台已经出图、我们却没收到」这条链路的兜底。
 *
 * 真实事故（本机 runtime/context 可复盘）：00:31:08 即梦生图提交，同一秒和 10 秒后
 * 分别跑了 browser open / check-login —— 这两个动作会重启或停掉 Chrome。即梦那边照常
 * 出了 4 张图（用户在历史里能看到），我们的工作页却已经不是那一页，于是空轮询满
 * 10 分钟才报 SUBMISSION_UNKNOWN，一次已扣积分的结果就这么丢了。
 *
 * 三条不变量：
 * 1. 页面在等待期间被关闭 / 被导航走要立刻说清楚，不要干等到超时；
 * 2. 等待失败后必须再只读补收一次，收到就正常交付；
 * 3. 补收绝对不能点任何按钮 —— 任务已提交，点击可能触发二次生成、重复扣积分。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const provider = fs.readFileSync(
  new URL('../server/python/ops_cli/platforms/text_to_image/providers/jimeng.py', import.meta.url),
  'utf8'
);
const evidence = fs.readFileSync(
  new URL('../server/python/ops_cli/platforms/_page_evidence.py', import.meta.url),
  'utf8'
);

const block = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + 1);
  assert.ok(from >= 0, `没找到 ${start}`);
  return source.slice(from, to > from ? to : undefined);
};

test('等待期间工作页被换掉要立刻判定，而不是空等到超时', () => {
  const disturbed = block(provider, 'def _page_disturbed', 'def _image_urls');
  assert.match(disturbed, /is_closed\(\)/);
  assert.match(disturbed, /JIMENG_HOST not in host/);

  const wait = block(provider, 'def _wait_for_images', 'def _deliver_results');
  assert.match(wait, /disturbed = _page_disturbed\(page\)/);
  // 判定必须在读页面文本之前，否则页面已经没了还要先吃一次读取异常。
  assert.ok(
    wait.indexOf('_page_disturbed') < wait.indexOf('_result_area_text'),
    '页面存活判定要放在读取结果区之前'
  );
});

test('等待超时前留下可复盘的现场', () => {
  const wait = block(provider, 'def _wait_for_images', 'def _deliver_results');
  assert.match(wait, /capture_page_evidence\(/);
  assert.match(wait, /scene="jimeng_image_wait_timeout"/);
  // 只报「没等到」而不带现场，下次遇到还是只能靠猜。
  assert.match(wait, /container_selector=RESULT_AREA_SELECTOR/);

  // 取证要能区分「页面上根本没有 img」和「有图但被某级筛选挡掉」。
  assert.match(evidence, /naturalOk/);
  assert.match(evidence, /renderedOk/);
  // 取证本身失败不能盖掉真正的错误。
  assert.match(evidence, /def _safe/);
});

test('等待失败后只读补收一次，且绝不重新提交', () => {
  const execute = block(provider, 'def _execute_generation', 'def run_image_generate');
  assert.match(execute, /except JimengError as wait_error:/);
  assert.match(execute, /wait_error\.error_code != "SUBMISSION_UNKNOWN"/);
  assert.match(execute, /_reclaim_images\(/);

  const reclaim = block(provider, 'def _reclaim_images', 'def _execute_generation');
  assert.match(reclaim, /page\.goto\(_generate_url\(\)/);
  // 只读：不许出现任何点击 / 提交。
  assert.doesNotMatch(reclaim, /\.click\(/);
  assert.doesNotMatch(reclaim, /_submit\(/);
  // 补收页不能带 cleanup_before=True，否则会顺手关掉别的任务的工作页。
  assert.match(execute, /"jimeng\.image\.reclaim", cleanup_before=False/);

  // 补收失败要把原始错误抛出去，不能吞掉变成「成功但没有图」。
  assert.match(execute, /if not image_urls:\s*\n\s*raise/);
});

test('两条交付路径共用同一段落盘逻辑', () => {
  // 等待成功与补收成功如果各写一份下载代码，产物格式迟早漂移。
  const execute = block(provider, 'def _execute_generation', 'def run_image_generate');
  assert.equal(execute.match(/_deliver_results\(/g)?.length, 2);
  assert.match(provider, /def _deliver_results\(/);
});

test('结果图按长边判定尺寸，16:9 / 9:16 不能被短边卡掉', () => {
  // 现场实测（evidence jimeng_image_wait_timeout_20260727_072406 + CDP 实时扫描）：
  // 即梦结果区缩略图统一按长边 360 渲染。1:1 是 360×360，两边都过；16:9 是 360×202，
  // 短边 202 被「两边都 ≥256」卡掉 —— 4 张结果一张也收不到，只能空等到 10 分钟超时，
  // 而平台那边图早就出好了。这条规则是整条链路能不能拿到结果的命门。
  const extractFilterExpression = source => {
    const match = source.match(
      /\.filter\(item =>(?<expression>[\s\S]*?)\)\r?\n\s*\.map\(item => item\.src\)/
    );
    assert.ok(match?.groups?.expression, '应能提取图片尺寸过滤表达式');
    return match.groups.expression;
  };
  const filterExpression = extractFilterExpression(provider);
  assert.equal(
    extractFilterExpression(provider.replace(/\r?\n/g, '\r\n')).replace(/\r\n/g, '\n'),
    filterExpression.replace(/\r\n/g, '\n'),
    'Windows CRLF 检出不能改变过滤表达式'
  );
  const hit = (width, height, renderedWidth, renderedHeight) =>
    new Function('item', `return ${filterExpression}`)({
      src: 'https://p26-dreamina-sign.byteimg.com/x', width, height, renderedWidth, renderedHeight
    });

  // 真结果：三种画幅都必须收得到
  assert.equal(hit(360, 202, 238, 134), true, '16:9 结果图');
  assert.equal(hit(360, 360, 238, 238), true, '1:1 结果图');
  assert.equal(hit(202, 360, 134, 238), true, '9:16 结果图');

  // 噪声：侧栏会话缩略图、composer 小预览、头像都不能混进来
  assert.equal(hit(100, 56, 32, 32), false, '侧栏会话缩略图');
  assert.equal(hit(360, 360, 42, 53), false, 'composer 小预览');
  assert.equal(hit(64, 64, 24, 24), false, '头像');
});

test('补收窗口必须塞得进 Node 侧的超时余量', () => {
  // Python 判超时后才开始补收，两边余量给反了的话，兜底刚起步就被 kill，
  // 用户拿到的仍然是「执行超时」（本机 07:13 那次就是这么丢的）。
  const reclaimSeconds = Number(provider.match(/wait_seconds: int = (\d+)/)[1]);
  const workflow = fs.readFileSync(
    new URL('../server/services/jimengImageWorkflow.js', import.meta.url), 'utf8'
  );
  const marginMinutes = Number(workflow.match(/timeoutMs: \(timeoutMinutes \+ (\d+)\)/)[1]);
  assert.ok(
    reclaimSeconds + 30 < marginMinutes * 60,
    `补收 ${reclaimSeconds}s 必须留在 Node 余量 ${marginMinutes} 分钟之内并留出下载时间`
  );
});

test('积分不足要给出可执行提示，且不被标成「提交状态未知」', () => {
  // 本机实测（2026-07-27）：即梦账号无积分时，链路一路走通到结果区，页面提示「积分不足」，
  // 被正确识别成 JIMENG_CREDITS_INSUFFICIENT。但两处不对：
  // 1) 兄弟错误码（SUBMISSION_UNKNOWN / JIMENG_CONTENT_REJECTED）都带 recovery_hint，
  //    只有积分不足没有，用户看到的就是一句「积分不足。」没有下文。
  // 2) 它发生在 _submit 之后，被 `if submitted: exc.submitted = True` 一刀切标成已提交，
  //    产品短视频节点据此把任务标成「提交状态未知，请先检查平台历史记录」——
  //    可积分不足根本没有产生生成任务，让用户去翻历史记录纯属误导。
  for (const relative of [
    'server/python/ops_cli/platforms/text_to_image/providers/jimeng.py',
    'server/python/ops_cli/platforms/image_to_video/providers/jimeng.py',
  ]) {
    const source = fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

    // 精确锚在 raise 处：源码里还有一处同名字符串是 NOT_SUBMITTED_ERROR_CODES 的定义。
    assert.match(
      source,
      /raise JimengError\(\s*\r?\n\s*"JIMENG_CREDITS_INSUFFICIENT",[\s\S]{0,400}?recovery_hint=\(/,
      `${relative} 的积分不足缺少 recovery_hint`
    );

    // 一刀切打标必须给「平台明确拒绝」的码留出口。
    assert.match(
      source,
      /if submitted and exc\.error_code not in NOT_SUBMITTED_ERROR_CODES:/,
      `${relative} 仍在无条件把提交后的错误标成 submitted`
    );
  }

  // 常量只定义一处，图片侧 import 复用，避免两边漂移。
  const video = fs.readFileSync(
    new URL('../server/python/ops_cli/platforms/image_to_video/providers/jimeng.py', import.meta.url), 'utf8'
  );
  assert.match(video, /^NOT_SUBMITTED_ERROR_CODES = frozenset\(\{"JIMENG_CREDITS_INSUFFICIENT"\}\)\r?$/m);
  const image = fs.readFileSync(
    new URL('../server/python/ops_cli/platforms/text_to_image/providers/jimeng.py', import.meta.url), 'utf8'
  );
  assert.match(image, /^\s*NOT_SUBMITTED_ERROR_CODES,\r?$/m, '图片侧应 import 同一个常量而不是各写一份');
});
