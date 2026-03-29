import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts'),
        },
      },
    },
    resolve: {
      alias: {
        '@xopcai/xopcbot': resolve(__dirname, 'src'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'web'),
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'web/src'),
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'web/index.html'),
      },
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      // Same-origin API calls use `window.location.origin` (this dev server). Mirror `web/vite.config.ts`
      // so `/api/*` reaches the xopcbot gateway — required for Electron dev (renderer loads from :5173).
      proxy: {
        '/api': {
          target: 'http://localhost:18790',
          changeOrigin: true,
        },
        '/health': {
          target: 'http://localhost:18790',
          changeOrigin: true,
        },
        '/status': {
          target: 'http://localhost:18790',
          changeOrigin: true,
        },
      },
    },
  },
});
