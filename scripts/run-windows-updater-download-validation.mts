/** Optional staging-feed verification. Does not change CI, production feeds, or installed apps. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

assert.equal(process.platform, 'win32');
const { values } = parseArgs({ options: { feed: { type: 'string' }, publisher: { type: 'string' }, current: { type: 'string' }, expected: { type: 'string' } } });
assert.ok(values.feed && values.publisher && values.current && values.expected, 'Use --feed HTTPS_URL --publisher EXACT_SUBJECT_DN --current A --expected B');
const url = new URL(values.feed);
assert.ok(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'Use an HTTPS staging feed without inline credentials');
assert.ok(values.publisher.startsWith('CN='));
const repo = resolve(import.meta.dirname, '..'), root = join(repo, '.cache', `windows-updater-download-${randomUUID()}`);
await mkdir(root, { recursive: true });
const entry = join(root, 'verify.mjs');
await build({ entryPoints: [join(repo, 'scripts/verify-windows-updater-download.mts')], outfile: entry,
  bundle: true, platform: 'node', format: 'esm', external: ['electron'],
  banner: { js: 'import { createRequire as __makeRequire } from "node:module"; const require = __makeRequire(import.meta.url);' } });
const env = { ...process.env, XOPC_UPDATE_TEST_ROOT: root, XOPC_UPDATE_TEST_FEED: values.feed,
  XOPC_UPDATE_TEST_PUBLISHER: values.publisher, XOPC_UPDATE_TEST_CURRENT: values.current, XOPC_UPDATE_TEST_EXPECTED: values.expected };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(createRequire(import.meta.url)('electron') as string, [entry], { cwd: repo, env, windowsHide: true, stdio: 'inherit' });
const code = await new Promise<number | null>((resolve, reject) => {
  const timer = setTimeout(() => { child.kill(); reject(new Error('Staging updater validation timed out')); }, 180_000);
  child.on('error', error => { clearTimeout(timer); reject(error); }); child.on('exit', code => { clearTimeout(timer); resolve(code); });
});
console.log(`Signed update download evidence: ${join(root, 'result.json')}`);
assert.equal(code, 0, 'Signed staging update validation did not pass; see evidence');
