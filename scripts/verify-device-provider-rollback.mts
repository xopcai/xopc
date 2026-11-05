/** Rehearse the supported flag rollback on a disposable, packaged Gateway. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { startDeviceHost } from '../src/endpoint-tools/device-host.js';

const directory = await mkdtemp(join(tmpdir(), 'xopc-provider-rollback-'));
const configPath = join(directory, 'xopc.json');
const token = randomBytes(32).toString('hex');
const tokenEnv = 'XOPC_ROLLBACK_FIXTURE_TOKEN';
const entry = resolve('dist/src/cli/bin.js');
const socket = createServer();
await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
const address = socket.address();
assert(address && typeof address !== 'string');
const { port } = address;
await new Promise<void>(resolve => socket.close(() => resolve()));
const origin = `http://127.0.0.1:${port}`;
let child: ChildProcess | undefined;
let host: Awaited<ReturnType<typeof startDeviceHost>> | undefined;
let diagnostics = '';
const previousToken = process.env[tokenEnv];

async function configure(enabled: boolean) {
  await writeFile(configPath, JSON.stringify({ gateway: { port, bind: 'loopback',
    auth: { mode: 'token', token }, deviceProvidersEnabled: enabled } }), { mode: 0o600 });
}

async function until<T>(probe: () => Promise<T | undefined>, label: string): Promise<T> {
  const deadline = Date.now() + 30_000;
  do {
    const value = await probe().catch(() => undefined);
    if (value !== undefined) return value;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}: ${diagnostics.replaceAll(token, '[redacted]')}`);
}

async function stop() {
  const process = child;
  child = undefined;
  if (!process || process.exitCode !== null || process.signalCode !== null) return;
  const done = new Promise<void>(resolve => process.once('exit', () => resolve()));
  const force = setTimeout(() => process.kill('SIGKILL'), 10_000);
  process.kill('SIGTERM');
  try { await done; } finally { clearTimeout(force); }
}

async function boot() {
  child = spawn(process.execPath, [entry, 'gateway', '--port', String(port), '--bind', 'loopback'], {
    env: { ...process.env, XOPC_HOME: directory, XOPC_STATE_DIR: directory, XOPC_CONFIG_PATH: configPath,
      XOPC_WORKSPACE: join(directory, 'workspace'), XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1', XOPC_LOG_FILE: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-3000); });
  await until(async () => (await (await fetch(origin + '/api/health')).json()).ready === true ? true : undefined, 'Gateway readiness');
}

async function api(path: string, body?: unknown) {
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.status, 200, path);
  return (await response.json()).payload;
}

type Claim = { principalId: string; endpointId?: string; digest: string; admitted: boolean; status: string };
const claims = async (): Promise<Claim[]> => api('/api/endpoint-tools/providers');

try {
  await mkdir(join(directory, 'workspace'));
  await configure(true);
  await boot();
  process.env[tokenEnv] = token;
  host = await startDeviceHost({ gatewayUrl: origin, tokenEnv, identityPath: join(directory, 'device.json'), displayName: 'Rollback sensor',
    providers: [{ localId: 'sensor', title: 'Sensor', summary: 'Rollback fixture', server: {
      command: process.execPath, args: [resolve('scripts/fixtures/device-mcp.mjs')],
    }, policies: { 'Read-Temperature': { effect: 'read', sensitivity: 'public', confirmation: 'never',
      requiresForeground: false, requiredPermissions: [], timeoutMs: 5_000, maxConcurrency: 1,
      supportsCancellation: false, idempotent: true, resultKinds: ['json'],
    } } }] });
  const original = await until(async () => (await claims())[0], 'Provider registration');
  await api('/api/endpoint-tools/providers/admission', { principalId: original.principalId, localId: 'sensor',
    expectedDigest: original.digest, allowed: true });
  const check = async (status: string) => until(async () => {
    const [record, duplicate] = await claims();
    if (record?.status !== status || !record.endpointId) return;
    assert.equal(duplicate, undefined);
    assert.equal(record.principalId, host!.principalId);
    assert.equal(record.endpointId, host!.endpointId);
    assert.equal(record.digest, original.digest);
    assert.equal(record.admitted, true);
    return record;
  }, `Provider state ${status}`);
  await check('ready');
  await configure(false);
  assert.equal((await api('/api/config/reload', {})).reloaded, true);
  await check('unavailable');
  await stop();
  await boot();
  await check('unavailable');
  await configure(true);
  assert.equal((await api('/api/config/reload', {})).reloaded, true);
  await check('ready');
  console.log('PASS: packaged Gateway flag rollback, cold restart while disabled, and re-enable preserve one signed identity and its exact admission.');
} finally {
  await host?.close();
  await stop();
  if (previousToken === undefined) delete process.env[tokenEnv]; else process.env[tokenEnv] = previousToken;
  await rm(directory, { recursive: true, force: true });
}
