/**
 * Electron main is bundled under `out/main/`. Bundled copies of `thread-stream` infer
 * `join(__dirname, 'lib/worker.js')` as `out/main/lib/worker.js`, which does not exist.
 * `thread-stream` supports `globalThis.__bundlerPathsOverrides['thread-stream-worker']`.
 *
 * Must run before any module that initializes pino transports (e.g. `src/config/loader`).
 */
import { createRequire } from 'node:module';

type WithBundlerOverrides = typeof globalThis & {
  __bundlerPathsOverrides?: Record<string, string>;
};

try {
  const require = createRequire(import.meta.url);
  const workerPath = require.resolve('thread-stream/lib/worker.js');
  const g = globalThis as WithBundlerOverrides;
  g.__bundlerPathsOverrides = {
    ...(g.__bundlerPathsOverrides ?? {}),
    'thread-stream-worker': workerPath,
  };
} catch {
  /* noop — dev deps missing or unresolved */
}
