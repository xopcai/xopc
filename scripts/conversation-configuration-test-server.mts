/** Independent, real HTTP MCP and OAuth servers for conversational acceptance. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const opaque = () => randomBytes(24).toString('base64url');
async function body(request: IncomingMessage) { let value = ''; for await (const chunk of request) value += chunk; return value; }
function json(response: ServerResponse, value: unknown, status = 200) { response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value)); }

export async function createConfigurationTestServers(options: { rotateCodes?: boolean } = {}) {
  const token = opaque(), sensitive = new Set([token]);
  const calls: Array<{ service: string; account: string; tool: string; code: string; atMs: number }> = [];
  const codes = { public: `PUBLIC-${opaque().slice(0, 8)}`, plain: `PLAIN-${opaque().slice(0, 8)}`, token: `TOKEN-${opaque().slice(0, 8)}`, oauth: `OAUTH-${opaque().slice(0, 8)}` };
  let grants = 0;
  async function mcp(request: IncomingMessage, response: ServerResponse, service: keyof typeof codes, authenticated: boolean, challenge?: string) {
    if (!authenticated) { response.writeHead(401, { 'WWW-Authenticate': challenge ?? 'Bearer' }).end(); return; }
    if (request.method !== 'POST') { response.writeHead(405).end(); return; }
    const message = JSON.parse(await body(request));
    if (message.id === undefined) { response.writeHead(202).end(); return; }
    let result: unknown;
    if (message.method === 'initialize') result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: `${service}-profile`, version: '1' } };
    else if (message.method === 'tools/list') result = { tools: [{ name: 'read_profile', description: 'Read the test account profile and its unique verification code. No arguments or side effects.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false } }] };
    else if (message.method === 'tools/call' && message.params.name === 'read_profile') {
      if (options.rotateCodes) codes[service] = `${service.toUpperCase()}-${opaque().slice(0, 8)}`;
      calls.push({ service, account: 'fixture-reader', tool: message.params.name, code: codes[service], atMs: Date.now() });
      result = { content: [{ type: 'text', text: JSON.stringify({ account: 'fixture-reader', verificationCode: codes[service] }) }], isError: false };
    } else if (message.method === 'ping') result = {};
    else { json(response, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unknown method' } }); return; }
    json(response, { jsonrpc: '2.0', id: message.id, result });
  }
  const publicServer = createServer((request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname;
    if (path === '/public' || path === '/plain' || path === '/token') void mcp(request, response, path === '/public' ? 'public' : path === '/plain' ? 'plain' : 'token', path !== '/token' || request.headers.authorization === `Bearer ${token}`).catch(() => response.writeHead(500).end());
    else response.writeHead(404).end();
  }).listen(0, '127.0.0.1');
  await once(publicServer, 'listening');
  const publicBase = `http://127.0.0.1:${(publicServer.address() as { port: number }).port}`;
  const clients = new Map<string, string[]>();
  const authorizations = new Map<string, { clientId: string; redirect: string; state: string; challenge: string }>();
  const authorizationCodes = new Map<string, { clientId: string; redirect: string; challenge: string }>();
  const access = new Set<string>(), refresh = new Set<string>();
  let oauthBase = '';
  const oauthServer = createServer((request, response) => { void (async () => {
    const url = new URL(request.url!, oauthBase);
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      json(response, { resource: `${oauthBase}/mcp`, authorization_servers: [oauthBase], scopes_supported: ['profile:read'] }); return;
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      json(response, { issuer: oauthBase, authorization_endpoint: `${oauthBase}/authorize`, token_endpoint: `${oauthBase}/token`, registration_endpoint: `${oauthBase}/register`,
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['profile:read'] }); return;
    }
    if (url.pathname === '/register' && request.method === 'POST') {
      const input = JSON.parse(await body(request));
      assert(input.redirect_uris?.length && input.redirect_uris.every((value: string) => { const target = new URL(value); return target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname); }));
      const clientId = randomUUID(); clients.set(clientId, input.redirect_uris);
      json(response, { client_id: clientId, redirect_uris: input.redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, 201); return;
    }
    if (url.pathname === '/authorize') {
      const clientId = url.searchParams.get('client_id')!, redirect = url.searchParams.get('redirect_uri')!, challenge = url.searchParams.get('code_challenge')!;
      assert(clients.get(clientId)?.includes(redirect)); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      const id = opaque(); authorizations.set(id, { clientId, redirect, challenge, state: url.searchParams.get('state')! });
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<html><body><h1>Test Docs authorization</h1><p>Account: fixture-reader. Permission: read profile only.</p><form method="post" action="/consent"><input type="hidden" name="request" value="${id}"><button name="decision" value="allow">Allow connection</button><button name="decision" value="deny">Deny</button></form></body></html>`); return;
    }
    if (url.pathname === '/consent' && request.method === 'POST') {
      const input = new URLSearchParams(await body(request)), id = input.get('request')!, auth = authorizations.get(id);
      assert(auth); authorizations.delete(id);
      const redirect = new URL(auth.redirect); redirect.searchParams.set('state', auth.state);
      if (input.get('decision') === 'allow') {
        const code = opaque(); sensitive.add(code); authorizationCodes.set(code, auth); redirect.searchParams.set('code', code); grants++;
      } else redirect.searchParams.set('error', 'access_denied');
      response.writeHead(302, { Location: redirect.href }).end(); return;
    }
    if (url.pathname === '/token' && request.method === 'POST') {
      const input = new URLSearchParams(await body(request));
      if (input.get('grant_type') === 'authorization_code') {
        const code = input.get('code')!, auth = authorizationCodes.get(code); assert(auth);
        assert.equal(input.get('client_id'), auth.clientId); assert.equal(input.get('redirect_uri'), auth.redirect);
        assert.equal(createHash('sha256').update(input.get('code_verifier')!).digest('base64url'), auth.challenge);
        authorizationCodes.delete(code);
      } else { assert.equal(input.get('grant_type'), 'refresh_token'); assert(refresh.delete(input.get('refresh_token')!)); }
      const accessToken = opaque(), refreshToken = opaque(); access.add(accessToken); refresh.add(refreshToken); sensitive.add(accessToken); sensitive.add(refreshToken);
      json(response, { access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: 3600, scope: 'profile:read' }); return;
    }
    if (url.pathname === '/mcp') {
      await mcp(request, response, 'oauth', access.has((request.headers.authorization ?? '').replace(/^Bearer /, '')),
        `Bearer resource_metadata="${oauthBase}/.well-known/oauth-protected-resource/mcp"`); return;
    }
    response.writeHead(404).end();
  })().catch(() => json(response, { error: 'invalid_request' }, 400)); });
  oauthServer.listen(0, '127.0.0.1'); await once(oauthServer, 'listening');
  oauthBase = `http://127.0.0.1:${(oauthServer.address() as { port: number }).port}`;
  return { publicUrl: `${publicBase}/public`, plainUrl: `${publicBase}/plain`, tokenUrl: `${publicBase}/token`, oauthUrl: `${oauthBase}/mcp`, token, sensitive, calls, codes,
    get grants() { return grants; },
    async close() {
      publicServer.closeAllConnections(); oauthServer.closeAllConnections();
      await Promise.all([new Promise<void>(done => publicServer.close(() => done())), new Promise<void>(done => oauthServer.close(() => done()))]);
    } };
}
