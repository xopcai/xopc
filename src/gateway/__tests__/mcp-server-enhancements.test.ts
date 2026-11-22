import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CancelTaskResultSchema, GetTaskResultSchema, ListTasksResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ObjectLinkService } from '../../activity/service.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { bootstrapApplicationStateSync } from '../../bootstrap/application-state.js';
import { ConfigSchema } from '../../config/schema.js';
import { fileResourceId } from '../../files/file-service.js';
import { writeKnowledgeItem } from '../../knowledge-memory/index.js';
import { createMcpConnection, listMcpConnections, MCP_BRIDGE_PATH } from '../../mcp/connection-grants.js';
import { MCP_TOOLSETS, resolveMcpToolsetCapabilities } from '../../mcp/product-tools.js';
import { grantRemoteMcpConnection } from '../../mcp/remote-grants.js';
import { NotesService } from '../../notes/service.js';
import { NotesStore } from '../../notes/store.js';
import { ProjectService } from '../../projects/project-service.js';
import { createCollaborationRule } from '../../storage/sqlite/collaboration-rule-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { applyUserProfilePatch, createUserGoal } from '../../user-model/index.js';
import { getGatewayFileSpaceService } from '../file-space-service.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

async function serverOrigin(server: ReturnType<typeof serve>): Promise<string> {
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing HTTP listener');
  return `http://127.0.0.1:${address.port}`;
}

async function setupGateway() {
  const directory = mkdtempSync(join(tmpdir(), 'xopc-mcp-enhancements-'));
  const workspace = join(directory, 'workspace');
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'architecture.md'), '# Architecture\nGateway MCP documentation.\n');
  writeFileSync(join(workspace, 'binary.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff]));

  vi.stubEnv('XOPC_STATE_DIR', directory);
  vi.stubEnv('XOPC_WORKSPACE', workspace);
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(directory, 'xopc.db') });
  bootstrapApplicationStateSync();

  const ownerToken = randomUUID();
  let currentConfig = ConfigSchema.parse({ gateway: { auth: { mode: 'token', token: ownerToken } } });
  const notes = new NotesService();
  const projects = new ProjectService();
  const projectA = projects.create({ name: 'Alpha Release', description: 'Main release project' });
  const projectB = projects.create({ name: 'Beta Secret', description: 'Private project' });

  const notesStore = new NotesStore();
  notesStore.addNote({
    id: 'note-alpha',
    title: 'Alpha Plan',
    markdown: 'Alpha project plan details',
    kind: 'thought',
    status: 'inbox',
    capturedVia: { channel: 'web' },
    createdAt: 1,
    updatedAt: 1,
  });
  notesStore.addNote({
    id: 'note-beta',
    title: 'Beta Private',
    markdown: 'Beta secret notes',
    kind: 'thought',
    status: 'inbox',
    capturedVia: { channel: 'web' },
    createdAt: 2,
    updatedAt: 2,
  });
  const objectLinks = new ObjectLinkService();
  objectLinks.create({
    id: `note:note-alpha:project:${projectA.id}`,
    from: { kind: 'note', id: 'note-alpha', title: 'Alpha Plan' },
    to: { kind: 'project', id: projectA.id, title: projectA.name },
    relation: 'belongs_to',
    source: 'user',
  });
  objectLinks.create({
    id: `note:note-beta:project:${projectB.id}`,
    from: { kind: 'note', id: 'note-beta', title: 'Beta Private' },
    to: { kind: 'project', id: projectB.id, title: projectB.name },
    relation: 'belongs_to',
    source: 'user',
  });

  // Seed user context & knowledge memory (including a secret item that must be filtered out)
  applyUserProfilePatch({ callName: 'Alex', role: 'Staff Engineer', timezone: 'Asia/Shanghai' });
  createUserGoal({ title: 'Ship MCP v2', desiredOutcome: 'External AI tools connect seamlessly', status: 'active', scope: { type: 'global' } });
  createCollaborationRule({ category: 'communication', statement: 'Always be concise and structured', priority: 10, scope: { type: 'global' }, conditions: {} });
  writeKnowledgeItem({
    kind: 'decision',
    content: 'Use Streamable HTTP for remote Gateway MCP connections',
    canonicalKey: 'decision:mcp-transport',
    scope: { type: 'global' },
    originClass: 'owner',
    status: 'active',
    sensitivity: 'normal',
    confidence: 0.9,
    importance: 0.8,
  });
  writeKnowledgeItem({
    kind: 'workspace_fact',
    content: 'SUPER_SECRET_PASSWORD_12345',
    canonicalKey: 'secret:password',
    scope: { type: 'global' },
    originClass: 'owner',
    status: 'active',
    sensitivity: 'secret',
    confidence: 0.9,
    importance: 0.8,
  });

  // Enrich default agent metadata
  const catalog = new AgentCatalogRepository();
  const defaultId = catalog.getSettings().defaultAgentId;
  const existingAgent = catalog.get(defaultId);
  if (existingAgent) {
    catalog.update(defaultId, existingAgent.revision, {
      id: existingAgent.id,
      enabled: true,
      purpose: 'specialist',
      profile: {
        name: existingAgent.profile?.name ?? 'Main Assistant',
        description: 'Handles architecture, research, and project execution',
      },
      specialistProfile: {
        version: 1,
        domains: ['architecture', 'typescript'],
        taskTypes: ['design', 'review'],
        inputKinds: ['markdown', 'code'],
        outputKinds: ['spec', 'code'],
        specialties: ['Engineering Lead'],
        examples: [],
        limitations: [],
      },
    });
  }

  const service = {
    get currentConfig() { return currentConfig; },
    set currentConfig(next) { currentConfig = next; },
    saveConfig: vi.fn(async (next: typeof currentConfig) => {
      currentConfig = next;
      return { saved: true, persisted: true, conflict: false };
    }),
    getResolvedAuth: () => ({ mode: 'token', token: ownerToken }),
    getAuthToken: () => ownerToken,
    isGatewayReady: () => true,
    getExtensionLoader: () => null,
    notesServiceInstance: notes,
    projects,
    dispatchTaskEvents: () => {},
    dispatchTaskRuns: () => {},
    stopDelegatedTaskRun: vi.fn(),
    resumeDelegatedRunClarification: vi.fn(),
    deliverDelegatedTaskSteer: vi.fn(async () => {}),
    sessions: { getEffectiveWorkspacePath: async () => workspace },
  } as unknown as GatewayService;

  const app = createHonoApp({ service });
  const gateway = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  const baseUrl = await serverOrigin(gateway);

  const cleanup = async () => {
    await new Promise<void>(resolve => gateway.close(() => resolve()));
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  };

  return { directory, workspace, ownerToken, service, gateway, baseUrl, projectA, projectB, cleanup };
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

describe('Gateway MCP P0-P2 enhancements', () => {
  it('supports built-in OAuth 2.1 + DCR + PKCE S256 + refresh + revoke, plus files, memory, resources, prompts, MCP tasks, and CORS', async () => {
    const env = await setupGateway();
    cleanups.push(env.cleanup);

    const resource = `${env.baseUrl}/mcp`;
    const allowedOrigin = 'https://claude.ai';
    env.service.currentConfig = ConfigSchema.parse({
      ...env.service.currentConfig,
      gateway: {
        ...env.service.currentConfig.gateway,
        mcp: {
          mode: 'builtin',
          resource,
          allowedOrigins: [allowedOrigin],
          rateLimitMax: 200,
          rateLimitWindowMs: 60_000,
        },
      },
    });

    // 1. Discovery documents (both root and /mcp protected-resource + AS metadata) & CORS preflight
    const preflight = await fetch(resource, {
      method: 'OPTIONS',
      headers: { Origin: allowedOrigin, 'Access-Control-Request-Method': 'POST' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(allowedOrigin);
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('MCP-Protocol-Version');
    expect(preflight.headers.get('Access-Control-Expose-Headers')).toContain('WWW-Authenticate');

    const blockedOrigin = await fetch(resource, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
    expect(blockedOrigin.status).toBe(403);

    const rootMeta = await (await fetch(`${env.baseUrl}/.well-known/oauth-protected-resource`)).json() as Record<string, unknown>;
    expect(rootMeta).toMatchObject({ resource, authorization_servers: [env.baseUrl] });

    const asMeta = await (await fetch(`${env.baseUrl}/.well-known/oauth-authorization-server`)).json() as Record<string, unknown>;
    expect(asMeta).toMatchObject({
      issuer: env.baseUrl,
      authorization_endpoint: `${env.baseUrl}/mcp/oauth/authorize`,
      token_endpoint: `${env.baseUrl}/mcp/oauth/token`,
      registration_endpoint: `${env.baseUrl}/mcp/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    });

    // 2. Dynamic Client Registration (RFC 7591)
    const redirectUri = 'http://127.0.0.1:43210/callback';
    const regRes = await fetch(`${env.baseUrl}/mcp/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude Desktop Test', redirect_uris: [redirectUri] }),
    });
    expect(regRes.status).toBe(201);
    const { client_id: clientId } = await regRes.json() as { client_id: string };
    expect(clientId).toMatch(/^xopc_client_/);

    // 3. PKCE S256 Authorization + Consent UI
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authorizeQuery = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: 'mcp.read mcp.write',
      resource,
      state: 'xyz-state',
    });
    const consentPage = await fetch(`${env.baseUrl}/mcp/oauth/authorize?${authorizeQuery.toString()}`);
    expect(consentPage.status).toBe(200);
    expect(await consentPage.text()).toContain('Claude Desktop Test');

    const approveRes = await fetch(`${env.baseUrl}/mcp/oauth/authorize`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        resource,
        scope: 'mcp.read mcp.write',
        state: 'xyz-state',
        toolset: 'full-write',
        owner_secret: env.ownerToken,
        decision: 'approve',
      }),
    });
    expect(approveRes.status).toBe(302);
    const location = new URL(approveRes.headers.get('location')!);
    expect(location.searchParams.get('state')).toBe('xyz-state');
    const code = location.searchParams.get('code')!;
    expect(code.length).toBeGreaterThan(10);

    // 4. Token exchange + Refresh rotation
    const tokenRes = await fetch(`${env.baseUrl}/mcp/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code,
        code_verifier: verifier,
        resource,
      }),
    });
    expect(tokenRes.status).toBe(200);
    const tokenPayload = await tokenRes.json() as { access_token: string; refresh_token: string };
    expect(tokenPayload.access_token).toBeTruthy();
    expect(tokenPayload.refresh_token).toBeTruthy();

    const refreshRes = await fetch(`${env.baseUrl}/mcp/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: tokenPayload.refresh_token,
        resource,
      }),
    });
    expect(refreshRes.status).toBe(200);
    const rotated = await refreshRes.json() as { access_token: string; refresh_token: string };
    expect(rotated.refresh_token).not.toBe(tokenPayload.refresh_token);

    // 5. Connect real MCP Client using built-in OAuth access token
    const client = new Client({ name: 'oauth-e2e-client', version: '1.0' });
    cleanups.push(() => client.close());
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), {
      requestInit: { headers: { Authorization: `Bearer ${rotated.access_token}`, Origin: allowedOrigin } },
    }));

    // Verify server instructions & tool annotations
    expect(client.getInstructions()).toContain('xopc_workspace_search');
    const { tools } = await client.listTools();
    const notesCreate = tools.find(t => t.name === 'xopc_notes_create');
    const notesUpdate = tools.find(t => t.name === 'xopc_notes_update');
    const agentStart = tools.find(t => t.name === 'xopc_agent_runs_start');
    expect(notesCreate?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    expect(notesUpdate?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(agentStart?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });

    // 6. Workspace Files tools (spaces, list, search, get UTF-8 & base64)
    const spacesRes = await client.callTool({ name: 'xopc_files_spaces', arguments: {} });
    const spaces = (spacesRes.structuredContent as { spaces: Array<{ id: string }> }).spaces;
    expect(spaces.length).toBeGreaterThan(0);

    const fileSearch = await client.callTool({ name: 'xopc_files_search', arguments: { query: 'architecture' } });
    const hits = (fileSearch.structuredContent as { hits: Array<{ id: string; spaceId: string; name: string }> }).hits;
    expect(hits.some(h => h.name === 'architecture.md')).toBe(true);
    const archHit = hits.find(h => h.name === 'architecture.md')!;

    const readText = await client.callTool({ name: 'xopc_files_get', arguments: { id: archHit.id } });
    expect(readText.structuredContent).toMatchObject({
      name: 'architecture.md',
      encoding: 'utf8',
      data: expect.stringContaining('Gateway MCP documentation'),
      nextOffset: null,
    });

    const binRead = await client.callTool({
      name: 'xopc_files_get',
      arguments: { id: fileResourceId(archHit.spaceId, 'binary.bin'), encoding: 'base64' },
    });
    expect(binRead.structuredContent).toMatchObject({
      encoding: 'base64',
      data: Buffer.from([0x00, 0x01, 0x02, 0xff]).toString('base64'),
    });

    // 7. User Context & Knowledge Memory (ensuring secret sensitivity is never leaked)
    const profileRes = await client.callTool({ name: 'xopc_user_context_profile', arguments: {} });
    expect(profileRes.structuredContent).toMatchObject({
      profile: { callName: 'Alex', role: 'Staff Engineer' },
      activeGoals: [expect.objectContaining({ title: 'Ship MCP v2' })],
      collaborationRules: [expect.objectContaining({ statement: 'Always be concise and structured' })],
    });

    const knowledgeList = await client.callTool({ name: 'xopc_knowledge_list', arguments: {} });
    const kItems = (knowledgeList.structuredContent as { items: Array<{ content: string }> }).items;
    expect(kItems.some(i => i.content.includes('Streamable HTTP'))).toBe(true);
    expect(kItems.some(i => i.content.includes('SUPER_SECRET_PASSWORD_12345'))).toBe(false);

    // 8. Enriched Agent Directory + Agent Runs List + MCP Tasks protocol extension
    const agentsRes = await client.callTool({ name: 'xopc_agent_runs_agents', arguments: {} });
    const { defaultAgentId, agents: agentList } = agentsRes.structuredContent as {
      defaultAgentId: string;
      agents: Array<{ id: string; description?: string; specialties?: string[] }>;
    };
    const defaultAgent = agentList.find(a => a.id === defaultAgentId);
    expect(defaultAgent).toMatchObject({
      description: expect.stringContaining('architecture'),
      specialties: expect.arrayContaining(['Engineering Lead', 'architecture']),
    });

    const started = await client.callTool({
      name: 'xopc_agent_runs_start',
      arguments: { title: 'Draft spec', prompt: 'Summarize architecture', idempotencyKey: 'task-e2e-1' },
    });
    const runId = (started.structuredContent as { runId: string }).runId;

    const runsList = await client.callTool({ name: 'xopc_agent_runs_list', arguments: {} });
    expect(runsList.structuredContent).toMatchObject({
      items: [expect.objectContaining({ runId, title: 'Draft spec', status: 'queued' })],
    });

    // MCP Tasks protocol extension (tasks/list & tasks/get & tasks/cancel via real MCP client)
    const listedTasks = await client.request({ method: 'tasks/list', params: {} }, ListTasksResultSchema);
    expect(listedTasks.tasks).toEqual([expect.objectContaining({ taskId: runId, status: 'working' })]);

    const gotTask = await client.request({ method: 'tasks/get', params: { taskId: runId } }, GetTaskResultSchema);
    expect(gotTask).toMatchObject({ taskId: runId, status: 'working' });

    const cancelledTask = await client.request({ method: 'tasks/cancel', params: { taskId: runId } }, CancelTaskResultSchema);
    expect(cancelledTask).toMatchObject({ taskId: runId, status: 'cancelled' });

    // 9. MCP Resources & Prompts
    const { resources } = await client.listResources();
    expect(resources.map(r => r.uri)).toEqual(expect.arrayContaining([
      'xopc://workspace/overview', 'xopc://user/context', 'xopc://agents/directory', 'xopc://files/spaces',
    ]));
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map(t => t.uriTemplate)).toEqual(expect.arrayContaining([
      'xopc://projects/{id}', 'xopc://notes/{id}', 'xopc://files/{id}',
    ]));
    const noteResource = await client.readResource({ uri: 'xopc://notes/note-alpha' });
    expect(noteResource.contents[0]).toMatchObject({
      uri: 'xopc://notes/note-alpha',
      mimeType: 'text/markdown',
      text: expect.stringContaining('Alpha project plan details'),
    });

    const { prompts } = await client.listPrompts();
    expect(prompts.map(p => p.name)).toEqual(expect.arrayContaining([
      'xopc_workspace_briefing', 'xopc_delegate_specialist', 'xopc_capture_meeting_notes',
    ]));
    const promptResult = await client.getPrompt({ name: 'xopc_delegate_specialist', arguments: { goal: 'Write release notes' } });
    expect(promptResult.messages[0]?.content).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Write release notes'),
    });

    // 10. Revoke via RFC 7009 -> immediate denial
    const revokeRes = await fetch(`${env.baseUrl}/mcp/oauth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: rotated.refresh_token }),
    });
    expect(revokeRes.status).toBe(200);
    const afterRevoke = await fetch(resource, {
      method: 'POST',
      headers: { Authorization: `Bearer ${rotated.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    expect(afterRevoke.status).toBe(403);
  }, 20_000);

  it('enforces project-scoped isolation, maxConcurrentRuns guardrail, flexible external JWT claims, rate limits, and admin REST API', async () => {
    const env = await setupGateway();
    cleanups.push(env.cleanup);

    // Local project-scoped grant for Project A only + maxConcurrentRuns: 1
    const toolsetCaps = resolveMcpToolsetCapabilities('full-write')!;
    const localConn = createMcpConnection(toolsetCaps, {
      name: 'Cursor Alpha Only',
      toolset: 'full-write',
      projectIds: [env.projectA.id],
      maxConcurrentRuns: 1,
    });
    expect(listMcpConnections().find(c => c.connectionId === localConn.connectionId)).toMatchObject({
      name: 'Cursor Alpha Only',
      projectIds: [env.projectA.id],
      maxConcurrentRuns: 1,
      expired: false,
    });

    const bridge = `${env.baseUrl}${MCP_BRIDGE_PATH}`;
    const bridgeHeaders = { Authorization: `Bearer ${localConn.token}`, 'Content-Type': 'application/json' };
    const { capabilities } = await (await fetch(bridge, { headers: bridgeHeaders })).json() as {
      capabilities: Array<{ id: string; majorVersion: number; descriptorDigest: string }>;
    };
    const invokeBridge = (id: string, input: Record<string, unknown>, idempotencyKey?: string) => {
      const desc = capabilities.find(c => c.id === id)!;
      return fetch(bridge, {
        method: 'POST',
        headers: bridgeHeaders,
        body: JSON.stringify({
          capability: id,
          majorVersion: desc.majorVersion,
          descriptorDigest: desc.descriptorDigest,
          input,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        }),
      });
    };

    // Reading Project A works; reading Project B or Note Beta is FORBIDDEN
    expect((await invokeBridge('xopc.projects.get', { id: env.projectA.id })).status).toBe(200);
    expect((await invokeBridge('xopc.projects.get', { id: env.projectB.id })).status).toBe(403);
    expect((await invokeBridge('xopc.notes.get', { id: 'note-alpha' })).status).toBe(200);
    expect((await invokeBridge('xopc.notes.get', { id: 'note-beta' })).status).toBe(403);

    // Listing projects filters out Project B
    const projList = await (await invokeBridge('xopc.projects.list', {})).json() as { data: { items: Array<{ id: string }> } };
    expect(projList.data.items.map(p => p.id)).toEqual([env.projectA.id]);

    // Concurrency guardrail: 1st run succeeds, 2nd run rejected with 503 UNAVAILABLE
    expect((await invokeBridge('xopc.agent_runs.start', {
      title: 'Run 1', prompt: 'Do work', projectId: env.projectA.id,
    }, 'conc-1')).status).toBe(200);
    const secondRun = await invokeBridge('xopc.agent_runs.start', {
      title: 'Run 2', prompt: 'Too many', projectId: env.projectA.id,
    }, 'conc-2');
    expect(secondRun.status).toBe(503);
    expect(await secondRun.json()).toMatchObject({ code: 'UNAVAILABLE' });

    // Local bridge protocol actions (resources/list + prompts/list)
    const bridgeResources = await (await fetch(bridge, {
      method: 'POST',
      headers: bridgeHeaders,
      body: JSON.stringify({ bridgeAction: 'resources/list' }),
    })).json() as { data: { resources: Array<{ uri: string }> } };
    expect(bridgeResources.data.resources.some(r => r.uri === 'xopc://workspace/overview')).toBe(true);

    // Flexible external OAuth: accept typ: 'JWT', azp claim, requireJti: false, and enforce rate limit
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...await exportJWK(publicKey), kid: 'ext-1', alg: 'RS256', use: 'sig' };
    const jwksServer = serve({ fetch: () => Response.json({ keys: [jwk] }), hostname: '127.0.0.1', port: 0 });
    cleanups.push(() => new Promise<void>(resolve => jwksServer.close(() => resolve())));
    const issuer = await serverOrigin(jwksServer);
    const resource = `${env.baseUrl}/mcp`;
    env.service.currentConfig = ConfigSchema.parse({
      ...env.service.currentConfig,
      gateway: {
        ...env.service.currentConfig.gateway,
        mcp: {
          mode: 'external',
          resource,
          issuer,
          jwksUrl: `${issuer}/jwks`,
          acceptedTokenTypes: ['at+jwt', 'JWT'],
          clientIdClaims: ['client_id', 'azp'],
          requireJti: false,
          rateLimitMax: 2,
          rateLimitWindowMs: 60_000,
        },
      },
    });
    grantRemoteMcpConnection(
      { resource, issuer, subject: 'idp-user-1', clientId: 'azp-client' },
      { capabilityIds: ['xopc.projects.list'], name: 'Auth0 Client' },
    );
    const legacyJwt = await new SignJWT({ azp: 'azp-client', scope: 'mcp.read' })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' })
      .setSubject('idp-user-1').setIssuer(issuer).setAudience(resource)
      .setIssuedAt().setExpirationTime('5m').sign(privateKey);

    const callRemote = () => fetch(resource, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${legacyJwt}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'tools/list',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });
    expect((await callRemote()).status).toBe(200);
    expect((await callRemote()).status).toBe(200);
    const rateLimited = await callRemote();
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get('Retry-After')).toBeTruthy();

    // Owner Admin REST API: overview, audit, local grant create/delete
    const ownerHeaders = { Authorization: `Bearer ${env.ownerToken}`, 'Content-Type': 'application/json' };
    const overview = await (await fetch(`${env.baseUrl}/api/mcp-server/overview`, { headers: ownerHeaders })).json() as {
      ok: boolean;
      payload: {
        toolsets: unknown[];
        localGrants: Array<{ connectionId: string; stats: { totalCalls: number } | null }>;
        remoteGrants: unknown[];
        snippets: { claudeDesktop: string; codexToml: string };
      };
    };
    expect(overview.ok).toBe(true);
    expect(overview.payload.toolsets.length).toBeGreaterThanOrEqual(MCP_TOOLSETS.length);
    expect(overview.payload.localGrants.find(g => g.connectionId === localConn.connectionId)?.stats?.totalCalls).toBeGreaterThan(0);
    expect(overview.payload.snippets.claudeDesktop).toContain('mcp');

    const createdAdminGrant = await (await fetch(`${env.baseUrl}/api/mcp-server/grants/local`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ name: 'Web UI Grant', toolset: 'memory-read' }),
    })).json() as { ok: boolean; payload: { connectionId: string; token: string; snippets: { claudeDesktop: string } } };
    expect(createdAdminGrant.ok).toBe(true);
    expect(createdAdminGrant.payload.token).toMatch(/^xopc_mcp_/);
    expect(createdAdminGrant.payload.snippets.claudeDesktop).toContain(createdAdminGrant.payload.token);

    const audit = await (await fetch(`${env.baseUrl}/api/mcp-server/audit?connectionId=${localConn.connectionId}`, { headers: ownerHeaders })).json() as {
      ok: boolean; payload: { entries: Array<{ capabilityId: string }> };
    };
    expect(audit.ok).toBe(true);
    expect(audit.payload.entries.some(e => e.capabilityId === 'xopc.projects.get')).toBe(true);
  }, 20_000);
});
