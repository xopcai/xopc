/** Opt-in: launch Calculator and verify 6 × 7 through the real Electron broker. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

assert.equal(process.platform, 'win32', 'Run this check in an interactive Windows x64 desktop');
assert.equal(process.arch, 'x64');
const root = resolve(import.meta.dirname, '..');
const output = join(root, '.cache', 'computer-windows-validation');
await mkdir(output, { recursive: true });
const entry = join(output, 'verify.mjs');
await build({ entryPoints: [join(root, 'scripts/verify-computer-windows.mts')], outfile: entry,
  bundle: true, platform: 'node', format: 'esm', external: ['electron', '@trycua/cua-driver'],
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' } });
const env = { ...process.env, XOPC_LOG_LEVEL: 'fatal', XOPC_LOG_FILE: 'false' };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(createRequire(import.meta.url)('electron') as string,
  [entry, join(root, '.cache', 'computer-driver', '0.36.0', 'win32-x64', 'cua-driver.exe'), join(output, 'result.json')],
  { cwd: root, env, stdio: 'inherit', timeout: 180_000, windowsHide: true });
assert.equal(result.status, 0, `Windows validation failed without replay: ${result.error?.message ?? 'see output'}`);
