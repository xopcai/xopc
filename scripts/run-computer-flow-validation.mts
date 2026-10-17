/** Opt-in macOS integration check. Never run this automatically in the ordinary test suite. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

assert.equal(process.platform, 'darwin', 'This check requires macOS and existing Electron AX/screen permissions');
const repo = resolve(import.meta.dirname, '..');
const output = join(repo, '.cache', 'flow-live');
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'xopc-real-flow-'));
const require = createRequire(import.meta.url);
const electron = require('electron') as string;
await build({ entryPoints: [join(repo, 'scripts/verify-computer-flows.mts')], outfile: join(output, 'verify.mjs'),
  bundle: true, platform: 'node', format: 'esm', external: ['electron', '@trycua/cua-driver', '@earendil-works/*', 'sharp', 'better-sqlite3'],
  banner: { js: 'import { createRequire as __flowCreateRequire } from "node:module"; const require = __flowCreateRequire(import.meta.url);' } });
const env: NodeJS.ProcessEnv = { ...process.env, XOPC_HOME: root, XOPC_STATE_DIR: root, XOPC_CONFIG_PATH: join(root, 'xopc.json'),
  XOPC_CREDENTIALS_DIR: join(root, 'credentials'), XOPC_LOG_LEVEL: 'fatal', XOPC_LOG_FILE: 'false',
  XOPC_SQLITE_ASSET_ROOT: join(repo, 'src/storage/sqlite') };
delete env.ELECTRON_RUN_AS_NODE;
// Precondition: TextEdit Settings is open on New Document. Keep it visible; the test never requests foreground preparation.
const results: any[] = [];
for (const phase of ['capture', 'reuse', 'unknown']) {
  console.log(`Running real TextEdit flow validation: ${phase}`);
  const child = spawnSync(electron, [join(output, 'verify.mjs'), phase, root], {
    cwd: repo, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(child.status, 0, `${phase} failed; no phase is retried. State: ${root}\n${child.stderr.slice(-1500)}\n${child.stdout.slice(-1500)}`);
  results.push(JSON.parse(await readFile(join(root, `${phase}-result.json`), 'utf8')));
}
assert.equal(new Set(results.map(row => row.pid)).size, 3, 'Each phase must run in a different OS process');

console.log(JSON.stringify({ status: 'passed', evidenceDirectory: root, independentProcesses: 3, baselineRestored: true, results }, null, 2));
