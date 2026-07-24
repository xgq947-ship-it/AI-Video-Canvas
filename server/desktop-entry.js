/**
 * Electron utility-process entry point.
 *
 * The main process injects all resource/data paths before this module loads.
 * Port 0 asks the OS for a free loopback port, avoiding fixed-port collisions.
 */
import { startBackend } from './index.js';

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

const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
};

process.parentPort?.on('message', event => {
    if (event?.data?.type === 'shutdown') shutdown();
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
