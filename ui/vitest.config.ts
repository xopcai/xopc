import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    exclude: [...configDefaults.exclude, 'e2e/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
      ],
      // Note: UI components are hard to unit test, focus on core logic coverage
      // thresholds: {
      //   lines: 40,
      //   functions: 40,
      //   branches: 40,
      //   statements: 40,
      // },
    },
  },
});
