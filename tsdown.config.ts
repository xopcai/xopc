/// <reference types="node" />
import { defineConfig } from 'tsdown';

const env = { NODE_ENV: 'production' } as const;
const sourcemap = process.env.XOPC_BUILD_SOURCEMAP === '1';

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
    '!./extensions/weixin/src/**/__tests__/**/*.ts',
    './extensions/feishu/src/**/*.ts',
    '!./extensions/feishu/src/**/__tests__/**/*.ts',
    './extensions/demo-memory/src/**/*.ts',
    '!./extensions/demo-memory/src/**/__tests__/**/*.ts',
  ],
  outDir: 'dist',
  root: '.',
  platform: 'node',
  format: 'esm',
  target: 'es2022',
  unbundle: true,
  fixedExtension: false,
  // Published source maps duplicate the TypeScript sources and account for roughly one third of
  // the unpacked npm artifact. Opt in only when producing a separate diagnostics artifact.
  sourcemap,
  clean: true,
  dts: false,
  tsconfig: './tsconfig.json',
  env,
  minify: 'dce-only',
  deps: {
    neverBundle: ['@vscode/ripgrep', 'silk-wasm', 'playwright-core'],
    alwaysBundle: ['@xopcai/gateway-contract'],
  },
});
