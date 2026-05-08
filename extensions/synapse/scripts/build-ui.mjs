/**
 * Bundle Synapse extension iframe entrypoints with @xopcai/extension-ui-sdk (browser IIFE).
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const common = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  logLevel: 'info',
  sourcemap: false,
};

// Panel (main kanban board)
await esbuild.build({
  ...common,
  entryPoints: [join(root, 'ui/panel-entry.ts')],
  outfile: join(root, 'ui/panel.bundle.js'),
});

// Settings panel
await esbuild.build({
  ...common,
  entryPoints: [join(root, 'ui/settings-entry.ts')],
  outfile: join(root, 'ui/settings.bundle.js'),
});

console.log('synapse: ui bundles written to ui/*.bundle.js');
