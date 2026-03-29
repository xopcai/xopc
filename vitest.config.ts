import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@xopcai/xopcbot': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    // Exclude UI tests that require jsdom/browser environment
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
