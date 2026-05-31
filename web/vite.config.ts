import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import webPkg from './package.json' with { type: 'json' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function tryGitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  define: {
    __XOPC_WEB_VERSION__: JSON.stringify(webPkg.version),
    __XOPC_WEB_COMMIT__: JSON.stringify(process.env.VITE_XOPC_WEB_COMMIT ?? tryGitSha()),
    __XOPC_WEB_BUILD_TIME__: JSON.stringify(process.env.VITE_XOPC_WEB_BUILD_TIME ?? new Date().toISOString()),
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: '../dist/gateway/static/root',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            /node_modules[/\\]react[/\\]/.test(id) ||
            /node_modules[/\\]react-dom[/\\]/.test(id) ||
            /node_modules[/\\]react-router-dom[/\\]/.test(id)
          ) {
            return 'vendor-react';
          }
          if (/node_modules[/\\]swr[/\\]/.test(id)) {
            return 'vendor-swr';
          }
          if (/node_modules[/\\]@codemirror[/\\]/.test(id) || /node_modules[/\\]@lezer[/\\]/.test(id)) {
            return 'vendor-codemirror';
          }
        },
      },
    },
  },
  server: {
    port: 3000,
    open: false,
    proxy: {
      '/api': {
        target: 'http://localhost:18790',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:18790',
        changeOrigin: true,
      },
      '/api/health': {
        target: 'http://localhost:18790',
        changeOrigin: true,
      },
      '/status': {
        target: 'http://localhost:18790',
        changeOrigin: true,
      },
      '/favicon.ico': {
        target: 'http://localhost:18790',
        changeOrigin: true,
      },
    },
  },
});
