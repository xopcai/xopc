/** Smoke-test the same bundled worker layout used by the Electron server. */
import assert from 'node:assert/strict';
import { copyFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const output = join(root, '.cache/computer-program-bundle');
await mkdir(output, { recursive: true });
await copyFile(join(root, 'out/server/codemode-worker.js'), join(output, 'codemode-worker.js'));
await build({ entryPoints: [join(root, 'src/computer/program-runtime.ts')], outfile: join(output, 'program.mjs'),
  platform: 'node', format: 'esm', bundle: true });
const { executeComputerProgram } = await import(pathToFileURL(join(output, 'program.mjs')).href);
const state: Record<string, unknown> = {};
const result = await executeComputerProgram(`text(await ui.observe({})); store('counter', 1);`,
  async () => ({ native: false, bundle: true }), state, new AbortController().signal);
assert.equal(result.status, 'program_completed');
assert.equal(state.counter, 1);
assert.match(result.output, /"bundle":true/);
console.log(JSON.stringify({ status: 'passed', bundledQuickJSWorker: true, nativeInput: false }));
