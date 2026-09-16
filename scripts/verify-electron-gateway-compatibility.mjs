#!/usr/bin/env node
/** Exercise the built desktop preflight against the built Gateway before packaging. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { assertGatewayCompatibility } from '../out/main/compatibility.js';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const stateDir = mkdtempSync(join(tmpdir(), 'xopc-pack-compatibility-'));
const workspace = join(stateDir, 'workspace');
mkdirSync(workspace);
const token = randomBytes(32).toString('base64url');
let child;
let exited;
let output = '';
try {
  const port = await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
  const configPath = join(stateDir, 'xopc.json');
  writeFileSync(configPath, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port,
    auth: { mode: 'token', token } }, browser: { enabled: false } }), { mode: 0o600 });
  child = spawn(process.execPath, [join(repoRoot, 'out/server/index.js'), 'gateway', '--port', String(port), '--bind', 'loopback', '--no-hot-reload'], {
    cwd: repoRoot,
    env: { ...process.env, XOPC_CONFIG_PATH: configPath, XOPC_CONFIG: configPath, XOPC_STATE_DIR: stateDir,
      XOPC_WORKSPACE: workspace, XOPC_HOME: stateDir, XOPC_GATEWAY_TOKEN: token, XOPC_GATEWAY_PASSWORD: '',
      XOPC_SKIP_CHANNELS: '1', XOPC_LOG_CONSOLE: 'false', XOPC_LOG_FILE: 'false', XOPC_NO_RESPAWN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const append = (chunk) => { output = (output + chunk).slice(-6000); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  exited = once(child, 'exit');
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 180 && child.exitCode === null; attempt++) {
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000), redirect: 'error' });
      if (response.ok) { ready = true; break; }
    } catch { /* Wait for this isolated process only. */ }
    await delay(250);
  }
  assert.ok(ready, 'Built Gateway did not start');
  assert.equal((await fetch(`${origin}/api/endpoint-tools/compatibility`)).status, 401);
  await assertGatewayCompatibility({ port, token });
  // This must reach grant validation, never the generic 1MB limiter. No upload grant is issued.
  const probe = Buffer.alloc(2 * 1024 * 1024);
  const upload = await fetch(`${origin}/api/endpoint-tools/invocations/pack-probe/files?name=probe.png`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
    body: probe, signal: AbortSignal.timeout(5000), redirect: 'error',
  });
  assert.equal(upload.status, 400, 'Built Gateway must admit >1MB uploads to grant validation');
  assert.equal((await upload.json()).error.code, 'INVALID_UPLOAD_GRANT');
  probe.fill(0);
  console.log('[electron-compatibility] PASS: built desktop + built Gateway, authenticated preflight, >1MB upload admission, isolated clean state');
} catch (error) {
  console.error(output.replaceAll(token, '[REDACTED]'));
  throw error;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await exited; } finally { clearTimeout(force); }
  }
  rmSync(stateDir, { recursive: true, force: true });
}
