import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
      '/status': {
        target: 'http://localhost:18790',
        changeOrigin: true,
      },
    },
  },
});
