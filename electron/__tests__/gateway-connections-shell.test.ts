import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { DESKTOP_CHAT_MANIFEST } from '@xopcai/gateway-contract';

import { filterRealtime, shellRoute, ShellSlots } from '../shell/policy.js';
import { ShellUpstream } from '../shell/upstream.js';
import { startShell } from '../shell/server.js';

const keys = generateKeyPairSync('ed25519');
const identity = { gatewayId: randomUUID(), publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
const token = randomUUID();
let fixture: Awaited<ReturnType<typeof setup>>;
let upstreamCalls: Array<{ path: string; headers: import('node:http').IncomingHttpHeaders }>;
let mode: string;
let streamClosed: boolean;
let held: import('node:http').ServerResponse[];
function envelope(kind: string, payload: unknown) { return { protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), kind, payload }; }

async function setup() {
  upstreamCalls = []; mode = ''; streamClosed = false; held = [];
  const server = createServer(async (req, res) => {
    upstreamCalls.push({ path: req.url!, headers: req.headers });
    if (req.url !== '/api/gateway-identity/challenge' && req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
    if (mode === '401') { res.writeHead(401).end(); return; }
    if (mode === 'redirect') { res.writeHead(302, { Location: 'http://not-allowed.invalid', 'Set-Cookie': 'leak=1' }).end(); return; }
    if (req.url === '/api/desktop-chat/bootstrap') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, payload: { ...identity, manifest: DESKTOP_CHAT_MANIFEST } })); return; }
    if (req.url === '/api/gateway-identity/challenge') {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
      const { nonce } = JSON.parse(Buffer.concat(chunks).toString());
      const now = Date.now();
      const signedPayload = Buffer.from(JSON.stringify({ purpose: 'gateway-route-v1', ...identity, nonce: mode === 'nonce' ? 'wrong' : nonce,
        serverTime: now, expiresAt: now + 30_000, requestProofVersion: 1 })).toString('base64url');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ signedPayload, signature: sign(null, Buffer.from(signedPayload), keys.privateKey).toString('base64url') })); return;
    }
    if (req.url === '/api/realtime/tickets') {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, payload: { ...body, ticket: randomBytes(32).toString('base64url'), expiresAt: Date.now() + 30_000 } })); return;
    }
    if (req.url?.startsWith('/api/media/read')) {
      if (mode === 'html') { res.setHeader('Content-Type', 'text/html'); res.end('<script>danger()</script>'); return; }
      res.setHeader('Content-Type', 'image/png');
      if (mode === 'oversize') { res.setHeader('Content-Length', 32 * 1024 * 1024 + 1); res.end('x'); return; }
      if (mode === 'stream') {
        const timer = setInterval(() => res.write(Buffer.alloc(1024)), 10);
        res.once('close', () => { clearInterval(timer); streamClosed = true; }); return;
      }
      if (req.headers.range) { res.writeHead(206, { 'Content-Range': 'bytes 0-2/6' }); res.end('png'); return; }
      res.end('png'); return;
    }
    if (mode === 'blocked') { held.push(res); return; }
    res.setHeader('Content-Type', mode === 'html' ? 'text/html' : 'application/json');
    res.setHeader('Set-Cookie', 'upstream=secret'); res.setHeader('Content-Security-Policy', "script-src https://bad.invalid");
    res.end(JSON.stringify({ ok: true, payload: ['model'] }));
  });
  const wss = new WebSocketServer({ server });
  const remoteMessages: unknown[] = [];
  wss.on('connection', ws => ws.on('message', data => {
    const value = JSON.parse(data.toString()); remoteMessages.push(value);
    if (value.kind === 'realtime.hello') ws.send(JSON.stringify(envelope('realtime.ready', { connectionId: randomUUID(), heartbeatIntervalMs: 15000, heartbeatTimeoutMs: 45000 })));
    else if (value.kind === 'realtime.ping') ws.send(JSON.stringify(envelope('realtime.pong', {})));
  }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const upstream = new ShellUpstream({ origin, transport: 'ssh', token });
  const verified = await upstream.authenticate();
  const shell = await startShell(upstream, join(process.cwd(), 'electron/gateway'), 7, verified.gatewayId);
  const cookie = shell.bootstrap();
  const headers = { Cookie: `${cookie.name}=${cookie.value}`, 'X-Xopc-Desktop-Window': shell.proof, Origin: shell.origin };
  return { server, wss, shell, headers, origin, remoteMessages, upstream };
}
beforeEach(async () => { fixture = await setup(); });
afterEach(async () => {
  vi.restoreAllMocks(); await fixture?.shell.close(); fixture?.wss.clients.forEach(ws => ws.terminate()); fixture?.wss.close();
  await new Promise<void>(resolve => fixture.server.close(() => resolve()));
});
const get = (path: string, extra: Record<string, string> = {}) => fetch(fixture.shell.origin + path, { headers: { ...fixture.headers, ...extra } });

it('authenticates a fresh nonce against the persistent identity and rejects changed identity', async () => {
  expect(await fixture.upstream.authenticate()).toEqual(identity);
  const changed = new ShellUpstream({ origin: fixture.origin, transport: 'ssh', token, identity: { ...identity, gatewayId: randomUUID() } });
  await expect(changed.authenticate()).rejects.toThrow('GATEWAY_IDENTITY_CHANGED'); changed.close();
  mode = 'nonce'; await expect(fixture.upstream.authenticate()).rejects.toThrow('GATEWAY_IDENTITY_PROOF_FAILED');
});
it('restricts SSH localhost resolution to loopback and proves a pin before sending owner credentials', async () => {
  const pinned = new ShellUpstream({ origin: fixture.origin.replace('127.0.0.1', 'localhost'), transport: 'ssh', token, identity });
  const before = upstreamCalls.length;
  expect(await pinned.authenticate()).toEqual(identity);
  expect(upstreamCalls[before].path).toBe('/api/gateway-identity/challenge');
  expect(upstreamCalls[before].headers.authorization).toBeUndefined();
  expect(upstreamCalls[before + 1].headers.authorization).toBe(`Bearer ${token}`);
  pinned.close();
});
it('keeps bootstrap one-use and requires exact Host, Origin, cookie and window proof', async () => {
  expect(() => fixture.shell.bootstrap()).toThrow('CONSUMED');
  expect((await get('/api/browser-session')).status).toBe(200);
  for (const headers of [{}, { ...fixture.headers, Origin: 'http://localhost:1' }, { ...fixture.headers, Cookie: 'wrong' }, { ...fixture.headers, 'X-Xopc-Desktop-Window': 'wrong' }]) {
    expect((await fetch(fixture.shell.origin + '/api/models', { headers })).status).toBe(401);
  }
  const status = await new Promise(resolve => {
    const req = request(fixture.shell.origin + '/api/models', { headers: { ...fixture.headers, Host: 'localhost:1' } }, res => { res.resume(); resolve(res.statusCode); });
    req.end();
  });
  expect(status).toBe(403);
});
it.each(['/api/config', '/api/update', '/api/devices', '/api/endpoint-tools/compatibility', '/api/browser/status', '/api/%6dodels', '/api/models?url=https://bad.invalid', '/api/models?x=1&x=2'])('denies %s before an upstream call', async path => {
  const count = upstreamCalls.length; expect((await get(path)).status).toBe(403); expect(upstreamCalls).toHaveLength(count);
});
it('constructs upstream auth/origin without forwarding credentials or trusting upstream headers', async () => {
  const response = await get('/api/models', { Authorization: 'Bearer renderer', Forwarded: 'host=bad', 'X-Forwarded-Host': 'bad' });
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true });
  const call = upstreamCalls.at(-1)!;
  expect(call.headers).toMatchObject({ authorization: `Bearer ${token}`, origin: fixture.origin });
  expect(call.headers.cookie).toBeUndefined(); expect(call.headers.forwarded).toBeUndefined(); expect(call.headers['x-forwarded-host']).toBeUndefined();
  expect(response.headers.get('set-cookie')).toBeNull(); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-security-policy')).not.toContain('bad.invalid');
});
it('refuses redirects/HTML and locks on upstream auth revocation', async () => {
  mode = 'redirect'; expect((await get('/api/models')).status).toBe(502);
  mode = 'html'; expect((await get('/api/models')).status).toBe(502);
  mode = '401'; expect((await get('/api/models')).status).toBe(401);
  mode = ''; expect((await get('/api/models')).status).toBe(401);
});
it('streams allowed media/Range, rejects HTML and oversized resources, cancels upstream on abort', async () => {
  const path = '/api/media/read?uri=fixture&conversationId=fixture';
  const range = await get(path, { Range: 'bytes=0-2' }); expect(range.status).toBe(206); expect(await range.text()).toBe('png');
  expect(range.headers.get('content-range')).toBe('bytes 0-2/6');
  expect((await get(path, { Range: 'bytes=0-1,4-5' })).status).toBe(416);
  mode = 'html'; expect((await get(path)).status).toBe(502);
  mode = 'oversize'; expect((await get(path)).status).toBe(502);
  mode = 'stream'; const abort = new AbortController();
  const response = await fetch(fixture.shell.origin + path, { headers: fixture.headers, signal: abort.signal });
  await response.body!.getReader().read(); abort.abort();
  for (let i = 0; i < 50 && !streamClosed; i++) await new Promise(r => setTimeout(r, 10));
  expect(streamClosed).toBe(true);
});
it('bounds HTTP concurrency and queues without changing the request budget', async () => {
  mode = 'blocked';
  const calls = Array.from({ length: 33 }, () => get('/api/models').then(async response => { await response.arrayBuffer(); return response.status; }, () => -1));
  expect(await Promise.race(calls)).toBe(429);
  expect(held.length).toBe(16);
  mode = '';
  for (const res of held) { res.setHeader('Content-Type', 'application/json'); res.end('{}'); }
  const statuses = await Promise.all(calls);
  expect(statuses.filter(status => status === 200)).toHaveLength(32);
  expect(statuses.filter(status => status === 429)).toHaveLength(1);
});
it('reserves control capacity while four media streams are active', async () => {
  mode = 'stream';
  const aborts = Array.from({ length: 4 }, () => new AbortController());
  const streams = await Promise.all(aborts.map(abort => fetch(fixture.shell.origin + '/api/media/read?uri=fixture&conversationId=fixture', { headers: fixture.headers, signal: abort.signal })));
  expect(streams.every(response => response.ok)).toBe(true);
  expect((await get('/api/media/read?uri=fixture&conversationId=fixture')).status).toBe(429);
  expect((await get('/api/models')).status).toBe(200);
  for (const abort of aborts) abort.abort();
});
async function ticket() {
  const clientId = randomUUID();
  const response = await fetch(fixture.shell.origin + '/api/realtime/tickets', { method: 'POST', headers: { ...fixture.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, clientKind: 'web', protocolVersion: 2 }) });
  expect(response.status).toBe(200); const value = await response.json(); return { ticket: value.payload.ticket, clientId, clientKind: 'web', subscriptions: [] };
}
async function socket() {
  const ws = new WebSocket(fixture.shell.origin.replace('http', 'ws') + '/api/realtime/v1/ws', { headers: fixture.headers, origin: fixture.shell.origin });
  ws.on('error', () => {}); await once(ws, 'open'); return ws;
}
it('reuses realtime envelopes but rejects ticket replay and Endpoint/control messages', async () => {
  const hello = await ticket();
  const ws = await socket(); const ready = once(ws, 'message'); ws.send(JSON.stringify(envelope('realtime.hello', hello)));
  expect(JSON.parse((await ready)[0].toString()).kind).toBe('realtime.ready');
  const pong = once(ws, 'message'); ws.send(JSON.stringify(envelope('realtime.ping', {}))); expect(JSON.parse((await pong)[0].toString()).kind).toBe('realtime.pong');
  const closed = once(ws, 'close'); ws.send(JSON.stringify(envelope('realtime.subscribe', { subscriptions: [{ topic: 'logs' }] }))); await closed;
  expect(fixture.remoteMessages).toHaveLength(2);
  const replay = await socket(); const rejected = once(replay, 'close'); replay.send(JSON.stringify(envelope('realtime.hello', hello))); await rejected;
  expect(fixture.remoteMessages).toHaveLength(2);
});
it('bounds websocket connections including pending hellos', async () => {
  const first = await socket(); const second = await socket();
  const third = new WebSocket(fixture.shell.origin.replace('http', 'ws') + '/api/realtime/v1/ws', { headers: fixture.headers, origin: fixture.shell.origin });
  third.on('error', () => {});
  await new Promise(resolve => third.once('close', resolve));
  expect(fixture.wss.clients.size).toBe(2);
  first.terminate(); second.terminate();
});
it('makes logout immediately invalidate the cookie', async () => {
  const response = await fetch(fixture.shell.origin + '/api/browser-session', { method: 'DELETE', headers: fixture.headers });
  expect(response.status).toBe(200); expect((await get('/api/models')).status).toBe(401);
});
it('does not resurrect an expired session after a wall-clock rollback', async () => {
  const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 16 * 60_000);
  expect((await get('/api/models')).status).toBe(401);
  clock.mockReturnValue(now); expect((await get('/api/models')).status).toBe(401);
});
describe('pure route and frame policy', () => {
  it('rejects raw URL normalization tricks and writes outside S2', () => {
    for (const path of ['http://bad.invalid/api/models', '//bad.invalid/api/models', '/api/x/../models', '/api/./models', '/api/models#x', '/api/agents/..', '/api/models?x=1']) expect(shellRoute('GET', path)).toBeUndefined();
    expect(shellRoute('POST', '/api/sessions/id/inputs')).toBeUndefined();
    expect(() => filterRealtime(JSON.stringify(envelope('realtime.hello', { ticket: 'a'.repeat(32), clientId: 'x', clientKind: 'desktop', subscriptions: [] })), 'client')).toThrow();
    expect(() => filterRealtime(JSON.stringify(envelope('realtime.ready', { connectionId: randomUUID(), heartbeatIntervalMs: 15000, heartbeatTimeoutMs: 45000, endpoint: { endpointId: 'x', turnToken: 'a'.repeat(32) } })), 'server')).toThrow();
  });
  it('bounds queued work and cancellation without stranding slots', async () => {
    const slots = new ShellSlots(1, 1); const signal = new AbortController();
    const release = await slots.acquire(signal.signal); const abort = new AbortController();
    const waiting = slots.acquire(abort.signal); const rejected = expect(waiting).rejects.toThrow('CANCELLED');
    await expect(slots.acquire(signal.signal)).rejects.toThrow('BUSY'); abort.abort(); await rejected; release();
    const next = await slots.acquire(signal.signal); next(); slots.close(); await expect(slots.acquire(signal.signal)).rejects.toThrow('CLOSED');
  });
});
