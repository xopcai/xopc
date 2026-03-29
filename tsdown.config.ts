import { defineConfig } from 'tsdown';

const env = { NODE_ENV: 'production' } as const;

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
  dts: true,
  tsconfig: './tsconfig.json',
  env,
  minify: 'dce-only',
  deps: {
    neverBundle: ['@vscode/ripgrep', 'silk-wasm'],
    skipNodeModulesBundle: true,
  },
});
