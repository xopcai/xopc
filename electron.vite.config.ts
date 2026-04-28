import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'electron-vite';

import webPkg from './web/package.json' with { type: 'json' };

const __dirname = dirname(fileURLToPath(import.meta.url));

function tryGitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: __dirname, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // IMPORTANT: In the Electron main process, `electron` is a runtime-provided module.
        // If Rollup resolves it to the npm package `electron`, the bundle will include
        // `node_modules/electron/index.js`, which throws at runtime inside packaged apps.
        // Do not mark `thread-stream` external: pnpm may not hoist it, so `require('thread-stream')`
        // from `out/main/chunks/*` fails. Bundled `thread-stream` + `thread-stream-bundle-shim.ts`
        // fixes pino transport worker path (see electron/thread-stream-bundle-shim.ts).
        external: ['electron'],
        input: {
          index: resolve(__dirname, 'electron/main.ts'),
        },
      },
    },
    resolve: {
      alias: {
        '@xopcai/xopc': resolve(__dirname, 'src'),
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        // Same as main: keep `electron` as runtime-provided, not the npm package.
        external: ['electron'],
        input: {
          index: resolve(__dirname, 'electron/preload.ts'),
        },
        // Root package.json is `"type": "module"`, so electron-vite would default preload to ESM
        // (`index.mjs`). Electron does not execute that preload as an ES module. Force CJS (`index.cjs`).
        output: {
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'web'),
    base: './',
    define: {
      __XOPC_WEB_VERSION__: JSON.stringify(webPkg.version),
      __XOPC_WEB_COMMIT__: JSON.stringify(process.env['VITE_XOPC_WEB_COMMIT'] ?? tryGitSha()),
      __XOPC_WEB_BUILD_TIME__: JSON.stringify(
        process.env['VITE_XOPC_WEB_BUILD_TIME'] ?? new Date().toISOString(),
      ),
    },
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
      // so `/api/*` reaches the xopc gateway — required for Electron dev (renderer loads from :5173).
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
