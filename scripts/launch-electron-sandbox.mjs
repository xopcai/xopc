import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { localConnectionEnvironment } from './electron-local-connection-support.mjs';
import { macPackagedTarget, packagedAcceptanceEnvironment } from './electron-packaged-acceptance.mjs';

const args = process.argv.slice(2), flag = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
if (args.includes('--help')) {
  console.log('node scripts/launch-electron-sandbox.mjs --app /absolute/path/xopc.app [--remote] [--state /new/path | --state /existing/path --reuse]');
  process.exit(0);
}
assert(flag('--app'), 'An installed --app is required');
const target = await macPackagedTarget(resolve(flag('--app')));
const state = flag('--state') ? resolve(flag('--state')) : await mkdtemp(join(tmpdir(), 'xopc-manual-'));
const marker = join(state, 'manual-test.json'), config = join(state, 'xopc.json');
if (args.includes('--reuse')) {
  assert(flag('--state'), '--reuse requires an explicit --state');
  const existing = JSON.parse(await readFile(marker, 'utf8'));
  assert(existing.version === 1 && existing.purpose === 'xopc-manual-electron', 'Refusing to reuse an unmarked user directory');
  const saved = JSON.parse(await readFile(config, 'utf8'));
  assert(saved.gateway?.bind === 'loopback' && Number.isInteger(saved.gateway.port) && saved.gateway.auth?.mode === 'token', 'Unexpected manual-test Gateway config');
} else {
  if (flag('--state')) await mkdir(state, { mode: 0o700 });
  const listener = createServer().listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  await writeFile(config, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port, auth: { mode: 'token', token: randomUUID() } }, browser: { enabled: false } }), { flag: 'wx', mode: 0o600 });
  await writeFile(marker, JSON.stringify({ version: 1, purpose: 'xopc-manual-electron', createdAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
}
const root = resolve(import.meta.dirname, '..');
const env = packagedAcceptanceEnvironment(localConnectionEnvironment(process.env, root, state, config, join(state, 'workspace')));
console.log(`Isolated state: ${state}\nMode: ${args.includes('--remote') ? 'Gateway connections' : 'local'}\nNo inherited model credentials; configure a test model in the app. Reuse this directory with --state and --reuse.`);
const child = spawn(target.executablePath, args.includes('--remote') ? ['--gateway-connections'] : [], { cwd: state, env, stdio: 'inherit' });
const stop = () => child.kill('SIGTERM'); process.on('SIGINT', stop); process.on('SIGTERM', stop);
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
const [code, signal] = await once(child, 'exit'); process.off('SIGINT', stop); process.off('SIGTERM', stop);
process.exitCode = code ?? (signal === 'SIGTERM' || signal === 'SIGINT' ? 0 : 1);
