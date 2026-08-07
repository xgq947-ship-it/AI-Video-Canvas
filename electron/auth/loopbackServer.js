/**
 * 一次性 loopback 回调服务器。登录时临时起在 127.0.0.1:{随机端口}，
 * 只接一次 GET /oauth/callback?code=...，拿到一次性登录码后立即关闭。
 *
 * 该端口写进发往 Worker 的 /auth/google/start?port=... ，Worker 校验通过后
 * 把浏览器 302 回这里。绝不监听非 loopback 地址。
 */

import http from 'node:http';

/**
 * 启动 loopback 服务器并等待一次性 code。
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ port: number, waitForCode: () => Promise<string> }>}
 */
export function startLoopbackServer({ timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    let settleCode;
    let rejectCode;
    const codePromise = new Promise((res, rej) => {
      settleCode = res;
      rejectCode = rej;
    });

    let timer = null;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/oauth/callback') {
        res.writeHead(404).end('not found');
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      // 只在响应真正发完（socket flush 完成）后才结算，避免调用方抢先发起 /exchange
      // 而浏览器成功页还没加载——经典 loopback OAuth 竞态。
      res.on('finish', () => {
        cleanup();
        if (error) rejectCode(new Error(`登录失败：${error}`));
        else if (!code) rejectCode(new Error('回调未携带登录码'));
        else settleCode(code);
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pageHtml(!code || !!error));
    });

    function cleanup() {
      if (timer) clearTimeout(timer);
      timer = null;
      // 关闭监听但不阻塞；已建立连接会自然结束。
      server.close();
    }

    server.on('error', reject);

    // 只绑 127.0.0.1，端口交给系统分配。
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      timer = setTimeout(() => {
        cleanup();
        rejectCode(new Error('登录超时，请重试'));
      }, timeoutMs);
      timer.unref?.();

      resolve({ port, waitForCode: () => codePromise });
    });
  });
}

function pageHtml(failed) {
  const title = failed ? '登录未完成' : '登录成功';
  const body = failed ? '未获取到登录码，请回到应用重试。' : '已完成登录，请返回 AI Canvas 应用。';
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#111;color:#eee;display:flex;
min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{text-align:center;max-width:420px;padding:32px}</style></head>
<body><div class="card"><h2>${title}</h2><p>${body}</p><p>可以关闭此页面。</p></div></body></html>`;
}
