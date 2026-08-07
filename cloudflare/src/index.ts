/**
 * AI Canvas Auth Worker —— 入口路由。
 * P1：Google OAuth 登录、桌面会话签发/刷新。后续阶段（设备状态/授权码/活跃上报）在此挂载。
 */

import type { Env } from './env.js';
import { errorJson, preflight } from './lib/http.js';
import {
  handleGoogleStart,
  handleGoogleCallback,
  handleExchange,
  handleRefresh,
  handleLogout,
  handleMe,
} from './routes/auth.js';
import { handleDeviceStatus } from './routes/device.js';
import { handleLicenseActivate, handleLicenseRestore } from './routes/license.js';
import { handleReportActivity } from './routes/activity.js';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return preflight();

    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      if (path === '/health') return new Response('ok');

      if (path === '/auth/google/start' && method === 'GET') return handleGoogleStart(req, env);
      if (path === '/auth/google/callback' && method === 'GET') return handleGoogleCallback(req, env);
      if (path === '/auth/exchange' && method === 'POST') return handleExchange(req, env);
      if (path === '/auth/refresh' && method === 'POST') return handleRefresh(req, env);
      if (path === '/auth/logout' && method === 'POST') return handleLogout(req, env);
      if (path === '/auth/me' && method === 'GET') return handleMe(req, env);

      if (path === '/api/device/status' && method === 'POST') return handleDeviceStatus(req, env);

      if (path === '/api/license/activate' && method === 'POST') return handleLicenseActivate(req, env);
      if (path === '/api/license/restore' && method === 'POST') return handleLicenseRestore(req, env);

      if (path === '/api/report-activity' && method === 'POST') return handleReportActivity(req, env);

      return errorJson('NOT_FOUND', '未知路由', 404);
    } catch (err) {
      console.error('[worker] 未捕获错误', err);
      return errorJson('SERVER_ERROR', '服务器内部错误', 500);
    }
  },
};
