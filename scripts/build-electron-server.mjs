#!/usr/bin/env node
/**
 * Bundle the gateway CLI into a single ESM file under out/server/index.js for Electron packaging.
 * Run after `pnpm run build` so dist/src/cli/index.js exists. Invoked by electron:server:build.
 */
import * as esbuild from 'esbuild';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'dist/src/cli/index.js');
const outfile = join(root, 'out/server/index.js');

if (!existsSync(entry)) {
  console.error(
    `[build-electron-server] Missing ${entry}. Run \`pnpm run build\` first, then retry.\n`,
  );
  process.exit(1);
}

// Exclude Electron-only or optional native / heavy deps the gateway subprocess does not need bundled.
const external = [
  'electron',
  '@vscode/ripgrep',
  'silk-wasm',
  'node-cron',
];

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outfile,
  external,
  format: 'esm',
  // Alias avoids duplicate `createRequire` binding when bundled code also imports from node:module.
  banner: {
    js: "import { createRequire as __xopcbotCreateRequire } from 'module'; globalThis.require = __xopcbotCreateRequire(import.meta.url);",
  },
  minify: false,
  sourcemap: false,
});

console.log(`[build-electron-server] Wrote ${outfile}`);
