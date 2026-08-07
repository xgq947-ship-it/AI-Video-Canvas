/** 统一响应工具。错误信息保持粗粒度，不泄露数据库细节（文档 §19）。 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

export function errorJson(code: string, message: string, status = 400): Response {
  return json({ success: false, code, message }, status);
}

export function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

export function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
