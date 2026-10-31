import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { WebSocket, WebSocketServer } from 'ws';

import { filterRealtime, shellRoute, ShellSlots } from './policy.js';
import { ShellUpstream } from './upstream.js';

const JSON_MAX = 4 * 1024 * 1024;
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'";
const equalSecret = (value: unknown, expected: string) => typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
const key = (value: string) => createHash('sha256').update(value).digest('hex');

export async function startShell(upstream: ShellUpstream, assets: string, epoch: number, gatewayId: string) {
  const html = await readFile(join(assets, 'remote-shell.html'));
  const js = await readFile(join(assets, 'remote-shell.js'));
  const css = await readFile(join(assets, 'remote-shell.css'));
  const proof = randomBytes(32).toString('base64url');
  const cookie = { name: `xopc_shell_${randomBytes(8).toString('hex')}`, value: randomBytes(32).toString('base64url') };
  const sessionId = randomUUID();
  const expiresAt = Date.now() + 15 * 60_000;
  const slots = new ShellSlots();
  const mediaSlots = new ShellSlots(4, 0);
  const abort = new AbortController();
  const sockets = new Set<Socket>();
  const websockets = new Set<WebSocket>();
  const tickets = new Map<string, { clientId: string; expiresAt: number }>();
  let active = true, bootstrapped = false, connections = 0, origin = '';
  const monotonicExpiry = performance.now() + 15 * 60_000;
  const live = () => {
    if (!active || !bootstrapped) return false;
    if (Date.now() >= expiresAt || performance.now() >= monotonicExpiry) { invalidate(); return false; }
    return true;
  };
  const session = () => ({ authenticated: live(), sessionId, expiresAt, gatewayId, epoch, mode: 'remote', localCapabilities: false });
  const secure = (req: IncomingMessage, ws = false) => live() && req.headers.host === new URL(origin).host
    && equalSecret(req.headers['x-xopc-desktop-window'], proof)
    && (!req.headers.origin ? !ws && req.method === 'GET' : req.headers.origin === origin)
    && equalSecret((req.headers.cookie ?? '').split(';').map(c => c.trim()).find(c => c.startsWith(`${cookie.name}=`))?.slice(cookie.name.length + 1), cookie.value);
  const invalidate = () => {
    active = false; abort.abort(); slots.close(); mediaSlots.close(); tickets.clear();
    for (const ws of websockets) ws.terminate(); upstream.close();
  };
  const server = createServer(async (req, res) => {
    const fail = (status: number, code: string) => {
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify({ ok: false, error: { code } }));
    };
    if (req.headers.host !== new URL(origin).host) { fail(403, 'SHELL_HOST_DENIED'); return; }
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Content-Security-Policy', CSP); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()');
    if (req.method === 'GET' && ['/', '/shell.js', '/shell.css'].includes(req.url ?? '')) {
      const path = req.url!;
      res.setHeader('Content-Type', path === '/' ? 'text/html; charset=utf-8' : path.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
      res.end(path === '/' ? html : path.endsWith('.js') ? js : css); return;
    }
    if (!secure(req)) { fail(401, 'SHELL_SESSION_REQUIRED'); return; }
    if (req.url === '/api/browser-session' && req.method === 'DELETE') { invalidate(); res.end(JSON.stringify(session())); return; }
    if (['/api/browser-session', '/api/desktop-shell/status'].includes(req.url ?? '') && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(session())); return;
    }
    const route = shellRoute(req.method ?? '', req.url ?? '');
    if (!route) { fail(403, 'SHELL_ROUTE_DENIED'); return; }
    const controller = new AbortController();
    const signal = AbortSignal.any([abort.signal, controller.signal]);
    const cancel = () => { if (!res.writableFinished) controller.abort(); };
    req.on('aborted', cancel); res.on('close', cancel);
    let release: (() => void) | undefined, releaseMedia: (() => void) | undefined;
    let headerTimer: ReturnType<typeof setTimeout> | undefined;
    let idle: ReturnType<typeof setTimeout> | undefined;
    try {
      if (route === 'media') releaseMedia = await mediaSlots.acquire(signal);
      release = await slots.acquire(signal);
      if (!live()) throw new Error('SHELL_SESSION_EXPIRED');
      const headers: Record<string, string> = {};
      if (route === 'media' && req.headers.range) {
        if (!/^bytes=\d+-\d*$/.test(req.headers.range) || req.headers.range.slice(6).split('-').filter(Boolean).some(v => !Number.isSafeInteger(Number(v)) || Number(v) >= 32 * 1024 * 1024) || (req.headers.range.split('-')[1] && Number(req.headers.range.split('-')[1]) < Number(req.headers.range.slice(6).split('-')[0]))) { fail(416, 'SHELL_RANGE_DENIED'); return; }
        headers.Range = req.headers.range;
      }
      let body: string | undefined, clientId: string | undefined;
      if (route === 'ticket') {
        if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) { fail(415, 'SHELL_JSON_REQUIRED'); return; }
        let size = 0; const chunks: Buffer[] = [];
        const timer = setTimeout(() => controller.abort(), 15_000);
        try { for await (const chunk of req) { size += chunk.length; if (size > 1024) throw new Error('SHELL_BODY_LIMIT'); chunks.push(chunk); } }
        finally { clearTimeout(timer); }
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (value.clientKind !== 'web' || value.protocolVersion !== 2 || typeof value.clientId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value.clientId)
          || Object.keys(value).some(k => !['clientId', 'clientKind', 'protocolVersion'].includes(k))) throw new Error('SHELL_TICKET_DENIED');
        for (const [id, ticket] of tickets) if (ticket.expiresAt <= Date.now()) tickets.delete(id);
        if (tickets.size >= 32) throw new Error('SHELL_TICKET_LIMIT');
        clientId = value.clientId; body = JSON.stringify(value); headers['Content-Type'] = 'application/json';
      }
      const outgoing = upstream.request(req.url!, req.method, headers, signal);
      headerTimer = setTimeout(() => controller.abort(), 15_000);
      outgoing.end(body);
      const response = await new Promise<IncomingMessage>((resolve, reject) => { outgoing.once('response', resolve); outgoing.once('error', reject); });
      clearTimeout(headerTimer);
      const status = response.statusCode ?? 502;
      if (status === 401 || status === 403) { response.destroy(); invalidate(); fail(401, 'GATEWAY_AUTH_FAILED'); return; }
      if (status < 200 || status >= 300) { response.destroy(); fail(status >= 300 && status < 400 ? 502 : status, 'GATEWAY_REQUEST_FAILED'); return; }
      const mime = (response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if ((route !== 'media' && mime !== 'application/json') || (route === 'media' && !/^(?:image\/(?:png|jpeg|gif|webp)|audio\/(?:mpeg|wav|ogg|mp4)|video\/(?:mp4|webm))$/.test(mime))) {
        response.destroy(); fail(502, 'SHELL_RESPONSE_TYPE_DENIED'); return;
      }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); fail(502, 'SHELL_ENCODING_DENIED'); return; }
      if (route === 'media' && status === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers['content-range'] ?? '');
        const requested = /^bytes=(\d+)-(\d*)$/.exec(headers.Range ?? '');
        if (!range || !requested || Number(range[1]) !== Number(requested[1]) || Number(range[2]) < Number(range[1]) || Number(range[3]) <= Number(range[2])
          || Number(range[3]) > 32 * 1024 * 1024 || (requested[2] && Number(range[2]) > Number(requested[2]))
          || (response.headers['content-length'] && Number(response.headers['content-length']) !== Number(range[2]) - Number(range[1]) + 1)) {
          response.destroy(); fail(502, 'SHELL_RANGE_DENIED'); return;
        }
      }
      const maximum = route === 'media' ? 32 * 1024 * 1024 : route === 'ticket' ? 16 * 1024 : JSON_MAX;
      if (Number(response.headers['content-length'] ?? 0) > maximum) { response.destroy(); fail(502, 'SHELL_RESPONSE_LIMIT'); return; }
      const renew = () => { clearTimeout(idle); idle = setTimeout(() => controller.abort(), 30_000); };
      renew();
      if (route === 'media') {
        let size = 0;
        const limiter = new Transform({ transform(chunk, _encoding, done) {
          renew(); size += chunk.length;
          done(size > maximum ? new Error('SHELL_RESPONSE_LIMIT') : undefined, chunk);
        } });
        res.statusCode = status; res.setHeader('Content-Type', mime);
        if (response.headers['content-range'] && /^bytes \d+-\d+\/\d+$/.test(response.headers['content-range'])) res.setHeader('Content-Range', response.headers['content-range']);
        res.setHeader('Content-Disposition', 'inline');
        await pipeline(response, limiter, res, { signal });
      } else {
        let size = 0; const chunks: Buffer[] = [];
        for await (const chunk of response) { renew(); size += chunk.length; if (size > maximum) { response.destroy(); throw new Error('SHELL_RESPONSE_LIMIT'); } chunks.push(chunk); }
        const text = Buffer.concat(chunks).toString('utf8');
        if (text.includes(upstream.target.token)) throw new Error('SHELL_RESPONSE_DENIED');
        const value = JSON.parse(text);
        if (route === 'ticket') {
          const ticket = value.payload;
          if (value.ok !== true || typeof ticket?.ticket !== 'string' || ticket.ticket.length > 512 || ticket.ticket.length < 32 || !Number.isSafeInteger(ticket.expiresAt)
            || ticket.expiresAt <= Date.now() || ticket.expiresAt > Date.now() + 31_000 || ticket.clientId !== clientId || ticket.clientKind !== 'web') throw new Error('SHELL_TICKET_DENIED');
          if (tickets.size >= 32) throw new Error('SHELL_TICKET_LIMIT');
          tickets.set(key(ticket.ticket), { clientId: clientId!, expiresAt: ticket.expiresAt });
        }
        res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(text);
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const status = code === 'SHELL_BUSY' || code === 'SHELL_TICKET_LIMIT' ? 429 : code === 'SHELL_BODY_LIMIT' ? 413 : code === 'SHELL_TICKET_DENIED' ? 400 : 502;
      fail(status, status === 502 ? 'SHELL_REQUEST_FAILED' : code);
    }
    finally { clearTimeout(headerTimer); clearTimeout(idle); controller.abort(); release?.(); releaseMedia?.(); }
  });
  server.maxConnections = 64; server.maxRequestsPerSocket = 64;
  server.requestTimeout = 15_000; server.headersTimeout = 15_000; server.maxHeadersCount = 40;
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/api/realtime/v1/ws' || !secure(req, true) || connections >= 2) { socket.destroy(); return; }
    connections++;
    const remote = new WebSocket(upstream.origin.replace(/^http/, 'ws') + '/api/realtime/v1/ws', { origin: upstream.origin, lookup: upstream.lookup, maxPayload: JSON_MAX, perMessageDeflate: false, handshakeTimeout: 15_000 });
    const close = () => { remote.terminate(); socket.destroy(); };
    socket.once('close', () => remote.terminate());
    remote.once('error', close);
    remote.once('open', () => {
      if (!live() || socket.destroyed) { remote.terminate(); return; }
      wss.handleUpgrade(req, socket, head, local => {
        websockets.add(local); websockets.add(remote);
        let hello = false;
        const helloTimer = setTimeout(() => { local.terminate(); remote.terminate(); }, 5000);
        const relay = (from: WebSocket, to: WebSocket, direction: 'client' | 'server') => {
          from.on('message', (data, binary) => {
            try {
              if (!live() || binary || to.readyState !== WebSocket.OPEN || to.bufferedAmount + Buffer.byteLength(data as Buffer) > JSON_MAX) throw new Error();
              const frame = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
              const text = frame.toString(); const value = filterRealtime(text, direction);
              if (direction === 'client') {
                if (!hello) {
                  if (value.kind !== 'realtime.hello') throw new Error();
                  const claim = tickets.get(key(value.payload.ticket)); tickets.delete(key(value.payload.ticket));
                  if (!claim || claim.expiresAt <= Date.now() || claim.clientId !== value.payload.clientId) throw new Error();
                  hello = true; clearTimeout(helloTimer);
                } else if (value.kind === 'realtime.hello') throw new Error();
              }
              const encoded = JSON.stringify(value);
              if (Buffer.byteLength(encoded) > JSON_MAX || to.bufferedAmount + Buffer.byteLength(encoded) > JSON_MAX) throw new Error('SHELL_FRAME_LIMIT');
              to.send(encoded);
            } catch { local.terminate(); remote.terminate(); }
          });
        };
        relay(local, remote, 'client'); relay(remote, local, 'server');
        const cleanup = () => { clearTimeout(helloTimer); websockets.delete(local); websockets.delete(remote); local.terminate(); remote.terminate(); };
        local.once('close', cleanup); remote.once('close', cleanup); local.on('error', cleanup); remote.on('error', cleanup);
      });
    });
    remote.once('close', () => { connections--; socket.destroy(); });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const expiry = setTimeout(invalidate, Math.max(1, expiresAt - Date.now())); expiry.unref();
  return {
    origin, proof, epoch,
    bootstrap() { if (!active || bootstrapped) throw new Error('SHELL_BOOTSTRAP_CONSUMED'); bootstrapped = true; return { ...cookie, expiresAt }; },
    async close() { invalidate(); clearTimeout(expiry); for (const socket of sockets) socket.destroy(); wss.close(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
