import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'expo-crypto': 'node:crypto',
      'expo/fetch': fileURLToPath(new URL('./src/test/expo-fetch.ts', import.meta.url)),
    },
  },
  test: {
    include: [
      'src/**/__tests__/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**'],
  },
});
