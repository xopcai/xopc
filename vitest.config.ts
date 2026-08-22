import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@xopcai/xopc': path.resolve(__dirname, 'src'),
      '@': path.resolve(__dirname, 'web/src'),
    },
  },
  test: {
    // Mobile tests use their own Expo-aware Vitest config.
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/mobile-expo/**'],
  },
});
