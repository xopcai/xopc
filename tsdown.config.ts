/// <reference types="node" />
import { defineConfig } from 'tsdown';

const env = { NODE_ENV: 'production' } as const;

// Declaration files are emitted by `pnpm run build:types` (tsc --emitDeclarationOnly) so JS bundling
// stays fast. Electron / `build:node` only runs tsdown without DTS.

export default defineConfig({
  entry: [
    './src/**/*.ts',
    '!./src/**/*.test.ts',
    '!./src/**/__tests__/**/*.ts',
    './extensions/telegram/src/**/*.ts',
    '!./extensions/telegram/src/**/__tests__/**/*.ts',
    './extensions/weixin/src/**/*.ts',
    './extensions/feishu/src/**/*.ts',
    '!./extensions/feishu/src/**/__tests__/**/*.ts',
    './extensions/dingtalk/src/**/*.ts',
    '!./extensions/dingtalk/src/**/__tests__/**/*.ts',
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
  dts: false,
  tsconfig: './tsconfig.json',
  env,
  minify: 'dce-only',
  deps: {
    neverBundle: ['@vscode/ripgrep', 'silk-wasm', 'playwright-core'],
    skipNodeModulesBundle: true,
  },
});
