#!/usr/bin/env node
/**
 * Evan 工作台 · 图形控制面板。
 *
 * 起一个只监听本机的小 HTTP 服务，把控制面板渲染成网页，再用 Chrome 的
 * --app 模式打开 —— 没有地址栏和标签页，看起来就是个原生小窗口。
 *
 * 为什么不用 PowerShell + WinForms：那种写法在 macOS 上连语法都没法校验，
 * 只能交付未验证的代码。用 Node + HTML 则可以在 Mac 上把外观和逻辑全部跑通。
 *
 * 控制逻辑复用 launcher.mjs，不重复实现。
 */

import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { FRONTEND, LOG_FILE, ROOT, openExternal, start, status, stop } from './launcher.mjs';

const PANEL_PORT = 5199;
const IS_WIN = process.platform === 'win32';

// ------------------------------------------------------------------ 页面

const PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Evan 工作台</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    font-family:"PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif;
    background:#141414;color:#e8e8e8;
    height:100vh;display:flex;flex-direction:column;
    padding:22px 24px;user-select:none;-webkit-user-select:none;
  }
  .head{display:flex;align-items:center;gap:11px;margin-bottom:20px}
  .logo{
    width:38px;height:38px;border-radius:10px;flex:0 0 auto;
    background:linear-gradient(135deg,#3b82f6,#2563eb);
    display:flex;align-items:center;justify-content:center;font-size:19px
  }
  .title{font-size:16px;font-weight:600;letter-spacing:.3px}
  .sub{font-size:11.5px;color:#7a7a7a;margin-top:2px}

  .card{background:#1c1c1c;border:1px solid #2b2b2b;border-radius:12px;padding:15px 17px;margin-bottom:16px}
  .row{display:flex;align-items:center;justify-content:space-between;padding:5px 0}
  .row+.row{border-top:1px solid #262626;margin-top:3px;padding-top:9px}
  .lbl{font-size:13px;color:#a8a8a8}
  .val{font-size:12.5px;display:flex;align-items:center;gap:7px}
  .dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto}
  .on{background:#22c55e;box-shadow:0 0 8px rgba(34,197,94,.65)}
  .off{background:#4b4b4b}
  .wait{background:#f59e0b;animation:pulse 1s ease-in-out infinite}
  @keyframes pulse{50%{opacity:.35}}
  .ok{color:#22c55e}.no{color:#6e6e6e}.warn{color:#f59e0b}

  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
  button{
    font-family:inherit;font-size:13.5px;font-weight:500;color:#e8e8e8;
    background:#242424;border:1px solid #333;border-radius:10px;
    padding:12px;cursor:pointer;transition:.15s;
  }
  button:hover:not(:disabled){background:#2e2e2e;border-color:#454545}
  button:active:not(:disabled){transform:translateY(1px)}
  button:disabled{opacity:.4;cursor:not-allowed}
  .primary{
    grid-column:1/-1;background:linear-gradient(135deg,#3b82f6,#2563eb);
    border:none;font-size:15px;font-weight:600;padding:14px
  }
  .primary:hover:not(:disabled){filter:brightness(1.12)}

  .log{
    flex:1;min-height:0;background:#101010;border:1px solid #262626;border-radius:10px;
    padding:11px 13px;font-family:ui-monospace,Menlo,Consolas,monospace;
    font-size:11px;line-height:1.65;color:#8a8a8a;overflow-y:auto;white-space:pre-wrap;
    /* 日志里全是长路径，不折行会撑出横向滚动条 */
    overflow-x:hidden;overflow-wrap:anywhere;word-break:break-word;
    user-select:text;-webkit-user-select:text;
  }
  .log::-webkit-scrollbar{width:7px}
  .log::-webkit-scrollbar-thumb{background:#333;border-radius:4px}
  .foot{margin-top:11px;font-size:10.5px;color:#5c5c5c;text-align:center;line-height:1.6}
</style></head><body>

<div class="head">
  <div class="logo">🎬</div>
  <div>
    <div class="title">Evan 工作台</div>
    <div class="sub" id="root"></div>
  </div>
</div>

<div class="card">
  <div class="row"><span class="lbl">前端画布</span>
    <span class="val"><span class="dot off" id="fd"></span><span class="no" id="ft">检查中…</span></span></div>
  <div class="row"><span class="lbl">后端服务</span>
    <span class="val"><span class="dot off" id="bd"></span><span class="no" id="bt">检查中…</span></span></div>
</div>

<div class="grid">
  <button class="primary" id="open">打开画布</button>
  <button id="restart">重启服务</button>
  <button id="stop">停止服务</button>
  <button id="folder">项目文件夹</button>
  <button id="refresh">刷新日志</button>
</div>

<div class="log" id="log">加载中…</div>
<div class="foot">服务在后台独立运行 · 关闭本窗口不会停止服务</div>

<script>
  const $ = id => document.getElementById(id);
  let busy = false;

  function setBusy(v){
    busy = v;
    ['open','restart','stop'].forEach(id => $(id).disabled = v);
  }

  function paint(s){
    const map = [['fd','ft',s.frontend,'localhost:5173'],['bd','bt',s.backend,'localhost:3001']];
    for (const [dot,txt,on,addr] of map){
      $(dot).className = 'dot ' + (on ? 'on' : 'off');
      $(txt).className = on ? 'ok' : 'no';
      $(txt).textContent = on ? '运行中 · ' + addr : '未运行';
    }
    $('open').textContent = s.running ? '打开画布' : '启动并打开画布';
  }

  async function refresh(){
    try{
      const s = await (await fetch('/api/status')).json();
      paint(s); $('root').textContent = s.root;
    }catch{}
  }

  async function loadLog(){
    try{ $('log').textContent = await (await fetch('/api/log')).text(); $('log').scrollTop = 1e9; }
    catch{ $('log').textContent = '读取日志失败'; }
  }

  async function act(name, pendingText){
    if (busy) return;
    setBusy(true);
    ['fd','bd'].forEach(d => $(d).className = 'dot wait');
    ['ft','bt'].forEach(t => { $(t).className='warn'; $(t).textContent = pendingText; });
    try{
      const r = await (await fetch('/api/' + name, { method:'POST' })).json();
      if (r.error) alert(r.error);
    }catch(e){ alert('操作失败：' + e.message); }
    setBusy(false);
    await refresh(); await loadLog();
  }

  $('open').onclick    = () => act('open', '启动中…');
  $('restart').onclick = () => act('restart', '重启中…');
  $('stop').onclick    = () => act('stop', '停止中…');
  $('folder').onclick  = () => fetch('/api/folder', { method:'POST' });
  $('refresh').onclick = loadLog;

  // Chrome --app 窗口没有"自动居中"参数，这里在页面里按屏幕尺寸摆一次。
  // 非 app 模式（普通标签页）下 moveTo 会被浏览器忽略，无副作用。
  (function centerWindow(){
    try{
      const w = window.outerWidth  || 460;
      const h = window.outerHeight || 700;
      const x = Math.max(0, Math.round((screen.availWidth  - w) / 2) + (screen.availLeft || 0));
      const y = Math.max(0, Math.round((screen.availHeight - h) / 2) + (screen.availTop  || 0));
      window.moveTo(x, y);
    }catch{}
  })();

  refresh(); loadLog();
  setInterval(() => { if (!busy) refresh(); }, 3000);
</script></body></html>`;

// ------------------------------------------------------------------ 服务

/** 去掉终端颜色/控制序列——它们在网页里会显示成 ESC[36m 这类乱码。 */
function stripAnsi(text) {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\r/g, '');
}

/**
 * 解码日志。
 *
 * 中文 Windows 上部分工具按系统码页（GBK）写 stdout，直接按 UTF-8 读会得到
 * "锟斤拷" 那类乱码。这里先按 UTF-8 解，若出现替换字符（U+FFFD）说明猜错了，
 * 再用 GBK 重解一次。Node 22 自带完整 ICU，支持 gbk。
 */
function decodeLog(buffer) {
    const utf8 = new TextDecoder('utf-8').decode(buffer);
    if (!utf8.includes('\uFFFD')) return utf8;
    try {
        return new TextDecoder('gbk').decode(buffer);
    } catch {
        return utf8; // 没有 GBK 支持就退回 UTF-8，至少不崩
    }
}

function tailLog(lines = 200) {
    if (!fs.existsSync(LOG_FILE)) return '还没有日志。点「打开画布」启动服务后这里会有输出。';
    const text = stripAnsi(decodeLog(fs.readFileSync(LOG_FILE)));
    return text.split('\n').slice(-lines).join('\n').trim() || '(日志为空)';
}

/** 把 console 输出临时收进日志文件，避免复用的函数往看不见的 stdout 打字。 */
async function quiet(fn) {
    const original = console.log;
    console.log = () => {};
    try { return await fn(); } finally { console.log = original; }
}

const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    const json = (obj, code = 200) => {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(obj));
    };

    try {
        if (url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(PAGE);
        }
        if (url === '/api/status') {
            return json({ ...(await status()), root: ROOT });
        }
        if (url === '/api/log') {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end(tailLog());
        }
        if (req.method !== 'POST') return json({ error: 'not found' }, 404);

        if (url === '/api/open') {
            const s = await status();
            if (!s.running && !(await quiet(start))) {
                return json({ error: `服务未能在 60 秒内就绪。\n请看下方日志，或检查端口 5173 / 3001 是否被占用。` });
            }
            openExternal(FRONTEND);
            return json({ ok: true });
        }
        if (url === '/api/stop') { await quiet(stop); return json({ ok: true }); }
        if (url === '/api/restart') {
            await quiet(stop);
            const ok = await quiet(start);
            return json(ok ? { ok: true } : { error: '重启失败，请看日志。' });
        }
        if (url === '/api/folder') { openExternal(ROOT); return json({ ok: true }); }
        return json({ error: 'not found' }, 404);
    } catch (error) {
        return json({ error: error.message }, 500);
    }
});

// ------------------------------------------------------------------ 打开面板

/** 优先用 Chrome 的 --app 模式：无地址栏、无标签页，像个原生窗口。 */
function findChrome() {
    const candidates = IS_WIN
        ? [
            `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env.PROGRAMFILES}\\Google\\Chrome Beta\\Application\\chrome.exe`,
            `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
            `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`
        ]
        : process.platform === 'darwin'
            ? [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
                '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
            ]
            : ['/usr/bin/google-chrome', '/usr/bin/chromium'];
    return candidates.find(p => p && fs.existsSync(p)) || null;
}

/** 端口被占时：先判断是不是"面板已经开着"，是就直接复用，否则换个端口。 */
async function listenWithFallback(startPort, maxTries = 10) {
    for (let port = startPort; port < startPort + maxTries; port += 1) {
        const ok = await new Promise(resolve => {
            server.once('error', err => resolve(err.code === 'EADDRINUSE' ? false : Promise.reject(err)));
            server.once('listening', () => resolve(true));
            server.listen(port, '127.0.0.1');
        });
        if (ok) return port;

        // 占用者是不是我们自己之前开的面板？是就直接开它，不重复起服务。
        // 注意：不能只看 HTTP 200 —— 任何一个占用该端口的服务都可能返回 200，
        // 那样会把无关服务误认成面板（实测踩过）。必须校验响应体确实是
        // 本项目的面板：JSON 且 root 指向同一个项目目录。
        try {
            const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
                signal: AbortSignal.timeout(1200)
            });
            const body = res.ok ? await res.json().catch(() => null) : null;
            if (body && body.root === ROOT) {
                openPanel(`http://127.0.0.1:${port}`);
                console.log(`面板已在运行，直接打开：http://127.0.0.1:${port}`);
                process.exit(0);
            }
        } catch {
            // 不是我们的服务，换下一个端口
        }
        server.removeAllListeners('error');
        server.removeAllListeners('listening');
    }
    throw new Error(`端口 ${startPort}-${startPort + maxTries - 1} 都被占用，无法启动控制面板。`);
}

function openPanel(panelUrl) {
    const chrome = findChrome();
    if (chrome) {
        // 位置由页面加载后用 moveTo 居中（这里拿不到屏幕尺寸）。
        spawn(chrome, [`--app=${panelUrl}`, '--window-size=460,700'], {
            detached: true, stdio: 'ignore', windowsHide: false
        }).unref();
    } else {
        // 没有 Chromium 系浏览器就退回默认浏览器（会带地址栏，但功能一致）。
        openExternal(panelUrl);
    }
}

listenWithFallback(PANEL_PORT).then(port => {
    const panelUrl = `http://127.0.0.1:${port}`;
    openPanel(panelUrl);
    console.log(`控制面板：${panelUrl}`);
}).catch(error => {
    console.error(error.message);
    process.exit(1);
});

// 面板窗口关掉后进程还在，给一个兜底退出：无人访问 15 分钟自动退出。
let lastSeen = Date.now();
server.on('request', () => { lastSeen = Date.now(); });
setInterval(() => {
    if (Date.now() - lastSeen > 15 * 60 * 1000) process.exit(0);
}, 60 * 1000).unref();
