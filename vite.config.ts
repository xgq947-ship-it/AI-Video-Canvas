import { createRequire } from 'module';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
// 版本号来自 package.json，和 Electron 的 app.getVersion() 同源。
// 桌面端会用 IPC 拿到的真实版本覆盖它，这里是浏览器开发模式的回退值。
const { version: APP_VERSION } = require('./package.json');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    define: {
      __APP_VERSION__: JSON.stringify(APP_VERSION)
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true
        },
        '/library': {
          target: 'http://localhost:3001',
          changeOrigin: true
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
