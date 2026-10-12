import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import type { McpAuthorization } from '../../../../agent/mcp/connection-setup.js';
import { getMcpAuthorization } from '../../../../agent/mcp/connection-setup.js';
import { seedTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../../../../storage/sqlite/connection.js';
import { buckets } from '../../../rate-limit/index.js';
import type { GatewayService } from '../../../service.js';
import { createHonoApp } from '../../app.js';

it('detects authentication and completes native OAuth through authenticated Gateway including remote callbacks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-mcp-setup-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', root);
  openXopcDatabase({ path: ':memory:' });
  seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, workspace: root }] });
  buckets.resetAllForTests();
  let origin = '';
  const tokenRequests: URLSearchParams[] = [];
  const calls: string[] = [];
  const mcp = createServer(async (req, res) => {
    const json = (value: unknown, status = 200) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    if (req.url?.startsWith('/.well-known/oauth-protected-resource')) {
      if (req.url.endsWith('/token')) { json({}); return; }
      json({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ['read'] }); return;
    }
    if (req.url === '/.well-known/oauth-authorization-server') {
      json({ issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/access-token`,
        registration_endpoint: `${origin}/register`, response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'] }); return;
    }
    let body = ''; for await (const chunk of req) body += chunk;
    if (req.url === '/register') { json({ ...JSON.parse(body), client_id: 'test-client', token_endpoint_auth_method: 'none' }, 201); return; }
    if (req.url === '/access-token') {
      tokenRequests.push(new URLSearchParams(body));
      json({ access_token: 'fixture-token', token_type: 'Bearer', refresh_token: 'fixture-refresh', expires_in: 3600, scope: 'read' }); return;
    }
    if (req.method !== 'POST') { res.writeHead(req.method === 'DELETE' ? 200 : 405).end(); return; }
    if (req.url !== '/public' && req.headers.authorization !== 'Bearer fixture-token') {
      res.writeHead(401, req.url === '/mcp' ? { 'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` } : {}).end(); return;
    }
    const q = JSON.parse(body); calls.push(q.method);
    if (q.id === undefined) { res.writeHead(202).end(); return; }
    const result = q.method === 'initialize'
      ? { protocolVersion: '2025-03-26', serverInfo: { name: 'fixture', version: '1' }, capabilities: { tools: {} } }
      : q.method === 'tools/list' ? { tools: [{ name: 'lookup', description: 'Read a note', inputSchema: { type: 'object' } }] } : {};
    json({ jsonrpc: '2.0', id: q.id, result });
  });
  mcp.listen(0, '127.0.0.1'); await once(mcp, 'listening');
  const address = mcp.address(); if (!address || typeof address === 'string') throw new Error('Expected MCP listener');
  origin = `http://127.0.0.1:${address.port}`;
  const auth = { mode: 'token' as const, token: 'setup-gateway-token' };
  const config = ConfigSchema.parse({ gateway: { auth }, mcp: { servers: {
    docs: { url: `${origin}/mcp` }, local: { url: `${origin}/mcp` }, cancelled: { url: `${origin}/mcp` },
    public: { url: `${origin}/public` }, token: { url: `${origin}/token` },
  } } });
  const service = { currentConfig: config, getResolvedAuth: () => auth, getEffectiveListenPort: () => 18790,
    isGatewayReady: () => true, getHealth: () => ({ status: 'healthy' }),
  } as unknown as GatewayService;
  const app = createHonoApp({ service });
  const gateway = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  const pending: string[] = [];
  let base = '';
  async function request(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { response, data: await response.json() };
  }
  async function waitFor(id: string, predicate: (result: McpAuthorization) => boolean) {
    let result: McpAuthorization | undefined;
    for (let i = 0; i < 80; i++) {
      result = (await request(`/auth/${id}`)).data.payload;
      if (!result || result.state === 'error' || predicate(result)) return result!;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Authorization did not progress: ${JSON.stringify(result)}`);
  }
  try {
    if (!gateway.listening) await once(gateway, 'listening');
    const bound = gateway.address(); if (!bound || typeof bound === 'string') throw new Error('Expected Gateway listener');
    base = `http://127.0.0.1:${bound.port}/api/mcp`;
    expect((await fetch(`${base}/servers/docs/probe`, { method: 'POST' })).status).toBe(401);
    expect((await fetch(`${base}/servers/docs/auth`, { method: 'POST' })).status).toBe(401);
    expect((await request('/servers/public/probe', 'POST')).data.payload).toEqual({ state: 'connected', toolCount: 1 });
    expect((await request('/servers/docs/probe', 'POST')).data.payload).toEqual({ state: 'oauth_required' });
    // A generic 401 must not be classified as OAuth merely because the origin has metadata.
    expect((await request('/servers/token/probe', 'POST')).data.payload).toEqual({ state: 'token_required' });
    const started = await request('/servers/docs/auth', 'POST');
    expect(started.response.status).toBe(200);
    const id = started.data.payload.id; pending.push(id);
    const attempt = await waitFor(id, result => Boolean(result.authorizationUrl && result.acceptsRedirect));
    expect(attempt.state, JSON.stringify(attempt)).toBe('authorizing');
    expect(getMcpAuthorization(id, 'different-owner', config)).toBeUndefined();
    const authorization = new URL(attempt.authorizationUrl!);
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    const callback = new URL(authorization.searchParams.get('redirect_uri')!);
    callback.searchParams.set('code', 'fixture-code'); callback.searchParams.set('state', 'wrong-state');
    expect((await request(`/auth/${id}/redirect`, 'POST', { url: callback.href })).response.status).toBe(400);
    expect(tokenRequests).toHaveLength(0);
    callback.searchParams.set('state', authorization.searchParams.get('state')!);
    expect((await request(`/auth/${id}/redirect`, 'POST', { url: callback.href })).response.status).toBe(200);
    const connected = await waitFor(id, result => result.state === 'connected');
    expect(connected, JSON.stringify(connected)).toMatchObject({ state: 'connected', toolCount: 1 });
    expect(tokenRequests[0].get('code_verifier')).toBeTruthy();
    expect(JSON.parse(await readFile(join(root, 'mcp-auth.json'), 'utf8'))).toBeTruthy();
    expect((await request('/servers/docs/probe', 'POST')).data.payload.state).toBe('connected');

    const local = (await request('/servers/local/auth', 'POST')).data.payload.id; pending.push(local);
    const localAttempt = await waitFor(local, result => Boolean(result.authorizationUrl));
    expect(localAttempt.state, JSON.stringify(localAttempt)).toBe('authorizing');
    const localUrl = new URL(localAttempt.authorizationUrl!);
    const localCallback = new URL(localUrl.searchParams.get('redirect_uri')!);
    localCallback.searchParams.set('code', 'local-code'); localCallback.searchParams.set('state', localUrl.searchParams.get('state')!);
    expect((await fetch(localCallback)).status).toBe(200);
    expect(await waitFor(local, result => result.state === 'connected')).toMatchObject({ state: 'connected', toolCount: 1 });
    config.mcp!.servers!.local!.url = `${origin}/public`;
    expect((await request(`/auth/${local}`)).data.payload.state).toBe('cancelled');

    const cancelled = (await request('/servers/cancelled/auth', 'POST')).data.payload.id; pending.push(cancelled);
    expect((await waitFor(cancelled, result => Boolean(result.authorizationUrl))).state).toBe('authorizing');
    expect((await request(`/auth/${cancelled}`, 'DELETE')).response.status).toBe(200);
    expect((await request(`/auth/${cancelled}`)).data.payload.state).toBe('cancelled');
    expect(tokenRequests).toHaveLength(2);
    expect(calls).not.toContain('tools/call');
  } finally {
    for (const id of pending) await request(`/auth/${id}`, 'DELETE').catch(() => {});
    await new Promise<void>(resolve => gateway.close(() => resolve()));
    await new Promise<void>(resolve => mcp.close(() => resolve()));
    closeXopcDatabase(); buckets.resetAllForTests(); vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
