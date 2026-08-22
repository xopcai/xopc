import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'expo-crypto': 'node:crypto',
    },
  },
  test: {
    include: [
      'src/**/__tests__/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**'],
  },
});
