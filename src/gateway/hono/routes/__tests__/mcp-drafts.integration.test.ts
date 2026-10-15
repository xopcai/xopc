import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { createNativeMcpCredentials } from '../../../../agent/mcp/credential-store.js';
import type { McpAuthorization } from '../../../../agent/mcp/connection-setup.js';
import { seedTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../../../../storage/sqlite/connection.js';
import { buckets } from '../../../rate-limit/index.js';
import type { GatewayService } from '../../../service.js';
import { createHonoApp } from '../../app.js';

it('isolates MCP drafts and OAuth until an explicit version-checked commit through the authenticated Gateway', async () => {
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
      json({ access_token: 'new-fixture-token', token_type: 'Bearer', refresh_token: 'fixture-refresh', expires_in: 3600, scope: 'read' }); return;
    }
    if (req.method !== 'POST') { res.writeHead(req.method === 'DELETE' ? 200 : 405).end(); return; }
    if (req.url !== '/public' && !['Bearer fixture-token', 'Bearer new-fixture-token'].includes(String(req.headers.authorization))) {
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
  let saveFails = false;
  const configPath = join(root, 'fixture-config.json');
  await writeFile(configPath, JSON.stringify(config));
  const service = { currentConfig: config,
    async saveConfig(next: typeof config) {
      if (saveFails) return { saved: false };
      await new Promise(resolve => setTimeout(resolve, 10));
      await writeFile(configPath, JSON.stringify(next)); this.currentConfig = next; return { saved: true };
    }, getResolvedAuth: () => auth, getEffectiveListenPort: () => 18790,
    isGatewayReady: () => true, getHealth: () => ({ status: 'healthy' }),
  } as unknown as GatewayService;
  const app = createHonoApp({ service });
  const gateway = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  let base = '';
  async function request(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { response, data: await response.json() };
  }
  async function waitFor(id: string, predicate: (result: McpAuthorization) => boolean) {
    let result: McpAuthorization | undefined;
    for (let i = 0; i < 80; i++) {
      result = (await request(`/drafts/${id}/auth`)).data.payload;
      if (!result || result.state === 'error' || predicate(result)) return result!;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Authorization did not progress: ${JSON.stringify(result)}`);
  }
  const draftIds: string[] = [];
  async function createDraft(serverId: string, server: unknown, edit = false) {
    const result = await request('/drafts', 'POST', { serverId, server, ...(edit ? { sourceServerId: serverId, expectedServer: service.currentConfig.mcp?.servers?.[serverId] } : {}) });
    expect(result.response.status).toBe(200); draftIds.push(result.data.payload.id); return result.data.payload.id as string;
  }
  try {
    if (!gateway.listening) await once(gateway, 'listening');
    const bound = gateway.address(); if (!bound || typeof bound === 'string') throw new Error('Expected Gateway listener');
    base = `http://127.0.0.1:${bound.port}/api/mcp`;
    expect((await fetch(`${base}/drafts`, { method: 'POST' })).status).toBe(401);
    const original = await readFile(configPath, 'utf8');
    const bad = await createDraft('docs', { url: `${origin}/token` }, true);
    expect((await request(`/drafts/${bad}/probe`, 'POST')).data.payload.state).toBe('token_required');
    expect((await request(`/drafts/${bad}/commit`, 'POST', {})).response.status).toBe(409);
    expect(await readFile(configPath, 'utf8')).toBe(original); expect(service.currentConfig).toBe(config);
    await request(`/drafts/${bad}`, 'DELETE');

    const native = await createNativeMcpCredentials();
    await native.forServer('docs', `${origin}/mcp`).save({ serverUrl: `${origin}/mcp`, tokens: { access_token: 'fixture-token', token_type: 'Bearer' } });
    const credentialsBefore = await readFile(join(root, 'mcp-auth.json'), 'utf8');
    const oauth = await createDraft('docs', { url: `${origin}/mcp` }, true);
    // Even a valid live OAuth token must not be consumed or refreshed by an isolated draft.
    expect((await request(`/drafts/${oauth}/probe`, 'POST')).data.payload.state).toBe('oauth_required');
    expect((await request(`/drafts/${oauth}/auth`, 'POST')).response.status).toBe(200);
    const attempt = await waitFor(oauth, result => Boolean(result.authorizationUrl && result.acceptsRedirect));
    const authorization = new URL(attempt.authorizationUrl!);
    const redirect = new URL(authorization.searchParams.get('redirect_uri')!);
    redirect.searchParams.set('code', 'draft-code'); redirect.searchParams.set('state', authorization.searchParams.get('state')!);
    expect((await request(`/drafts/${oauth}/auth/redirect`, 'POST', { url: redirect.href })).response.status).toBe(200);
    expect((await waitFor(oauth, result => result.state === 'connected')).state).toBe('connected');
    expect((await request(`/drafts/${oauth}/tools`)).data.payload.tools[0].name).toContain('lookup');
    expect(await readFile(configPath, 'utf8')).toBe(original);
    expect(await readFile(join(root, 'mcp-auth.json'), 'utf8')).toBe(credentialsBefore);
    saveFails = true;
    expect((await request(`/drafts/${oauth}/commit`, 'POST', {})).response.status).toBe(500);
    expect(await readFile(configPath, 'utf8')).toBe(original);
    expect(JSON.parse(await readFile(join(root, 'mcp-auth.json'), 'utf8'))).toEqual(JSON.parse(credentialsBefore));
    saveFails = false;
    service.currentConfig.mcp!.servers!.unrelatedAdded = { command: 'node' };
    expect((await request(`/drafts/${oauth}/commit`, 'POST', {})).response.status).toBe(200);
    expect(service.currentConfig.mcp?.servers?.unrelatedAdded).toEqual({ command: 'node' });
    expect(service.currentConfig.mcp?.servers?.docs.xopcOAuthCredentialId).toMatch(/^mcp_draft_/);
    expect(native.tokens('docs', `${origin}/mcp`)?.access_token).toBe('fixture-token');
    expect((await request('/servers/docs/tools', 'POST')).data.payload.tools[0].name).toContain('lookup');
    expect((await request('/servers')).data.payload.servers.find((item: { id: string }) => item.id === 'docs').lastCheck.toolCount).toBe(1);

    const stale = await createDraft('docs', { url: `${origin}/public` }, true);
    await request(`/drafts/${stale}/probe`, 'POST');
    const active = service.currentConfig.mcp!.servers!.docs;
    service.currentConfig.mcp!.servers!.docs = { ...active, description: 'changed in another editor' };
    expect((await request(`/drafts/${stale}/commit`, 'POST', {})).response.status).toBe(409);
    expect(service.currentConfig.mcp!.servers!.docs.description).toBe('changed in another editor');
    expect((await request('/servers')).data.payload.servers.find((item: { id: string }) => item.id === 'docs').lastCheck).toBeUndefined();

    const cancelled = await createDraft('draft-cancel', { url: `${origin}/mcp` });
    await request(`/drafts/${cancelled}/auth`, 'POST');
    await waitFor(cancelled, result => Boolean(result.authorizationUrl));
    await request(`/drafts/${cancelled}`, 'DELETE');
    expect((await request(`/drafts/${cancelled}/commit`, 'POST', {})).response.status).toBe(404);
    expect((await request(`/drafts/${cancelled}/auth/redirect`, 'POST', { url: redirect.href })).response.status).toBe(404);

    const first = await createDraft('new-one', { url: `${origin}/public` });
    const second = await createDraft('new-two', { url: `${origin}/public` });
    await Promise.all([request(`/drafts/${first}/probe`, 'POST'), request(`/drafts/${second}/probe`, 'POST')]);
    const committed = await Promise.all([request(`/drafts/${first}/commit`, 'POST', {}), request(`/drafts/${second}/commit`, 'POST', {})]);
    expect(committed.map(result => result.response.status)).toEqual([200, 200]);
    expect(service.currentConfig.mcp!.servers!['new-one']).toBeTruthy(); expect(service.currentConfig.mcp!.servers!['new-two']).toBeTruthy();
    expect(JSON.parse(await readFile(configPath, 'utf8')).mcp.servers['new-two']).toBeTruthy();
    const expectedOne = structuredClone(service.currentConfig.mcp!.servers!['new-one']);
    service.currentConfig.mcp!.servers!['another-added'] = { command: 'node' };
    expect((await request('/servers/new-one', 'DELETE', { expectedServer: expectedOne })).response.status).toBe(200);
    expect(service.currentConfig.mcp!.servers!['new-one']).toBeUndefined();
    expect(service.currentConfig.mcp!.servers!['new-two']).toBeTruthy();
    expect(service.currentConfig.mcp!.servers!['another-added']).toBeTruthy();
    expect((await request('/servers/new-two', 'DELETE', { expectedServer: { command: 'stale' } })).response.status).toBe(409);
    expect(service.currentConfig.mcp!.servers!['new-two']).toBeTruthy();

  } finally {
    for (const id of draftIds) await request(`/drafts/${id}`, 'DELETE').catch(() => {});
    await new Promise<void>(resolve => gateway.close(() => resolve()));
    mcp.closeAllConnections(); await new Promise<void>(resolve => mcp.close(() => resolve()));
    closeXopcDatabase(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true });
  }
});
