import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude UI tests that require jsdom/browser environment
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'ui/**',  // UI tests need browser environment
    ],
  },
});
