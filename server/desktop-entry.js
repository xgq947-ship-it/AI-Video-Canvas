/**
 * Electron utility-process entry point.
 *
 * The main process injects all resource/data paths before this module loads.
 * Port 0 asks the OS for a free loopback port, avoiding fixed-port collisions.
 */
import { startBackend } from './index.js';
import { closeBrowserForShutdown } from './services/opsCliRunner.js';
import { setLicenseState } from './services/licenseGuard.js';

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

    // 这里只释放本 App 的运行状态。共享 Chrome 由 Hub 根据所有 App 的租约统一回收。
    const finish = () => server.close(() => process.exit(0));
    closeBrowserForShutdown({ timeoutMs: 8_000 }).then(finish, finish);

    // Electron 主进程只给 10.5 秒，这里必须先于它自行了断。
    setTimeout(() => process.exit(1), 9_500).unref();
};

process.parentPort?.on('message', event => {
    const data = event?.data;
    if (data?.type === 'shutdown') shutdown();
    // 主进程验完的 LicenseState（节点权限执行层守卫的唯一状态来源，见 licenseGuard.js）。
    else if (data?.type === 'license-state') setLicenseState(data.state);
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
