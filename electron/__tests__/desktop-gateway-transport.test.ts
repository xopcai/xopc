import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

import { DesktopGatewayTransport } from '../gateway/desktop-transport.js';

let root: string;
let transport: DesktopGatewayTransport;
let servers: Array<ReturnType<typeof createServer>>;
let peers: WebSocketServer[];
let calls: Array<{ id: string; path?: string; token?: string; body: string }>;
async function backend(id: string) {
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    calls.push({ id, path: req.url, token: req.headers.authorization, body: Buffer.concat(chunks).toString() });
    if (req.url === '/api/html') { res.setHeader('Content-Type', 'text/html'); res.end('<script>untrusted()</script>'); return; }
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Set-Cookie', 'upstream=secret');
    res.end(JSON.stringify({ conversationId: id + ':owner', id }));
  });
  const wss = new WebSocketServer({ server }); peers.push(wss);
  wss.on('connection', (ws, req) => { expect(req.headers.origin).toBe(`http://127.0.0.1:${(server.address() as { port: number }).port}`); ws.on('message', message => ws.send(id + ':' + message)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); servers.push(server);
  return { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, token: id + '-token', scope: id };
}
async function login() {
  const response = await fetch(transport.origin + '/api/browser-session', { method: 'POST', headers: { Origin: transport.origin, Authorization: `Bearer ${transport.credential}` } });
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie')!.split(';')[0];
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'xopc-transport-')); await writeFile(join(root, 'index.html'), '<div id="root">bundled UI</div>');
  servers = []; peers = []; calls = []; transport = new DesktopGatewayTransport(root); await transport.start();
});
afterEach(async () => {
  await transport.close();
  for (const wss of peers) { for (const peer of wss.clients) peer.terminate(); wss.close(); }
  await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  await rm(root, { recursive: true, force: true });
});

it('keeps application resources local and moves every API request to the selected Gateway', async () => {
  const a = await backend('a'), b = await backend('b'); transport.select(a);
  expect(await (await fetch(transport.origin)).text()).toContain('bundled UI'); expect(calls).toHaveLength(0);
  const oldCookie = await login();
  const result = await fetch(transport.origin + '/api/upload', { method: 'POST', headers: { Cookie: oldCookie, Origin: transport.origin, 'Content-Type': 'application/octet-stream' }, body: 'binary-upload' });
  expect(result.headers.get('set-cookie')).toBeNull(); expect((await result.json()).id).toBe('a');
  expect(calls.at(-1)).toMatchObject({ id: 'a', token: 'Bearer a-token', body: 'binary-upload' });
  transport.select(b);
  expect((await fetch(transport.origin + '/api/config', { headers: { Cookie: oldCookie } })).status).toBe(401);
  const cookie = await login();
  expect((await (await fetch(transport.origin + '/api/config', { headers: { Cookie: cookie } })).json()).id).toBe('b');
  expect(await (await fetch(transport.origin)).text()).toContain('bundled UI');
});

it('rejects untrusted browser requests and sandboxes upstream documents', async () => {
  transport.select(await backend('a'));
  expect((await fetch(transport.origin + '/api/config')).status).toBe(401);
  const cookie = await login();
  expect((await fetch(transport.origin + '/api/config', { headers: { Cookie: cookie, Origin: 'https://other.example' } })).status).toBe(403);
  const html = await fetch(transport.origin + '/api/html', { headers: { Cookie: cookie } });
  expect(html.headers.get('content-security-policy')).toContain('sandbox'); expect(html.headers.get('content-security-policy')).not.toContain('allow-same-origin');
});

it('relays realtime and closes the old connection on Gateway switch', async () => {
  transport.select(await backend('a')); const cookie = await login();
  const ws = new WebSocket(transport.origin.replace('http', 'ws') + '/api/realtime/v1/ws', { origin: transport.origin, headers: { Cookie: cookie } });
  await once(ws, 'open'); const response = once(ws, 'message'); ws.send('hello');
  expect((await response)[0].toString()).toBe('a:hello');
  const closed = once(ws, 'close'); transport.select(await backend('b')); await closed;
  expect((await fetch(transport.origin + '/api/config', { headers: { Cookie: cookie } })).status).toBe(401);
});
