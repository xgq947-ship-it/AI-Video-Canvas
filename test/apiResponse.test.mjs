import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_BACKEND_RESTART_MESSAGE,
  readApiResponse
} from '../src/utils/apiResponse.js';

test('API 返回 JSON 错误时保留后台给出的具体原因', async () => {
  const response = new Response(JSON.stringify({ error: '项目文件夹不存在或磁盘未连接' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' }
  });

  await assert.rejects(
    readApiResponse(response, '读取回收站失败'),
    /项目文件夹不存在或磁盘未连接/
  );
});

test('新版页面连接旧后台时提示用户完全退出并重启', async () => {
  const response = new Response(
    '<!doctype html><html><body>Cannot POST /api/projects/demo/trash</body></html>',
    { status: 404, headers: { 'Content-Type': 'text/html' } }
  );

  await assert.rejects(
    readApiResponse(response, '移入回收站失败'),
    error => error.message === DEFAULT_BACKEND_RESTART_MESSAGE
  );
});

test('成功响应只解析一次并返回 JSON', async () => {
  const response = new Response(JSON.stringify({ success: true }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' }
  });

  assert.deepEqual(
    await readApiResponse(response, '保存失败'),
    { success: true }
  );
});
