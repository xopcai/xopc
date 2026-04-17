/// <reference types="node" />
import { defineConfig } from 'tsdown';

const env = { NODE_ENV: 'production' } as const;

// Skip .d.ts generation in CI environments that don't need type declarations (e.g. Electron builds).
// Set XOPC_SKIP_DTS=1 to disable — saves significant time on low-core runners (2-core GitHub Actions).
const shouldEmitDts = process.env.XOPC_SKIP_DTS !== '1';

export default defineConfig({
  entry: [
    './src/**/*.ts',
    '!./src/**/*.test.ts',
    '!./src/**/__tests__/**/*.ts',
    './extensions/telegram/src/**/*.ts',
    '!./extensions/telegram/src/**/__tests__/**/*.ts',
    './extensions/weixin/src/**/*.ts',
  ],
  outDir: 'dist',
  root: '.',
  platform: 'node',
  format: 'esm',
  target: 'es2022',
  unbundle: true,
  fixedExtension: false,
  sourcemap: true,
  clean: true,
  dts: shouldEmitDts,
  tsconfig: './tsconfig.json',
  env,
  minify: 'dce-only',
  deps: {
    neverBundle: ['@vscode/ripgrep', 'silk-wasm', 'playwright-core'],
    skipNodeModulesBundle: true,
  },
});
