import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
const issuer = process.env.PLUGIN_LAB_ISSUER || 'https://store.xopc.ai/plugin-lab';
const clients = new Map(), codes = new Map(), tokens = new Map(), refreshes = new Map();
const random = () => randomBytes(32).toString('base64url');
const esc = s => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const metadata = { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['notes:read'] };
const server = createServer(async (req, res) => {
  const json = (value, status = 200, headers = {}) => res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }).end(JSON.stringify(value));
  try {
    const url = new URL(req.url, issuer), route = url.pathname;
    for (const map of [clients, codes, tokens, refreshes]) for (const [key, value] of map) if (value.expires < Date.now()) map.delete(key);
    if ([clients, codes, tokens, refreshes].some(m => m.size > 5000)) return json({ error: 'capacity_exceeded' }, 503);
    if (route === '/plugin-lab/health') return json({ ok: true, fixture: true });
    if (route.includes('/.well-known/oauth-authorization-server')) return json(metadata);
    if (route === '/plugin-lab/resource-metadata') return json({ resource: `${issuer}/mcp`, authorization_servers: [issuer], scopes_supported: ['notes:read'] });
    if (route === '/plugin-lab/authorize') {
      const client = clients.get(url.searchParams.get('client_id'));
      const redirect = url.searchParams.get('redirect_uri');
      if (!client?.redirects.includes(redirect) || url.searchParams.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code_challenge') || '') || url.searchParams.get('response_type') !== 'code' || (url.searchParams.get('scope') || '').split(' ').filter(Boolean).some(s => s !== 'notes:read')) return json({ error: 'invalid_request' }, 400);
      const callback = new URL(redirect);
      if (url.searchParams.get('consent') === 'allow') {
        const code = random(); codes.set(code, { clientId: url.searchParams.get('client_id'), redirect, challenge: url.searchParams.get('code_challenge'), expires: Date.now() + 120000 });
        callback.searchParams.set('code', code); callback.searchParams.set('state', url.searchParams.get('state') || '');
        res.writeHead(302, { Location: callback.href, 'Cache-Control': 'no-store' }).end(); return;
      }
      if (url.searchParams.get('consent') === 'deny') {
        callback.searchParams.set('error', 'access_denied'); callback.searchParams.set('state', url.searchParams.get('state') || '');
        res.writeHead(302, { Location: callback.href }).end(); return;
      }
      const allow = new URL(url); allow.searchParams.set('consent', 'allow');
      const deny = new URL(url); deny.searchParams.set('consent', 'deny');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" }).end(`<html lang="en"><meta name="viewport" content="width=device-width"><title>XOPC Plugin Lab authorization</title><main style="max-width:32rem;margin:4rem auto;font:18px system-ui;padding:1rem"><h1>XOPC Plugin Lab</h1><p>Authorize this local xopc installation to read synthetic sandbox notes. This is a test account, containing no personal or third-party data.</p><p>Permission: notes:read</p><p><a href="${esc(allow.href)}">Authorize sandbox account</a></p><p><a href="${esc(deny.href)}">Deny access</a></p></main></html>`); return;
    }
    let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 65536) return json({ error: 'body_too_large' }, 413); }
    if (route === '/plugin-lab/register' && req.method === 'POST') {
      const input = JSON.parse(body);
      if (!Array.isArray(input.redirect_uris) || !input.redirect_uris.length || input.redirect_uris.length > 5 || input.redirect_uris.some(value => { try { const u = new URL(value); return u.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.username || u.password || u.hash; } catch { return true; } })) return json({ error: 'invalid_redirect_uri' }, 400);
      const clientId = random(); clients.set(clientId, { redirects: input.redirect_uris, expires: Date.now() + 86400000 });
      return json({ client_id: clientId, redirect_uris: input.redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, 201);
    }
    if (route === '/plugin-lab/token' && req.method === 'POST') {
      const input = new URLSearchParams(body), clientId = input.get('client_id');
      let grant;
      if (input.get('grant_type') === 'authorization_code') {
        grant = codes.get(input.get('code')); codes.delete(input.get('code'));
        if (!grant || grant.clientId !== clientId || grant.redirect !== input.get('redirect_uri') || createHash('sha256').update(input.get('code_verifier') || '').digest('base64url') !== grant.challenge) return json({ error: 'invalid_grant' }, 400);
      } else if (input.get('grant_type') === 'refresh_token') {
        grant = refreshes.get(input.get('refresh_token')); refreshes.delete(input.get('refresh_token'));
        if (!grant || grant.clientId !== clientId) return json({ error: 'invalid_grant' }, 400);
      } else return json({ error: 'unsupported_grant_type' }, 400);
      const access = random(), refresh = random();
      tokens.set(access, { clientId, expires: Date.now() + 3600000 }); refreshes.set(refresh, { clientId, expires: Date.now() + 86400000 });
      return json({ access_token: access, refresh_token: refresh, expires_in: 3600, token_type: 'Bearer', scope: 'notes:read' });
    }
    if (route !== '/plugin-lab/mcp') return json({ error: 'not_found' }, 404);
    if (!tokens.has((req.headers.authorization || '').replace(/^Bearer /, ''))) return json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': `Bearer resource_metadata="${issuer}/resource-metadata"` });
    if (req.method === 'DELETE') { res.writeHead(200).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const q = JSON.parse(body);
    if (q.id === undefined) { res.writeHead(202).end(); return; }
    let result;
    if (q.method === 'initialize') result = { protocolVersion: '2025-03-26', serverInfo: { name: 'xopc-plugin-lab', version: '1.0.0' }, capabilities: { tools: {} } };
    else if (q.method === 'tools/list') result = { tools: [{ name: 'read_sandbox_note', description: 'Read the synthetic Plugin Lab note; read-only.', inputSchema: { type: 'object', properties: {} } }] };
    else if (q.method === 'tools/call' && q.params?.name === 'read_sandbox_note') result = { content: [{ type: 'text', text: JSON.stringify({ id: 'sandbox-note-001', title: 'Store installation verified', source: issuer, synthetic: true }) }] };
    else if (q.method === 'ping') result = {};
    else return json({ jsonrpc: '2.0', id: q.id, error: { code: -32601, message: 'Method not found' } });
    return json({ jsonrpc: '2.0', id: q.id, result });
  } catch { json({ error: 'invalid_request' }, 400); }
});
server.listen(Number(process.env.PLUGIN_LAB_PORT || 19381), '127.0.0.1');
