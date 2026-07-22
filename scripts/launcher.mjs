#!/usr/bin/env node
/**
 * Evan 工作台启动管理器（跨平台）。
 *
 * 与 macOS 那个 AppleScript 版功能对齐：启动 / 停止 / 重启 / 状态 / 日志 / 打开画布。
 *
 * 为什么用 Node 而不是 PowerShell 或 .bat：
 * 1. 项目本来就依赖 Node，不引入新运行时；
 * 2. 一份代码三个平台通用，不用维护 .bat 和 .sh 两套；
 * 3. **可以在 macOS 上测试**——纯 PowerShell 的话，在 Mac 上连语法都验不了。
 *
 * Windows 上由 launcher-windows/Evan工作台.bat 双击调起。
 */

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
export const FRONTEND = 'http://localhost:5173';
const BACKEND = 'http://localhost:3001/api/capabilities';
const PORTS = [5173, 3001];
const LOG_DIR = path.join(ROOT, 'logs');
export const LOG_FILE = path.join(LOG_DIR, 'dev-server.log');

// ---------------------------------------------------------------- 健康检查

async function ping(url, timeoutMs = 2000) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        return res.ok;
    } catch {
        return false;
    }
}

export async function status() {
    const [frontend, backend] = await Promise.all([ping(FRONTEND), ping(BACKEND)]);
    return { frontend, backend, running: frontend && backend };
}

// ---------------------------------------------------------------- 进程控制

/** 找出占用指定端口的进程 PID（跨平台）。 */
function pidsOnPort(port) {
    try {
        if (IS_WIN) {
            // netstat 输出末列是 PID；只取 LISTENING 行，避免误杀客户端连接。
            const out = execSync(`netstat -ano -p TCP | findstr LISTENING | findstr :${port}`, {
                encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
            });
            return [...new Set(
                out.split('\n')
                    .map(line => line.trim().split(/\s+/).pop())
                    .filter(pid => /^\d+$/.test(pid) && pid !== '0')
            )];
        }
        const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
        });
        return out.split('\n').map(s => s.trim()).filter(Boolean);
    } catch {
        return []; // 没有匹配时 findstr/lsof 以非 0 退出，属正常
    }
}

function killPid(pid) {
    try {
        if (IS_WIN) {
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        } else {
            process.kill(Number(pid), 'SIGTERM');
        }
        return true;
    } catch {
        return false;
    }
}

export async function start() {
    const s = await status();
    if (s.running) {
        console.log('✅ 服务已在运行，无需重复启动');
        return true;
    }

    fs.mkdirSync(LOG_DIR, { recursive: true });
    const logFd = fs.openSync(LOG_FILE, 'a');
    fs.writeSync(logFd, `\n===== ${new Date().toLocaleString()} 启动 =====\n`);

    // Windows 的 npm 是 npm.cmd；直接 spawn('npm') 会 ENOENT。
    // Windows：不能用 shell:true —— 那会弹出一个 cmd 黑框并且关不掉。
    // 改为显式调 cmd.exe /c 并配合 windowsHide，后端就完全静默地跑在后台。
    const [cmd, args] = IS_WIN
        ? ['cmd.exe', ['/c', 'npm', 'run', 'dev']]
        : ['npm', ['run', 'dev']];
    const child = spawn(cmd, args, {
        cwd: ROOT,
        detached: true,              // 脱离本进程，关掉菜单窗口服务仍在跑
        stdio: ['ignore', logFd, logFd],
        windowsHide: true            // 不弹控制台窗口
    });
    child.unref();

    process.stdout.write('启动中');
    for (let i = 0; i < 60; i += 1) {
        await new Promise(r => setTimeout(r, 1000));
        process.stdout.write('.');
        const now = await status();
        if (now.running) {
            console.log('\n✅ 服务已启动');
            return true;
        }
    }
    console.log(`\n❌ 60 秒内未能全部就绪。请查看日志：\n   ${LOG_FILE}`);
    return false;
}

export async function stop() {
    let killed = 0;
    for (const port of PORTS) {
        for (const pid of pidsOnPort(port)) {
            if (killPid(pid)) killed += 1;
        }
    }
    await new Promise(r => setTimeout(r, 1500));
    const s = await status();
    if (!s.frontend && !s.backend) {
        console.log(killed ? `✅ 服务已停止（结束了 ${killed} 个进程）` : '✅ 服务本来就没在运行');
        return true;
    }
    console.log('⚠️ 仍有进程在监听，请手动检查：');
    for (const port of PORTS) {
        const pids = pidsOnPort(port);
        if (pids.length) console.log(`   端口 ${port} → PID ${pids.join(', ')}`);
    }
    return false;
}

// ---------------------------------------------------------------- 系统集成

export function openExternal(target) {
    const cmd = IS_WIN ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    // Windows: start 的第一个引号参数会被当成窗口标题，故补一个空标题占位。
    const args = IS_WIN ? ['/c', 'start', '', target] : [target];
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

export async function openCanvas() {
    const s = await status();
    if (!s.running && !(await start())) return;
    openExternal(FRONTEND);
    console.log(`已在浏览器打开 ${FRONTEND}`);
}

async function printStatus() {
    const s = await status();
    console.log('');
    console.log(`  前端  ${s.frontend ? '● 正常 · localhost:5173' : '○ 未运行'}`);
    console.log(`  后端  ${s.backend ? '● 正常 · localhost:3001' : '○ 未运行'}`);
    console.log(`  项目  ${ROOT}`);
    if (!s.backend && s.frontend) {
        console.log('  提示  前端在跑但后端没起来，多半是后端崩了，看日志');
    }
    console.log('');
}

// ---------------------------------------------------------------- 菜单

const ACTIONS = [
    ['打开画布（未启动会自动启动）', openCanvas],
    ['启动服务', start],
    ['停止服务', stop],
    ['重启服务', async () => { await stop(); await start(); }],
    ['查看状态', printStatus],
    ['查看日志', () => {
        if (!fs.existsSync(LOG_FILE)) return console.log('还没有日志文件');
        console.log(`\n--- ${LOG_FILE} 最后 40 行 ---`);
        const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
        console.log(lines.slice(-40).join('\n'));
    }],
    ['打开项目文件夹', () => openExternal(ROOT)]
];

async function main() {
    // 支持非交互调用：node scripts/launcher.mjs start|stop|status|open
    const direct = process.argv[2];
    if (direct) {
        const map = { start, stop, status: printStatus, open: openCanvas, restart: async () => { await stop(); await start(); } };
        if (!map[direct]) {
            console.error(`未知命令：${direct}（可用：start / stop / restart / status / open）`);
            process.exit(1);
        }
        await map[direct]();
        return;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        for (;;) {
            const s = await status();
            console.log('\n============================================');
            console.log(`  Evan 工作台   ${s.running ? '● 运行中' : '○ 已停止'}`);
            console.log('============================================');
            ACTIONS.forEach(([label], i) => console.log(`  ${i + 1}. ${label}`));
            console.log('  0. 退出');

            const answer = (await rl.question('\n请输入序号：')).trim();
            if (answer === '0' || answer === '') return;

            const picked = ACTIONS[Number(answer) - 1];
            if (!picked) {
                console.log('无效的序号');
                continue;
            }
            try {
                await picked[1]();
            } catch (error) {
                console.error(`执行失败：${error.message}`);
            }
        }
    } finally {
        rl.close();
    }
}

// 被 import 时不启动菜单，只有直接执行本文件才跑。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
