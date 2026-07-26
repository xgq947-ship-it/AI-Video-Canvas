/**
 * Electron utility-process entry point.
 *
 * The main process injects all resource/data paths before this module loads.
 * Port 0 asks the OS for a free loopback port, avoiding fixed-port collisions.
 */
import { startBackend } from './index.js';
import { closeBrowserForShutdown } from './services/opsCliRunner.js';

const host = process.env.HOST || '127.0.0.1';
const configuredPort = Number(process.env.PORT);
const port = Number.isInteger(configuredPort) && configuredPort >= 0 ? configuredPort : 0;

const server = startBackend({
    host,
    port,
    onReady: ({ port: actualPort }) => {
        process.parentPort?.postMessage({
            type: 'backend-ready',
            host,
            port: actualPort,
            origin: `http://${host}:${actualPort}`
        });
    }
});

let shuttingDown = false;

const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    // 常驻的无头 Chromium 是 detached 启动的（chrome_cdp.py 的 start_new_session /
    // DETACHED_PROCESS），不会随后端进程一起退出。不在这里主动关掉，用户退出 Evan 后
    // 它会一直占着内存，直到下次启动 Evan 再过一个 idle 周期才被回收。
    // closeBrowserForShutdown 不抛错也不会挂住，最坏情况按 timeout 兜底。
    const finish = () => server.close(() => process.exit(0));
    closeBrowserForShutdown({ timeoutMs: 3_000 }).then(finish, finish);

    // Electron 主进程只给 5.5 秒，这里必须先于它自行了断。
    setTimeout(() => process.exit(1), 4_500).unref();
};

process.parentPort?.on('message', event => {
    if (event?.data?.type === 'shutdown') shutdown();
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
