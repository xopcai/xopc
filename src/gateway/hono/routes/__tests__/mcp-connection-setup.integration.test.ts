import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { createAgentSession, createMcpExtension, createToolSearchExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, InMemoryCredentialStore, InMemoryModelsStore, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
import type { NativeMcpConfig } from '../../../../agent/mcp/native-mcp.js';

import { expect, it, vi } from 'vitest';

import type { McpAuthorization } from '../../../../agent/mcp/connection-setup.js';
import { createNativeMcpCredentials } from '../../../../agent/mcp/credential-store.js';
import { AgentPluginStore } from '../../../../extensions/agent-plugins/store.js';
import { SkillManager } from '../../../../agent/skills/skill-manager.js';
import { prepareNativeMcpConfig } from '../../../../agent/mcp/native-mcp.js';
import { getMcpAuthorization } from '../../../../agent/mcp/connection-setup.js';
import { seedTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../../../../storage/sqlite/connection.js';
import { buckets } from '../../../rate-limit/index.js';
import type { GatewayService } from '../../../service.js';
import { createHonoApp } from '../../app.js';

async function invokePreparedTool(config: NativeMcpConfig, root: string, serverName: string) {
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager,
    noExtensions: true, noSkills: true, noContextFiles: true,
    extensionFactories: [createToolSearchExtension(), createMcpExtension({ loadConfig: () => ({ ...config, autoEnableCodemode: false }), credentials: config.credentials })],
  });
  await resourceLoader.reload();
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false });
  await modelRuntime.setRuntimeApiKey('openai', 'fixture');
  const model: Model<'openai-completions'> = { id: 'fixture', name: 'Fixture', provider: 'openai', api: 'openai-completions', baseUrl: 'https://example.invalid', reasoning: false, input: ['text'], contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const { session } = await createAgentSession({ cwd: root, agentDir: root, model, modelRuntime, resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(), noTools: 'builtin' });
  try {
    await session.bindExtensions({}); await session.prompt('/mcp');
    const tool = session.getAllTools().find(tool => tool.namespace?.name === `mcp__${serverName.replace(/-/g, '_')}`);
    expect(tool, `No tools discovered for ${serverName}`).toBeDefined();
    const name = tool!.name;
    session.setActiveToolsByName([name]);
    let round = 0;
    session.agent.streamFunction = () => {
      const first = round++ === 0;
      const message: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content: first ? [{ type: 'toolCall', id: 'fixture-call', name, arguments: {} }] : [{ type: 'text', text: 'Done' }],
        stopReason: first ? 'toolUse' : 'stop', timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { ...model.cost, total: 0 } } };
      const stream = createAssistantMessageEventStream(); stream.push({ type: 'done', reason: first ? 'toolUse' : 'stop', message }); return stream;
    };
    await session.prompt('Read the fixture note');
    expect(JSON.stringify(session.messages.findLast(message => message.role === 'toolResult'))).toContain('fixture note');
  } finally {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); session.dispose();
  }
}

const resourceTool = String.raw`#!/usr/bin/env node
let pending = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  pending += chunk;
  let end;
  while ((end = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, end); pending = pending.slice(end + 1);
    if (!line.trim()) continue;
    const q = JSON.parse(line); if (q.id === undefined) continue;
    const result = q.method === 'initialize' ? { protocolVersion: '2025-03-26', serverInfo: { name: 'resource-tool', version: '1' }, capabilities: { tools: {} } }
      : q.method === 'tools/list' ? { tools: [{ name: 'lookup', description: 'Read fixture', inputSchema: { type: 'object' } }] }
      : { content: [{ type: 'text', text: 'fixture note' }] };
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }) + '\n');
  }
});
`;

it('detects authentication and completes native OAuth through authenticated Gateway including remote callbacks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-mcp-setup-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', root);
  vi.stubEnv('XOPC_STATE_DIR', root);
  openXopcDatabase({ path: ':memory:' });
  seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, workspace: root }] });
  buckets.resetAllForTests();
  let origin = '';
  const tokenRequests: URLSearchParams[] = [];
  const calls: string[] = [];
  const mcp = createServer(async (req, res) => {
    const json = (value: unknown, status = 200) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    if (req.url === '/binary') { res.end(resourceTool); return; }
    if (req.url === '/resource') { res.end('resource fixture'); return; }
    if (req.url?.startsWith('/.well-known/oauth-protected-resource')) {
      if (req.url.endsWith('/token')) { json({}); return; }
      json({ resource: `${origin}/${req.url.split('/').pop()?.startsWith('plugin-') ? req.url.split('/').pop() : 'mcp'}`, authorization_servers: [origin], scopes_supported: ['read'] }); return;
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
      res.writeHead(401, req.url === '/mcp' || req.url?.startsWith('/plugin-') ? { 'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource${req.url}"` } : {}).end(); return;
    }
    const q = JSON.parse(body); calls.push(q.method);
    if (q.id === undefined) { res.writeHead(202).end(); return; }
    const result = q.method === 'initialize'
      ? { protocolVersion: '2025-03-26', serverInfo: { name: 'fixture', version: '1' }, capabilities: { tools: {} } }
      : q.method === 'tools/list' ? { tools: [{ name: 'lookup', description: 'Read a note', inputSchema: { type: 'object' } }] } : q.method === 'tools/call' ? { content: [{ type: 'text', text: 'fixture note' }] } : {};
    json({ jsonrpc: '2.0', id: q.id, result });
  });
  mcp.listen(0, '127.0.0.1'); await once(mcp, 'listening');
  const address = mcp.address(); if (!address || typeof address === 'string') throw new Error('Expected MCP listener');
  origin = `http://127.0.0.1:${address.port}`;
  const auth = { mode: 'token' as const, token: 'setup-gateway-token' };
  const config = ConfigSchema.parse({ gateway: { auth }, mcp: { servers: {
    docs: { url: `${origin}/mcp`, xopcOAuthCredentialId: `mcp_draft_${'a'.repeat(32)}` }, local: { url: `${origin}/mcp` }, cancelled: { url: `${origin}/mcp` },
    public: { url: `${origin}/public` }, token: { url: `${origin}/token` },
  } } });
  const service = { currentConfig: config, getResolvedAuth: () => auth, getEffectiveListenPort: () => 18790,
    marketplace: { reloadSkills() {} }, getExtensionLoader: () => null,
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
    expect((await request('/servers/docs/probe', 'POST')).data.payload).toMatchObject({ state: 'oauth_required', auth: { method: 'oauth', metadata: 'valid' } });
    // A generic 401 must not be classified as OAuth merely because the origin has metadata.
    expect((await request('/servers/token/probe', 'POST')).data.payload).toMatchObject({ state: 'auth_unknown', auth: { method: 'unknown' } });
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
    const declined = (await request('/servers/cancelled/auth', 'POST')).data.payload.id; pending.push(declined);
    const declinedAttempt = await waitFor(declined, result => Boolean(result.authorizationUrl) && result.acceptsRedirect === true);
    const declinedLogin = new URL(declinedAttempt.authorizationUrl!);
    const declinedCallback = new URL(declinedLogin.searchParams.get('redirect_uri')!);
    declinedCallback.searchParams.set('error', 'access_denied'); declinedCallback.searchParams.set('state', 'wrong-state');
    expect((await request(`/auth/${declined}/redirect`, 'POST', { url: declinedCallback.href })).response.status).toBe(400);
    declinedCallback.searchParams.set('state', declinedLogin.searchParams.get('state')!);
    expect((await request(`/auth/${declined}/redirect`, 'POST', { url: declinedCallback.href })).response.status).toBe(200);
    expect((await request(`/auth/${declined}`)).data.payload).toMatchObject({ state: 'error', acceptsRedirect: false });
    expect(tokenRequests).toHaveLength(2);
    expect(calls).not.toContain('tools/call');
    // Exercise plugin installation, resource preparation, native OAuth and agent isolation over real HTTP.
    const pluginRequest = async (path: string, method = 'GET', body?: unknown): Promise<any> => {
      const response = await fetch(`${base.replace('/api/mcp', '')}${path}`, { method, headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json(); expect(response.status, JSON.stringify(result)).toBe(200);
      if (method === 'POST' && (body as { action?: string } | undefined)?.action === 'prepare') {
        expect(result.payload.state).toBe('running');
        for (let i = 0; i < 100; i++) {
          const job = await pluginRequest(path);
          if (job.state !== 'running') return job;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Plugin setup did not finish');
      }
      return result.payload;
    };
    for (const dialect of ['codex', 'claude']) {
      const source = join(root, `source-${dialect}`);
      await mkdir(join(source, `.${dialect}-plugin`), { recursive: true });
      await mkdir(join(source, 'skills/lookup'), { recursive: true });
      await writeFile(join(source, `.${dialect}-plugin/plugin.json`), JSON.stringify({ name: `plugin-${dialect}` }));
      await writeFile(join(source, 'skills/lookup/SKILL.md'), '---\nname: lookup\ndescription: Look up a fixture note\n---\nLook up a note.');
      await writeFile(join(source, '.mcp.json'), JSON.stringify({ mcpServers: { notes: { type: 'http', url: `${origin}/plugin-${dialect}` } } }));
      const plan = await pluginRequest('/api/extensions/inspect', 'POST', { source });
      expect(plan.layout.dialect).toBe(dialect);
      const installed = await pluginRequest('/api/extensions/install', 'POST', { source, reviewHash: plan.reviewHash, setup: true });
      const pluginPath = `/api/extensions/agent-plugins/${installed.pluginId}`;
      let job = await pluginRequest(`${pluginPath}/setup`);
      job = await pluginRequest(`${pluginPath}/setup`, 'POST', { action: 'prepare', expectedRevision: job.revision });
      expect(job.connections[0].state).toBe('oauth_required');
      const runtimeBefore = await prepareNativeMcpConfig(config, root, 'main');
      expect(runtimeBefore.servers.some(server => server.name.startsWith('plugin_'))).toBe(dialect === 'claude');
      job = await pluginRequest(`${pluginPath}/setup`, 'POST', { action: 'authorize', server: 'notes', expectedRevision: job.revision });
      let pluginAuth: McpAuthorization | undefined;
      for (let i = 0; i < 80; i++) {
        pluginAuth = await pluginRequest(`${pluginPath}/setup/auth/notes`);
        if (pluginAuth?.authorizationUrl && pluginAuth.acceptsRedirect) break;
        if (pluginAuth?.state === 'error') throw new Error(JSON.stringify(pluginAuth));
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(pluginAuth?.state).toBe('authorizing'); pending.push(pluginAuth!.id);
      const login = new URL(pluginAuth!.authorizationUrl!);
      const redirect = new URL(login.searchParams.get('redirect_uri')!);
      redirect.searchParams.set('code', `plugin-${dialect}-code`); redirect.searchParams.set('state', login.searchParams.get('state')!);
      await pluginRequest(`${pluginPath}/setup/auth/notes/redirect`, 'POST', { url: redirect.href });
      expect(await waitFor(pluginAuth!.id, result => result.state === 'connected')).toMatchObject({ state: 'connected', toolCount: 1 });
      job = await pluginRequest(`${pluginPath}/setup`, 'POST', { action: 'prepare', expectedRevision: job.revision });
      expect(job.connections[0]).toMatchObject({ state: 'connected', toolCount: 1 });
      job = await pluginRequest(`${pluginPath}/setup`, 'POST', { action: 'complete', expectedRevision: job.revision });
      expect(job.state).toBe('completed');
      const runtime = await prepareNativeMcpConfig(config, root, 'main');
      expect(runtime.servers.some(server => server.name.startsWith(`plugin_plugin_${dialect}_`))).toBe(true);
      await invokePreparedTool(runtime, root, runtime.servers.find(server => server.name.startsWith(`plugin_plugin_${dialect}_`))!.name);
      const otherAgent = await prepareNativeMcpConfig(config, root, 'other');
      expect(otherAgent.servers.some(server => server.name.startsWith('plugin_'))).toBe(true);
      const allowedSkills = new SkillManager(root, join(root, 'no-bundled-skills'), { agentId: 'main' });
      expect(allowedSkills.getSkills().some(skill => skill.name === `${installed.pluginId}.lookup`)).toBe(true);
      expect(new SkillManager(root, join(root, 'no-bundled-skills'), { agentId: 'other' }).getSkills().some(skill => skill.name === `${installed.pluginId}.lookup`)).toBe(true);
      expect(new AgentPluginStore().active('other').some(plugin => plugin.id === installed.pluginId)).toBe(true);
      if (dialect === 'claude') {
        const sharedSource = join(root, 'source-shared'); await mkdir(join(sharedSource, '.claude-plugin'), { recursive: true });
        await writeFile(join(sharedSource, '.claude-plugin/plugin.json'), '{"name":"shared-connection"}');
        await writeFile(join(sharedSource, '.mcp.json'), JSON.stringify({ mcpServers: { shared: { type: 'http', url: `${origin}/mcp` } } }));
        const sharedPlan = await pluginRequest('/api/extensions/inspect', 'POST', { source: sharedSource });
        const shared = await pluginRequest('/api/extensions/install', 'POST', { source: sharedSource, reviewHash: sharedPlan.reviewHash, setup: true });
        const sharedPath = `/api/extensions/agent-plugins/${shared.pluginId}`;
        let sharedJob = await pluginRequest(`${sharedPath}/setup`);
        sharedJob = await pluginRequest(`${sharedPath}/setup`, 'POST', { action: 'prepare', expectedRevision: sharedJob.revision });
        const candidates = await pluginRequest(`${sharedPath}/setup/reusable`);
        expect(candidates.shared).toContainEqual({ id: 'docs', name: 'docs' });
        const logins = tokenRequests.length;
        sharedJob = await pluginRequest(`${sharedPath}/setup`, 'POST', { action: 'reuse', server: 'shared', sourceServerId: 'docs', expectedRevision: sharedJob.revision });
        sharedJob = await pluginRequest(`${sharedPath}/setup`, 'POST', { action: 'prepare', expectedRevision: sharedJob.revision });
        expect(sharedJob.connections[0].state).toBe('connected'); expect(tokenRequests).toHaveLength(logins);
        await pluginRequest(`${sharedPath}/setup`, 'POST', { action: 'complete', expectedRevision: sharedJob.revision });
        const beforeChange = await prepareNativeMcpConfig(config, root, 'main');
        expect(beforeChange.credentialAliases).toHaveProperty(shared.components.mcp[0].id, config.mcp!.servers!.docs.xopcOAuthCredentialId);
        const original = config.mcp!.servers!.docs.url; config.mcp!.servers!.docs.url = `${origin}/changed`;
        const afterChange = await prepareNativeMcpConfig(config, root, 'main');
        expect(afterChange.errors.some(error => error.includes('Shared MCP connection changed'))).toBe(true);
        expect(afterChange.servers.some(server => server.name === shared.components.mcp[0].id)).toBe(false);
        config.mcp!.servers!.docs.url = original;
        await pluginRequest(sharedPath, 'DELETE', { removeCredentials: true });
        expect(await (await createNativeMcpCredentials()).tokens(config.mcp!.servers!.docs.xopcOAuthCredentialId!, `${origin}/mcp`)).toBeTruthy();
        expect((await request('/servers/docs/probe', 'POST')).data.payload.state).toBe('connected');
      }

    }
    if (['darwin', 'linux'].includes(process.platform)) {
      const binarySource = join(root, 'source-binary'); await mkdir(join(binarySource, '.codex-plugin'), { recursive: true });
      await writeFile(join(binarySource, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'downloaded-tool', extensions: { 'ai.xopc': { setup: { resources: [{ id: 'tool', url: `${origin}/binary`, sha256: createHash('sha256').update(resourceTool).digest('hex'), executable: true }] } } } }));
      await writeFile(join(binarySource, '.mcp.json'), JSON.stringify({ mcpServers: { resource: { command: '${PLUGIN_RESOURCES}/tool' } } }));
      const binaryPlan = await pluginRequest('/api/extensions/inspect', 'POST', { source: binarySource });
      expect(binaryPlan.capabilities.some((capability: string) => capability.startsWith('runtime.resource:'))).toBe(true);
      const binary = await pluginRequest('/api/extensions/install', 'POST', { source: binarySource, reviewHash: binaryPlan.reviewHash, setup: true });
      const binaryPath = `/api/extensions/agent-plugins/${binary.pluginId}`;
      let binaryJob = await pluginRequest(`${binaryPath}/setup`);
      binaryJob = await pluginRequest(`${binaryPath}/setup`, 'POST', { action: 'prepare', expectedRevision: binaryJob.revision });
      expect(binaryJob.connections[0]).toMatchObject({ state: 'connected', toolCount: 1 });
      await pluginRequest(`${binaryPath}/setup`, 'POST', { action: 'complete', expectedRevision: binaryJob.revision, workspacePaths: [root] });
      const prepared = await prepareNativeMcpConfig(config, root, 'main');
      expect(prepared.servers.map(server => server.name)).toContain(binary.components.mcp[0].id);
      await invokePreparedTool(prepared, root, binary.components.mcp[0].id);
      expect((await prepareNativeMcpConfig(config, join(root, 'different-workspace'), 'main')).servers.some(server => server.name === binary.components.mcp[0].id)).toBe(false);
    }

  } finally {
    for (const id of pending) await request(`/auth/${id}`, 'DELETE').catch(() => {});
    await new Promise<void>(resolve => gateway.close(() => resolve()));
    await new Promise<void>(resolve => mcp.close(() => resolve()));
    closeXopcDatabase(); buckets.resetAllForTests(); vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
