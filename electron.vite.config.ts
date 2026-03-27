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
    },
  },
});
