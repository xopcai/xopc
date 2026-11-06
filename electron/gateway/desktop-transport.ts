import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { extname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { WebSocket, WebSocketServer } from 'ws';

import { HTML_PREVIEW_HEADERS, HTML_PREVIEW_PATH, HTML_PREVIEW_SHELL } from '../../src/gateway/html-preview-shell.js';

export type DesktopGatewayTarget = { origin: string; token: string; scope: string };
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const equal = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** One local renderer and transport for every Gateway; upstream content never supplies application code. */
export class DesktopGatewayTransport {
  readonly credential = randomBytes(32).toString('base64url');
  private cookieName = `xopc_desktop_${randomBytes(8).toString('hex')}`;
  private cookie = randomBytes(32).toString('base64url');
  private target?: DesktopGatewayTarget;
  private requests = new Set<AbortController>();
  private sockets = new Set<WebSocket>();
  private server = http.createServer((req, res) => { void this.handle(req, res); });
  private wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  origin = '';

  constructor(private readonly assets: string) {
    this.server.on('upgrade', (req, socket, head) => {
      const target = this.target;
      if (!target || !this.allowed(req) || !this.authenticated(req) || !req.url?.startsWith('/api/')) { socket.destroy(); return; }
      const remote = new WebSocket(target.origin.replace(/^http/, 'ws') + req.url, { origin: target.origin, handshakeTimeout: 15_000, maxPayload: 32 * 1024 * 1024 });
      this.sockets.add(remote);
      const stop = () => { remote.terminate(); socket.destroy(); this.sockets.delete(remote); };
      socket.once('close', stop); remote.once('error', stop);
      remote.once('open', () => {
        if (this.target !== target || socket.destroyed) { stop(); return; }
        this.wss.handleUpgrade(req, socket, head, local => {
          this.sockets.add(local);
          for (const [from, to] of [[local, remote], [remote, local]]) {
            from.on('message', (data, binary) => { if (to.readyState === WebSocket.OPEN && to.bufferedAmount < 32 * 1024 * 1024) to.send(data, { binary }); else { local.terminate(); stop(); } });
            from.once('close', () => { this.sockets.delete(from); to.terminate(); });
            from.once('error', () => { local.terminate(); stop(); });
          }
        });
      });
    });
  }
  async start(port = 0): Promise<void> {
    await new Promise<void>((resolve, reject) => { this.server.once('error', reject); this.server.listen(port, '127.0.0.1', () => { this.server.off('error', reject); resolve(); }); });
    this.origin = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
  }
  select(target: DesktopGatewayTarget): void {
    for (const request of this.requests) request.abort();
    for (const socket of this.sockets) socket.terminate();
    this.sockets.clear();
    this.cookie = randomBytes(32).toString('base64url');
    this.target = Object.freeze({ ...target });
  }
  private allowed(req: IncomingMessage): boolean {
    return req.headers.host === new URL(this.origin).host && (!req.headers.origin || req.headers.origin === this.origin)
      && req.headers['sec-fetch-site'] !== 'cross-site';
  }
  private authenticated(req: IncomingMessage): boolean {
    return (req.headers.cookie ?? '').split(';').some(value => equal(value.trim(), `${this.cookieName}=${this.cookie}`));
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    const fail = (status: number, message: string) => { if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ error: message })); else res.destroy(); };
    try {
      if (!this.allowed(req)) { fail(403, 'Desktop origin required'); return; }
      const path = new URL(req.url ?? '/', this.origin).pathname;
      // The preview shell is renderer code and must come from the desktop bundle.
      if (path === HTML_PREVIEW_PATH && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(200, HTML_PREVIEW_HEADERS).end(req.method === 'HEAD' ? undefined : HTML_PREVIEW_SHELL);
        return;
      }
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      if (req.method === 'GET' && (path === '/' || path === '/index.html' || path.startsWith('/assets/') || /^\/(?:favicon\.[a-z]+|manifest\.webmanifest|icons\/[^.][^?]*)$/.test(path))) {
        const root = await realpath(this.assets);
        const file = await realpath(resolve(root, '.' + decodeURIComponent(path === '/' ? '/index.html' : path)));
        if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { fail(404, 'Resource not found'); return; }
        res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
        await pipeline(createReadStream(file), res); return;
      }
      const target = this.target;
      if (!target) { fail(503, 'Gateway not connected'); return; }
      const browserSession = path === '/api/browser-session';
      if (browserSession && req.method === 'POST') {
        if (!equal(req.headers.authorization ?? '', `Bearer ${this.credential}`)) { fail(401, 'Desktop credential required'); return; }
      } else if (!this.authenticated(req)) { fail(401, 'Desktop session required'); return; }
      if (browserSession && req.method === 'DELETE') {
        this.cookie = randomBytes(32).toString('base64url');
        res.setHeader('Set-Cookie', `${this.cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
        res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); return;
      }
      if (!req.url?.startsWith('/') || req.url.startsWith('//') || /[\\\r\n]/.test(req.url)) { fail(400, 'Invalid path'); return; }
      const controller = new AbortController(); this.requests.add(controller);
      const abort = () => { if (!res.writableFinished) controller.abort(); };
      req.once('aborted', abort); res.once('close', abort);
      try {
        const headers: Record<string, string> = { Authorization: `Bearer ${target.token}`, Origin: target.origin, 'Accept-Encoding': 'identity' };
        for (const name of ['content-type', 'content-length', 'range', 'if-match', 'if-none-match', 'last-event-id', 'accept']) {
          const value = req.headers[name]; if (typeof value === 'string' && !(browserSession && name === 'content-length')) headers[name] = value;
        }
        const url = new URL(browserSession ? '/api/browser-session' : req.url, target.origin);
        const outgoing = (url.protocol === 'https:' ? https : http).request(url, { method: browserSession ? 'GET' : req.method, headers, signal: controller.signal });
        const pending = new Promise<IncomingMessage>((resolve, reject) => { outgoing.once('response', resolve); outgoing.once('error', reject); });
        if (browserSession) outgoing.end(); else req.pipe(outgoing);
        const response = await pending;
        if (this.target !== target) { response.destroy(); fail(409, 'Gateway changed'); return; }
        const status = response.statusCode ?? 502;
        if (status >= 300 && status < 400 && status !== 304) { response.destroy(); fail(502, 'Gateway redirect rejected'); return; }
        res.statusCode = status;
        for (const name of ['content-type', 'content-disposition', 'content-length', 'content-range', 'accept-ranges', 'etag', 'retry-after', 'cache-control']) {
          const value = response.headers[name]; if (value) res.setHeader(name, value);
        }
        if (String(response.headers['content-type']).startsWith('text/html')) res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-downloads');
        if (browserSession && status === 200 && req.method === 'POST') res.setHeader('Set-Cookie', `${this.cookieName}=${this.cookie}; HttpOnly; SameSite=Strict; Path=/`);
        await pipeline(response, res, { signal: controller.signal });
      } finally { controller.abort(); this.requests.delete(controller); }
    } catch (error) { fail((error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 502, 'Gateway request failed'); }
  }
  async close(): Promise<void> {
    for (const request of this.requests) request.abort();
    for (const socket of this.sockets) socket.terminate();
    this.server.closeAllConnections();
    await new Promise<void>(resolve => this.server.close(() => resolve()));
    this.wss.close();
  }
}
