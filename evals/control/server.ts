import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ControlStore } from './store.js';

export function createDashboard(store: ControlStore) {
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/dashboard.js', ['dashboard.js', 'text/javascript; charset=utf-8']],
    ['/dashboard.css', ['dashboard.css', 'text/css; charset=utf-8']],
  ]);
  const clients = new Set<() => void>();
  const server = createServer((req, res) => {
    try {
      if (req.method !== 'GET') { res.writeHead(405).end(); return; }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const json = (value: unknown, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(value)); };
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 30));
      if (url.pathname === '/api/overview') { json(store.overview()); return; }
      if (url.pathname === '/api/evidence') {
        json(store.list({ q: url.searchParams.get('q') ?? '', benchmark: url.searchParams.get('benchmark') ?? '',
          evidenceClass: url.searchParams.get('evidenceClass') ?? '', validity: url.searchParams.get('validity') ?? '', offset, limit })); return;
      }
      if (url.pathname === '/api/campaigns') { json(store.campaigns()); return; }
      if (url.pathname === '/api/activity') { json(store.recentEvents()); return; }
      if (url.pathname === '/api/improvements') { json(store.improvements()); return; }
      if (url.pathname === '/api/compare') { json(store.compare(url.searchParams.get('left') ?? '', url.searchParams.get('right') ?? '')); return; }
      const detail = url.pathname.match(/^\/api\/evidence\/([a-f0-9]{64})$/);
      if (detail) { const evidence = store.get(detail[1]!); json(evidence ? {...evidence,currentReview:store.currentReview(detail[1]!)} : { error: 'Not found' }, evidence ? 200 : 404); return; }
      const run = url.pathname.match(/^\/api\/evidence\/([a-f0-9]{64})\/runs\/([a-f0-9]{20})$/);
      if (run) { json(store.runDetail(run[1]!, run[2]!, offset)); return; }
      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        let cursor = Math.max(0, Number(req.headers['last-event-id'] ?? url.searchParams.get('after')) || 0);
        const send = () => {
          for (const event of store.events(cursor)) { res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`); cursor = event.seq; }
        };
        send();
        const timer = setInterval(send, 1000);
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
        const close = () => { clearInterval(timer); clearInterval(heartbeat); res.end(); clients.delete(close); };
        clients.add(close); req.on('close', close); return;
      }
      const asset = assets.get(url.pathname);
      if (asset) {
        const [name, contentType] = asset;
        const path = fileURLToPath(new URL(`../coder/apps/web/public/${name}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': contentType!, 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'" }).end(readFileSync(path)); return;
      }
      json({ error: 'Not found' }, 404);
    } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
  });
  return { server, disconnect: () => { for (const close of [...clients]) close(); } };
}
