import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const root = mkdtempSync(join(tmpdir(), 'xopc-session-smoke-'));
const workspace = join(root, 'workspace');
mkdirSync(workspace);
const port = await new Promise((resolve) => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const value = server.address().port;
    server.close(() => resolve(value));
  });
});
const origin = `http://127.0.0.1:${port}`;
const credential = randomBytes(32).toString('base64url');
const configPath = join(root, 'xopc.json');
writeFileSync(configPath, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port,
  auth: { mode: 'token', token: credential } }, browser: { enabled: false } }), { mode: 0o600 });
const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/bin.ts', 'gateway', '--port', String(port), '--bind', 'loopback', '--no-hot-reload'], {
  env: { ...process.env, XOPC_CONFIG_PATH: configPath, XOPC_CONFIG: configPath, XOPC_STATE_DIR: root,
    XOPC_WORKSPACE: workspace, XOPC_HOME: root, XOPC_GATEWAY_TOKEN: credential, XOPC_GATEWAY_PASSWORD: '',
    XOPC_SKIP_CHANNELS: '1', XOPC_LOG_CONSOLE: 'false', XOPC_LOG_FILE: 'false', XOPC_NO_RESPAWN: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-8000); });
child.stderr.on('data', (chunk) => { output = (output + chunk).slice(-8000); });
const exited = new Promise((resolve) => child.once('exit', resolve));
const call = (path, init = {}) => fetch(origin + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) });
const sockets = [];
async function connect(ticket, rejected = false) {
  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/realtime/v1/ws', { origin });
  sockets.push(socket);
  await once(socket, 'open', { signal: AbortSignal.timeout(5000) });
  const response = once(socket, rejected ? 'close' : 'message', { signal: AbortSignal.timeout(5000) });
  socket.send(JSON.stringify({ protocolVersion: 1, messageId: crypto.randomUUID(), kind: 'realtime.hello', sentAt: Date.now(),
    payload: { ticket, clientId: 'smoke', clientKind: 'web', subscriptions: [] } }));
  const [result] = await response;
  return { socket, message: rejected ? null : JSON.parse(String(result)), closeCode: rejected ? result : null };
}
try {
  let ready = false;
  for (let n = 0; n < 180 && child.exitCode === null; n++) {
    try { if ((await call('/api/health')).ok) { ready = true; break; } } catch {}
    await delay(250);
  }
  assert.ok(ready, `Gateway failed to listen: ${output}`);
  const headers = { Origin: origin, Authorization: `Bearer ${credential}` };
  const login = await call('/api/browser-session', { method: 'POST', headers });
  assert.equal(login.status, 200, await login.clone().text());
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  const session = await login.json();
  assert.match(session.conversationId, /^browser:/);
  const authenticated = { Origin: origin, Cookie: cookie };
  assert.equal((await call('/api/browser-session', { headers: authenticated })).status, 200);
  assert.equal((await call('/api/browser-session', { method: 'DELETE', headers: { Cookie: cookie } })).status, 403);
  const ticket = async () => {
    const response = await call('/api/realtime/tickets', { method: 'POST', headers: { ...authenticated, 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: 'smoke', clientKind: 'web', protocolVersion: 2 }) });
    assert.equal(response.status, 200);
    return (await response.json()).payload.ticket;
  };
  const live = await connect(await ticket());
  assert.equal(live.message.kind, 'realtime.ready');
  const pendingTicket = await ticket();
  const nonce = randomBytes(24).toString('base64url');
  const challenge = await call('/api/gateway-identity/challenge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce }) });
  assert.equal(challenge.status, 200);
  const signed = await challenge.json();
  assert.equal(JSON.parse(Buffer.from(signed.signedPayload, 'base64url')).nonce, nonce);
  assert.equal(typeof signed.signature, 'string');
  const closed = once(live.socket, 'close', { signal: AbortSignal.timeout(5000) });
  assert.equal((await call('/api/browser-session', { method: 'DELETE', headers: authenticated })).status, 200);
  await closed;
  const revoked = await connect(pendingTicket, true);
  assert.equal(revoked.closeCode, 4401);
  assert.equal((await call('/api/browser-session', { headers: authenticated })).status, 401);
  assert.equal((await call(`/api/browser-session?token=${credential}`)).status, 401);
  console.log('PASS: real Gateway startup, lazy session route, cookie auth, CSRF, realtime connection, identity challenge, logout closes live WS and revokes pending tickets, query rejection');
} finally {
  for (const socket of sockets) socket.terminate();
  child.kill('SIGTERM');
  const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(kill);
  rmSync(root, { recursive: true, force: true });
}
