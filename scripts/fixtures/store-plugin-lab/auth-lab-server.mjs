import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
const origin = process.env.PLUGIN_AUTH_LAB_ISSUER || 'https://store.xopc.ai/plugin-auth-lab';
const sessions = new Map();
const random = () => randomBytes(24).toString('base64url');
createServer(async (request, response) => {
  const json = (value, status = 200) => response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(value));
  try {
    const url = new URL(request.url, origin);
    for (const [id, value] of sessions) if (value.expiresAt < Date.now()) sessions.delete(id);
    if (url.pathname.endsWith('/health')) return json({ ok: true, synthetic: true });
    if (url.pathname === '/plugin-auth-lab/sessions' && request.method === 'POST') {
      if (sessions.size >= 1000) return json({ error: 'capacity' }, 503);
      let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 1000) return json({ error: 'size' }, 413); }
      const input = JSON.parse(body); if (!['cli', 'qr'].includes(input.kind)) return json({ error: 'kind' }, 400);
      const id = random(), pollToken = random(); sessions.set(id, { pollToken, approved: false, expiresAt: Date.now() + 180000 });
      return json({ challengeUrl: `${origin}/approve/${id}`, pollUrl: `${origin}/sessions/${id}`, pollToken });
    }
    const id = url.pathname.split('/').at(-1), session = sessions.get(id);
    if (!session) return json({ error: 'expired' }, 410);
    if (url.pathname.startsWith('/plugin-auth-lab/sessions/')) {
      if (request.headers.authorization !== `Bearer ${session.pollToken}`) return json({ error: 'unauthorized' }, 401);
      return json({ approved: session.approved });
    }
    if (url.pathname.startsWith('/plugin-auth-lab/approve/')) {
      if (request.method === 'POST') { session.approved = true; response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end('<title>Authorized</title><h1>Sandbox account authorized</h1><p>Return to xopc. No personal account was accessed.</p>'); return; }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; form-action 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'" }).end('<html lang="en"><meta name="viewport" content="width=device-width"><title>Plugin authorization lab</title><main style="font:18px system-ui;max-width:32rem;margin:4rem auto;padding:1rem"><h1>Sandbox CLI / QR authorization</h1><p>Read-only synthetic test account. No personal data, payment, or third-party account access.</p><form method="post"><button>Authorize sandbox login</button></form></main></html>'); return;
    }
    return json({ error: 'not_found' }, 404);
  } catch { json({ error: 'invalid_request' }, 400); }
}).listen(Number(process.env.PLUGIN_AUTH_LAB_PORT || 19382), '127.0.0.1');
