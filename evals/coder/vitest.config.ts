import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Git and SQLite fixture tests can exceed Vitest's 5s default on Windows runners.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
