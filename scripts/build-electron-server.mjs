#!/usr/bin/env node
/**
 * Bundle the gateway CLI into a single ESM file under out/server/index.js for Electron packaging.
 * Run after `pnpm run build` so dist/src/cli/bin.js exists. Invoked by electron:server:build.
 */
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ELECTRON_GATEWAY_EXTERNALS } from './electron-runtime-externals.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'dist/src/cli/bin.js');
const outfile = join(root, 'out/server/index.js');

if (!existsSync(entry)) {
  console.error(
    `[build-electron-server] Missing ${entry}. Run \`pnpm run build\` first, then retry.\n`,
  );
  process.exit(1);
}

// Exclude Electron-only or optional native / heavy deps the gateway subprocess does not need bundled.
// Marketplace adapters (store, skillhub, clawhub) are built-in under src/agent/skills/marketplace/.
const external = ELECTRON_GATEWAY_EXTERNALS;
const minify = process.env['XOPC_ELECTRON_SERVER_MINIFY'] !== '0';

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outfile,
  external,
  format: 'esm',
  // ESM bundle: dependents (e.g. @larksuiteoapi/node-sdk) use `__dirname` / CJS `require`.
  banner: {
    js: [
      "import { createRequire as __xopcCreateRequire } from 'module';",
      "import { fileURLToPath as __xopcFileURLToPath } from 'node:url';",
      "import { dirname as __xopcDirname } from 'node:path';",
      'const __filename = __xopcFileURLToPath(import.meta.url);',
      'const __dirname = __xopcDirname(__filename);',
      'globalThis.require = __xopcCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  minify,
  sourcemap: false,
});

console.log(`[build-electron-server] Wrote ${outfile}${minify ? ' (minified)' : ''}`);

// schema.ts reads schema.sql next to the running module. The esbuild bundle is a single file under
// out/server/, so copy the DDL beside index.js for packaged Electron (import.meta.url → out/server/).
const schemaCandidates = [
  join(root, 'dist/src/storage/sqlite/schema.sql'),
  join(root, 'src/storage/sqlite/schema.sql'),
];
const schemaSrc = schemaCandidates.find((p) => existsSync(p));
const schemaDest = join(root, 'out/server/schema.sql');
if (schemaSrc) {
  mkdirSync(dirname(schemaDest), { recursive: true });
  cpSync(schemaSrc, schemaDest);
  console.log(`[build-electron-server] Copied SQLite schema to ${schemaDest}`);
} else {
  console.error(
    `[build-electron-server] Missing schema.sql (tried:\n` +
      schemaCandidates.map((p) => `  - ${p}`).join('\n') +
      `\n). Run \`pnpm run build\` first.\n`,
  );
  process.exit(1);
}

// workspace-seed.ts resolves bundled templates next to the running module (`__dirname/workspace-templates`).
// The esbuild bundle is a single file under out/server/, so copy templates beside index.js for packaged Electron.
const tplCandidates = [
  join(root, 'dist/src/agent/context/workspace-templates'),
  join(root, 'src/agent/context/workspace-templates'),
];
const tplSrc = tplCandidates.find((p) => existsSync(p));
const tplDest = join(root, 'out/server/workspace-templates');
if (tplSrc) {
  mkdirSync(dirname(tplDest), { recursive: true });
  cpSync(tplSrc, tplDest, { recursive: true });
  console.log(`[build-electron-server] Copied workspace templates to ${tplDest}`);
} else {
  console.error(
    `[build-electron-server] Missing workspace templates (tried:\n` +
      tplCandidates.map((p) => `  - ${p}`).join('\n') +
      `\n). Run \`pnpm run build\` first.\n`,
  );
  process.exit(1);
}
