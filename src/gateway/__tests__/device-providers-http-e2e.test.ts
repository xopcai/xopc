import crypto from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

import { serve } from '@hono/node-server';
import { EndpointToolRegistry } from '@xopcai/endpoint-tools-client';
import { expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';
import { connectDeviceBridge } from '../../endpoint-tools/bridge-host.js';
import { RealtimeRuntime } from '../../realtime/runtime.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('publishes, admits, executes and withdraws a device provider through authenticated HTTP and real WS', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'xopc-provider-e2e-'));
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(directory, 'xopc.db') });
  const endpointTools = new EndpointToolRuntime({ uploadRoot: directory }), realtime = new RealtimeRuntime(endpointTools);
  const token = 'provider-e2e-owner-token';
  const app = createHonoApp({ service: {
    currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }), endpointTools, realtime,
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token, isGatewayReady: () => true, getExtensionLoader: () => null,
  } as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  server.on('upgrade', (request, socket, head) => { if (!realtime.handleUpgrade(request, socket, head)) socket.destroy(); });
  let bridge: Awaited<ReturnType<typeof connectDeviceBridge>> | undefined;
  let stopMcp: (() => Promise<void>) | undefined;
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    const origin = `http://127.0.0.1:${address.port}`;
    const request = (path: string, body?: unknown) => fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const { connectDeviceMcpProvider } = await import('../../endpoint-tools/mcp-provider.js');
    const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const { ListToolsRequestSchema, CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
    const tools = new EndpointToolRegistry([]);
    const execute = vi.fn(async () => ({ content: [], structuredContent: { degrees: 23 } }));
    const mcp = new Server({ name: 'http-sensor', version: '1' }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [{
      name: 'Read-Temperature', title: 'Temperature', description: 'Read the temperature in degrees Celsius',
      inputSchema: { type: 'object', additionalProperties: false },
      outputSchema: { type: 'object', $ref: '#/$defs/sample', $defs: { sample: { type: 'object', properties: { degrees: { type: 'number' } }, required: ['degrees'], additionalProperties: false } } },
    }] }));
    mcp.setRequestHandler(CallToolRequestSchema, execute);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: crypto.randomUUID });
    await mcp.connect(transport);
    const mcpListener = createServer((req, res) => { void transport.handleRequest(req, res); });
    mcpListener.listen(0, '127.0.0.1'); await once(mcpListener, 'listening');
    stopMcp = async () => { await mcp.close(); await new Promise<void>(resolve => mcpListener.close(() => resolve())); };
    const mcpAddress = mcpListener.address();
    if (!mcpAddress || typeof mcpAddress === 'string') throw new Error('Missing MCP listener');
    const mcpProvider = await connectDeviceMcpProvider({ registry: tools, localId: 'climate', title: 'Room sensor', summary: 'Read room temperature',
      server: { url: `http://127.0.0.1:${mcpAddress.port}/mcp` }, policies: { 'Read-Temperature': {
        effect: 'read', sensitivity: 'public', confirmation: 'never', requiresForeground: false, requiredPermissions: [], timeoutMs: 10_000,
        maxConcurrency: 1, supportsCancellation: true, idempotent: true, resultKinds: ['json'],
      } } });
    const closeMcp = stopMcp;
    stopMcp = async () => { await mcpProvider.close(); await closeMcp(); };
    bridge = await connectDeviceBridge({ gatewayUrl: origin, token, identityPath: join(directory, 'bridge.json'), registry: tools });
    const path = '/api/endpoint-tools/providers';
    expect((await fetch(origin + path)).status).toBe(401);
    await vi.waitFor(() => expect(endpointTools.providers.list()).toHaveLength(1));
    const response = await request(path);
    expect(response.status).toBe(200);
    const record = (await response.json()).payload[0];
    expect(record).toMatchObject({ principalId: bridge.principalId, admitted: false, status: 'authorization_required' });
    expect((await request(path + '/admission', { principalId: bridge.principalId, localId: 'climate', expectedDigest: '0'.repeat(64), allowed: true })).status).toBe(409);
    expect((await request(path + '/admission', { principalId: bridge.principalId, localId: 'climate', expectedDigest: record.digest, allowed: true })).status).toBe(200);
    await vi.waitFor(() => expect(endpointTools.providers.list()[0].status).toBe('ready'));
    const tool = endpointTools.registry.getTool(bridge.endpointId, 'provider_climate.Read-Temperature')!;
    const result = await endpointTools.invocations.invoke({ endpointId: bridge.endpointId, toolName: tool.descriptor.name,
      descriptorRevision: tool.revision, toolCallId: 'read-temperature', arguments: {} });
    expect(result.content).toEqual([{ type: 'json', value: { degrees: 23 } }]);
    expect(execute).toHaveBeenCalledTimes(1);
    const { createDeviceHostCredentials } = await import('../../endpoint-tools/host-credentials.js');
    const { getDevice } = await import('../../storage/sqlite/device-access-repository.js');
    expect(getDevice(bridge.principalId)?.scopes).toEqual(['device.self', 'gateway.status']);
    const identityPath = join(directory, 'bridge.json');
    const identity = JSON.parse(readFileSync(identityPath, 'utf8'));
    const previousRefresh = identity.credential.tokens.refreshToken;
    identity.credential.tokens.accessTokenExpiresAt = Date.now() - 1;
    const credentials = await createDeviceHostCredentials({ origin: new URL(origin), identity, displayName: 'xopc Device Bridge',
      signal: new AbortController().signal, persist: async () => { writeFileSync(identityPath, JSON.stringify(identity), { mode: 0o600 }); } });
    const signed = (path: string, method = 'GET', body = '') => credentials.headers(method, path, body, { 'Content-Type': 'application/json' });
    const own = await fetch(origin + path, { headers: await signed(path) });
    expect(own.status).toBe(200);
    expect((await own.json()).payload.every((claim: { principalId: string }) => claim.principalId === bridge!.principalId)).toBe(true);
    expect(identity.credential.tokens.refreshToken).not.toBe(previousRefresh);
    expect((await fetch(origin + '/api/sessions', { headers: await signed('/api/sessions') })).status).toBe(403);
    const adminPath = path + '/admission', adminBody = JSON.stringify({ principalId: bridge.principalId, localId: 'climate', expectedDigest: record.digest, allowed: true });
    expect((await fetch(origin + adminPath, { method: 'POST', headers: await signed(adminPath, 'POST', adminBody), body: adminBody })).status).toBe(403);
    const { createConversation } = await import('../../storage/sqlite/conversation-repository.js');
    const { EndpointToolProvider } = await import('../../agent/external-tools/endpoint-provider.js');
    const { runWithEmbeddedExecutionSession } = await import('../../agent/embedded/execution-context.js');
    const { MessageBus } = await import('../../infra/bus/index.js');
    const { verifiedChannelBus, verifiedChannelInbound } = await import('../../channels/verified-inbound.js');
    const { withDeviceDelegation } = await import('../../endpoint-tools/delegation.js');
    const { saveAutomation } = await import('../../automations/storage/automation-repository.js');
    const { AutomationActionExecutor } = await import('../../automations/service/action-executor.js');
    const delegationPath = '/api/endpoint-tools/delegations';
    const subject = { kind: 'channel' as const, channel: 'telegram', accountId: 'bot', chatId: '42', senderId: '42' };
    const delegate = { subject, endpointId: bridge.endpointId, toolName: tool.descriptor.name, arguments: {}, expiresAt: Date.now() + 60_000 };
    const grantResponse = await request(delegationPath, delegate);
    expect(grantResponse.status).toBe(201);
    const grantId = (await grantResponse.json()).payload.id;
    expect((await fetch(origin + delegationPath, { headers: await signed(delegationPath) })).status).toBe(403);
    const conversationId = crypto.randomUUID(); createConversation({ agentId: 'main' }, '', conversationId);
    const delegatedTools = (id: string) => new EndpointToolProvider({ runtime: endpointTools, getCurrentContext: () => ({ conversationId: id,
      channel: 'telegram', chatId: '42', origin: { type: 'channel', channel: 'telegram' } }) });
    const bus = new MessageBus();
    const message = { channel: 'telegram', sender_id: '42', chat_id: '42', content: 'Read temperature', metadata: { accountId: 'bot', messageId: '1', isGroup: false } };
    await bus.publishInbound({ ...message });
    expect(verifiedChannelInbound(await bus.consumeInbound())).toBeUndefined();
    await verifiedChannelBus(bus, 'telegram').publishInbound(message);
    const verified = verifiedChannelInbound(await bus.consumeInbound());
    const revoke = (id: string) => fetch(origin + delegationPath + '/' + id, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    const runId = 'delegated-channel-run';
    await withDeviceDelegation(verified, conversationId, runId, () => runWithEmbeddedExecutionSession(conversationId, async () => {
      const external = delegatedTools(conversationId), hits = await external.search('temperature');
      expect(hits).toHaveLength(1);
      const invoke = (args: Record<string, unknown>) => external.execute(hits[0].toolRef, args, undefined, { toolCallId: 'delegated', signal: new AbortController().signal });
      await expect(invoke({ unauthorized: true })).rejects.toThrow('arguments do not match');
      expect((await invoke({})).structuredContent).toEqual({ content: result.content });
      expect((await revoke(grantId)).status).toBe(200);
      expect(await external.search('temperature')).toEqual([]);
      await expect(invoke({})).rejects.toThrow('unavailable');
    }, runId));
    const automation = { id: crypto.randomUUID(), name: 'Read sensor', enabled: true, trigger: { kind: 'manual' as const },
      action: { kind: 'agent' as const, instruction: 'Read temperature' }, safety: { mode: 'auto_apply' as const },
      delivery: { notificationPolicy: 'none' as const, destinations: [] }, conversationMode: 'new_session' as const, state: {},
      createdAtMs: Date.now(), updatedAtMs: Date.now() };
    saveAutomation(automation);
    expect((await request(delegationPath, { ...delegate, subject: { kind: 'automation', automationId: automation.id } })).status).toBe(201);
    const executor = new AutomationActionExecutor();
    executor.setDeps({ agentService: { turnDispatcher: { processDirect: async (_message, id, _origin, _attachments, _thinking, options) =>
      runWithEmbeddedExecutionSession(id, async () => {
        const external = delegatedTools(id), hits = await external.search('temperature');
        if (!hits.length) return 'No delegated tool';
        await external.execute(hits[0].toolRef, {}, undefined, { toolCallId: 'automation-read', signal: new AbortController().signal });
        return 'Delegated read completed';
      }, options?.runId) } } });
    const automationRun = (createdAtMs: number) => ({ id: crypto.randomUUID(), automationId: automation.id, automationName: automation.name,
      status: 'running' as const, triggerSnapshot: automation.trigger, actionSnapshot: automation.action, manual: true, createdAtMs });
    expect((await executor.execute(automation, automationRun(0), new AbortController().signal)).summary).toBe('No delegated tool');
    expect((await executor.execute(automation, automationRun(Date.now()), new AbortController().signal)).summary).toBe('Delegated read completed');
    const changed = { ...automation, action: { ...automation.action, instruction: 'Change the authorized task' } };
    saveAutomation(changed);
    expect((await executor.execute(changed, automationRun(Date.now()), new AbortController().signal)).summary).toBe('No delegated tool');
    endpointTools.providers.setEnabled(false);
    expect(endpointTools.registry.get(bridge.endpointId)?.principalId).toBe(bridge.principalId);
    expect(endpointTools.registry.getTool(bridge.endpointId, tool.descriptor.name)).toBeUndefined();
    expect(endpointTools.providers.list()[0].status).toBe('unavailable');
    endpointTools.providers.setEnabled(true);
    expect(endpointTools.registry.getTool(bridge.endpointId, tool.descriptor.name)?.revision).toBe(tool.revision);
    await mcpProvider.close();
    await vi.waitFor(() => expect(endpointTools.registry.getTool(bridge!.endpointId, tool.descriptor.name)).toBeUndefined());
    await expect(endpointTools.invocations.invoke({ endpointId: bridge.endpointId, toolName: tool.descriptor.name,
      descriptorRevision: tool.revision, toolCallId: 'stale-contract', arguments: {} })).rejects.toThrow('unavailable');
    expect(execute).toHaveBeenCalledTimes(3);
  } finally {
    await bridge?.close();
    await stopMcp?.();
    realtime.close(); endpointTools.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);

it('keeps the selected device stable across real MCP, HTTP and WS and never falls back to another device', async () => {
  const { startDeviceHost } = await import('../../endpoint-tools/device-host.js');
  const { createDeviceUseTool } = await import('../../agent/tools/device-use-tool.js');
  const { EndpointToolProvider } = await import('../../agent/external-tools/endpoint-provider.js');
  const { createConversation } = await import('../../storage/sqlite/conversation-repository.js');
  const { insertSessionInput, claimNextSessionInput } = await import('../../storage/sqlite/session-input-repository.js');
  const { recordDeviceExecutionActor } = await import('../../endpoint-tools/execution-actor.js');
  const directory = mkdtempSync(join(tmpdir(), 'xopc-mcp-device-e2e-'));
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'xopc.db') });
  const endpointTools = new EndpointToolRuntime({ uploadRoot: directory }), realtime = new RealtimeRuntime(endpointTools);
  const token = 'mcp-device-e2e-token', tokenEnv = 'XOPC_DEVICE_FIXTURE_TOKEN';
  const previous = process.env[tokenEnv]; process.env[tokenEnv] = token;
  const app = createHonoApp({ service: { currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }), endpointTools, realtime,
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token, isGatewayReady: () => true, getExtensionLoader: () => null,
  } as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  server.on('upgrade', (request, socket, head) => { if (!realtime.handleUpgrade(request, socket, head)) socket.destroy(); });
  const hosts: Awaited<ReturnType<typeof startDeviceHost>>[] = [];
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
    const origin = `http://127.0.0.1:${address.port}`;
    const start = (displayName: string) => startDeviceHost({ gatewayUrl: origin, tokenEnv,
      identityPath: join(directory, `${displayName}.json`), displayName, providers: [{ localId: 'climate', title: 'Climate', summary: 'Device temperature', gatewayFormInput: 1,
        server: { command: process.execPath, args: [join(process.cwd(), 'scripts/fixtures/device-mcp.mjs')],
          env: { XOPC_FIXTURE_EFFECT_PATH: join(directory, `${displayName}.effects`) } },
        policies: { 'Read-Temperature': { effect: 'read', sensitivity: 'public', confirmation: 'never', requiresForeground: false,
          requiredPermissions: [], timeoutMs: 5_000, maxConcurrency: 1, supportsCancellation: true, idempotent: true, resultKinds: ['json'] },
        read_image: { effect: 'read', sensitivity: 'public', confirmation: 'never', requiresForeground: false,
          requiredPermissions: [], timeoutMs: 5_000, maxConcurrency: 1, supportsCancellation: true, idempotent: true, resultKinds: ['file'] },
        inspect_artifact: { effect: 'read', sensitivity: 'public', confirmation: 'never', requiresForeground: false,
          requiredPermissions: [], timeoutMs: 5_000, maxConcurrency: 1, supportsCancellation: true, idempotent: true, resultKinds: ['text'], artifactInput: 'payload' },
        ask_device: { effect: 'read', sensitivity: 'public', confirmation: 'never', requiresForeground: false,
          requiredPermissions: [], timeoutMs: 3_000, maxConcurrency: 1, supportsCancellation: true, idempotent: true, resultKinds: ['text'] },
        increment_counter: { effect: 'write', sensitivity: 'public', confirmation: 'always', requiresForeground: false,
          requiredPermissions: [], timeoutMs: 5_000, maxConcurrency: 1, supportsCancellation: false, idempotent: false, resultKinds: ['text'] } } }] },
      { confirm: async () => true });
    for (const displayName of ['Alpha', 'Beta']) hosts.push(await start(displayName));
    await vi.waitFor(() => expect(endpointTools.providers.list()).toHaveLength(2));
    for (const claim of endpointTools.providers.list()) {
      const response = await fetch(origin + '/api/endpoint-tools/providers/admission', { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ principalId: claim.principalId, localId: claim.provider.localId, expectedDigest: claim.digest, allowed: true }) });
      expect(response.status).toBe(200);
    }
    await vi.waitFor(() => expect(endpointTools.providers.list().every(claim => claim.status === 'ready')).toBe(true));
    const conversationId = crypto.randomUUID(); createConversation({ agentId: 'main' }, '', conversationId);
    recordDeviceExecutionActor(conversationId, 'device-intent', { kind: 'owner', principalId: 'gateway-owner', scopes: ['gateway.admin'] });
    insertSessionInput({ id: crypto.randomUUID(), conversationId, clientMessageId: 'device-intent', requestedDelivery: 'next', effectiveDelivery: 'next',
      status: 'queued', content: 'Read Alpha temperature', origin: { type: 'system', source: 'cli' } });
    claimNextSessionInput(conversationId, 'device-run');
    const deviceUse = createDeviceUseTool({ runtime: endpointTools, conversationId: () => conversationId });
    const discovered = await deviceUse.execute('discover', { op: 'discover' }, new AbortController().signal);
    const candidates = JSON.parse((discovered.content[0] as { text: string }).text).candidates;
    const alpha = candidates.find((item: { name: string }) => item.name === 'Alpha');
    await deviceUse.execute('select', { op: 'select', targetRef: alpha.targetRef }, new AbortController().signal);
    const external = new EndpointToolProvider({ runtime: endpointTools,
      getCurrentContext: () => ({ conversationId, channel: 'webchat', chatId: conversationId, origin: { type: 'system', source: 'cli' } }) });
    const tools = await external.search('temperature');
    expect(tools).toHaveLength(5);
    expect(tools.every(tool => tool.summary.includes('Alpha'))).toBe(true);
    const temperature = tools.find(tool => tool.toolRef.endsWith('Read-Temperature'))!;
    const result = await external.execute(temperature.toolRef, {}, undefined, { toolCallId: 'alpha-read', signal: new AbortController().signal });
    expect(result.content[0]).toMatchObject({ text: JSON.stringify({ value: 23 }, null, 2) });
    const image = await external.execute(tools.find(tool => tool.toolRef.endsWith('read_image'))!.toolRef, {}, undefined, { toolCallId: 'alpha-image', signal: new AbortController().signal });
    expect(image.content.some(block => block.type === 'image')).toBe(true);
    expect(image.details.endpointFiles).toHaveLength(1);
    const target = await fetch(origin + '/api/endpoint-tools/targets/' + conversationId, { headers: { Authorization: `Bearer ${token}` } });
    expect(target.status).toBe(200);
    expect((await target.json()).payload.endpointId).toBe(hosts[0].endpointId);
    const closeResource = endpointTools.targets.hold(conversationId, 'fixture-resource');
    const beta = candidates.find((item: { name: string }) => item.name === 'Beta');
    await expect(deviceUse.execute('switch', { op: 'select', targetRef: beta.targetRef }, new AbortController().signal)).rejects.toThrow('TARGET_RESOURCE_BUSY');
    closeResource();
    const artifactFile = (image.details.endpointFiles as Array<{ fileId: string; sha256: string }>)[0];
    const transfers = '/api/endpoint-tools/artifact-transfers';
    const ownerHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const formPath = `/api/endpoint-tools/interactions/${conversationId}`;
    const answer = external.execute(tools.find(tool => tool.toolRef.endsWith('ask_device'))!.toolRef, {}, undefined,
      { toolCallId: 'mcp-form', signal: new AbortController().signal });
    const settledAnswer = answer.catch(error => error);
    let form: { requestId: string } | undefined;
    await vi.waitFor(async () => {
      form = (await (await fetch(origin + formPath, { headers: ownerHeaders })).json()).payload[0];
      expect(form).toMatchObject({ message: 'Enter the fixture answer', endpointId: hosts[0].endpointId });
    });
    const submit = (content: unknown, authorized = true) => fetch(origin + formPath, { method: 'POST',
      headers: authorized ? ownerHeaders : { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: form!.requestId, action: 'accept', content }) });
    expect((await submit({ answer: 'ok' }, false)).status).toBe(401);
    expect((await submit({ answer: 'x' })).status).toBe(409);
    expect((await submit({ answer: 'received' })).status).toBe(200);
    expect((await settledAnswer).content).toEqual([{ type: 'text', text: 'received' }]);
    expect((await submit({ answer: 'again' })).status).toBe(409);
    const runForm = (toolCallId: string) => external.execute(tools.find(tool => tool.toolRef.endsWith('ask_device'))!.toolRef,
      {}, undefined, { toolCallId, signal: new AbortController().signal });
    const declined = runForm('decline-form').catch(error => error);
    await vi.waitFor(async () => {
      form = (await (await fetch(origin + formPath, { headers: ownerHeaders })).json()).payload[0];
      expect(form).toBeDefined();
    });
    expect((await fetch(origin + formPath, { method: 'POST', headers: ownerHeaders,
      body: JSON.stringify({ requestId: form!.requestId, action: 'decline' }) })).status).toBe(200);
    expect((await declined).content).toEqual([{ type: 'text', text: 'declined' }]);
    await expect(runForm('expire-form')).rejects.toThrow(/timed out|timeout/i);
    expect((await (await fetch(origin + formPath, { headers: ownerHeaders })).json()).payload).toEqual([]);
    const issueTransfer = () => fetch(origin + transfers, { method: 'POST', headers: ownerHeaders,
      body: JSON.stringify({ conversationId, fileId: artifactFile.fileId, toolName: 'provider_climate.inspect_artifact' }) });
    expect((await issueTransfer()).status).toBe(409);
    await deviceUse.execute('select-beta', { op: 'select', targetRef: beta.targetRef }, new AbortController().signal);
    const transferDirectory = await fetch(`${origin}${transfers}?conversationId=${conversationId}`, { headers: ownerHeaders });
    expect(transferDirectory.status).toBe(200);
    expect((await transferDirectory.json()).payload).toMatchObject({ files: [{ fileId: artifactFile.fileId, sourceName: 'Alpha' }],
      tools: [{ toolName: 'provider_climate.inspect_artifact', input: 'payload' }] });
    const inspect = (await external.search('artifact')).find(tool => tool.toolRef.endsWith('inspect_artifact'))!;
    const runInspect = (id: string) => external.execute(inspect.toolRef, { payload: id }, undefined, { toolCallId: crypto.randomUUID(), signal: new AbortController().signal });
    const issued = await issueTransfer();
    expect(issued.status).toBe(201);
    const { transferId } = (await issued.json()).payload;
    const { createDeviceHostCredentials } = await import('../../endpoint-tools/host-credentials.js');
    const betaCredentials = await createDeviceHostCredentials({ origin: new URL(origin),
      identity: JSON.parse(readFileSync(join(directory, 'Beta.json'), 'utf8')), displayName: 'Beta',
      signal: new AbortController().signal, persist: async () => {} });
    const sourceFilePath = `/api/endpoint-tools/files/${artifactFile.fileId}`;
    expect((await fetch(origin + sourceFilePath, { headers: await betaCredentials.headers('GET', sourceFilePath, '') })).status).toBe(403);
    expect((await fetch(`${origin}/api/endpoint-tools/files/${artifactFile.fileId}`, { headers: ownerHeaders })).status).toBe(200);
    expect((await runInspect(transferId)).content).toEqual([{ type: 'text', text: artifactFile.sha256 }]);
    await expect(runInspect(transferId)).rejects.toThrow('Artifact transfer is unavailable');
    const revocable = (await (await issueTransfer()).json()).payload.transferId;
    expect((await fetch(`${origin}${transfers}/${revocable}`, { method: 'DELETE', headers: ownerHeaders })).status).toBe(200);
    await expect(runInspect(revocable)).rejects.toThrow('Artifact transfer is unavailable');
    await deviceUse.execute('select-alpha', { op: 'select', targetRef: alpha.targetRef }, new AbortController().signal);
    const write = tools.find(tool => tool.toolRef.endsWith('increment_counter'))!;
    let closing: Promise<void> | undefined;
    const writeContext = { toolCallId: 'counter-once', signal: new AbortController().signal,
      onUpdate: (update: { content: Array<{ type: string; text?: string }> }) => {
        if (update.content.some(block => block.text === 'effect committed')) closing ??= hosts[0].close();
      } };
    await expect(external.execute(write.toolRef, {}, undefined, writeContext)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(closing).toBeDefined(); await closing;
    expect(readFileSync(join(directory, 'Alpha.effects'), 'utf8')).toBe('1\n');
    await vi.waitFor(() => expect(endpointTools.registry.get(hosts[0].endpointId)).toBeUndefined());
    expect(endpointTools.registry.get(hosts[1].endpointId)).toBeDefined();
    expect(await external.search('temperature')).toEqual([]);
    await expect(external.execute(temperature.toolRef, {}, undefined, { toolCallId: 'stale-read', signal: new AbortController().signal })).rejects.toThrow('unavailable');
    expect(endpointTools.targets.get(conversationId)?.endpointId).toBe(hosts[0].endpointId);
    delete process.env[tokenEnv];
    const reconnected = await start('Alpha'); hosts.push(reconnected);
    expect(reconnected.endpointId).toBe(hosts[0].endpointId);
    await vi.waitFor(() => expect(endpointTools.providers.list(reconnected.principalId)[0].status).toBe('ready'));
    expect(await external.search('temperature')).toEqual([]);
    const newDirectory = await deviceUse.execute('rediscover', { op: 'discover', query: 'Alpha' }, new AbortController().signal);
    const newRef = JSON.parse((newDirectory.content[0] as { text: string }).text).candidates[0].targetRef;
    expect(newRef).not.toBe(alpha.targetRef);
    await deviceUse.execute('reselect', { op: 'select', targetRef: newRef }, new AbortController().signal);
    await expect(external.execute(write.toolRef, {}, undefined, writeContext)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(readFileSync(join(directory, 'Alpha.effects'), 'utf8')).toBe('1\n');
    const succeeded = await external.execute(write.toolRef, {}, undefined, { toolCallId: 'counter-succeeded', signal: new AbortController().signal });
    expect(succeeded.content.length).toBeGreaterThan(0);
    expect(readFileSync(join(directory, 'Alpha.effects'), 'utf8')).toBe('1\n1\n');
    const receive = endpointTools.handleMessage.bind(endpointTools);
    let lostResultClose: Promise<void> | undefined;
    const lostResult = vi.spyOn(endpointTools, 'handleMessage').mockImplementation((id, connectionId, message) => {
      if (id === reconnected.endpointId && message.type === 'tool.result' && message.payload.providerReceipt) {
        lostResultClose ??= reconnected.close();
        return;
      }
      receive(id, connectionId, message);
    });
    try {
      const failure = await external.execute(write.toolRef, {}, undefined, { toolCallId: 'counter-lost-result', signal: new AbortController().signal })
        .catch(error => error);
      expect(failure).toMatchObject({ code: 'OUTCOME_UNKNOWN', operationId: expect.any(String) });
      expect(lostResultClose).toBeDefined(); await lostResultClose;
      expect(readFileSync(join(directory, 'Alpha.effects'), 'utf8')).toBe('1\n1\n1\n');
      const restarted = await start('Alpha'); hosts.push(restarted);
      await vi.waitFor(() => expect(endpointTools.providers.list(restarted.principalId)[0].status).toBe('ready'));
      const checked = await fetch(`${origin}/api/endpoint-tools/provider-operations/${failure.operationId}`, { headers: { Authorization: `Bearer ${token}` } });
      expect(checked.status).toBe(200);
      expect((await checked.json()).payload).toMatchObject({ operationId: failure.operationId, gatewayState: 'unknown', deviceStatus: 'recorded',
        receipt: { state: 'succeeded', intent: { operationId: failure.operationId }, resultDigest: expect.any(String) } });
      expect(readFileSync(join(directory, 'Alpha.effects'), 'utf8')).toBe('1\n1\n1\n');
    } finally { lostResult.mockRestore(); }
  } finally {
    await Promise.allSettled(hosts.map(host => host.close()));
    realtime.close(); endpointTools.close(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env[tokenEnv]; else process.env[tokenEnv] = previous;
  }
}, 30_000);

it.each(['open', 'queued'] as const)('recovers a %s device readiness interaction across Gateway listener and SQLite restart', async state => {
  const { GatewayAgentRunner } = await import('../service/agent-runner.js');
  const { getSessionMetadata } = await import('../../storage/sqlite/session-repository.js');
  const { createDeviceUseTool } = await import('../../agent/tools/device-use-tool.js');
  const { EndpointToolProvider } = await import('../../agent/external-tools/endpoint-provider.js');
  const { runWithEmbeddedExecutionSession } = await import('../../agent/embedded/execution-context.js');
  const { createConversation } = await import('../../storage/sqlite/conversation-repository.js');
  const { claimNextSessionInput, finishSessionInputRun, insertSessionInput } = await import('../../storage/sqlite/session-input-repository.js');
  const { recordDeviceExecutionActor } = await import('../../endpoint-tools/execution-actor.js');
  const directory = mkdtempSync(join(tmpdir(), 'xopc-device-wait-'));
  const database = join(directory, 'xopc.db');
  const conversationId = crypto.randomUUID(), initialRunId = crypto.randomUUID();
  const token = 'device-wait-e2e-token';
  const auth = { mode: 'token' as const, token };
  const config = ConfigSchema.parse({ gateway: { auth } });
  const owner = { kind: 'owner' as const, principalId: 'gateway-owner', scopes: ['gateway.admin' as const] };
  const toolName = 'provider_resume.read_state';
  const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'device state verified' }] }));
  const registry = new EndpointToolRegistry([]);
  registry.registerProvider({ localId: 'resume', title: 'Resume', summary: 'Read state after readiness confirmation', tools: [{
    descriptor: { name: 'read_state', title: 'Read state', description: 'Read fixture state', inputSchema: { type: 'object' },
      effect: 'read', sensitivity: 'public', confirmation: 'never', requiresForeground: false, requiredPermissions: [],
      timeoutMs: 5_000, maxConcurrency: 1, supportsCancellation: true, idempotent: true, resultKinds: ['text'] },
    execute,
  }] });
  let stopGateway: (() => Promise<void>) | undefined;
  const startGateway = async (port = 0) => {
    openXopcDatabase({ path: database });
    const runtime = new EndpointToolRuntime({ uploadRoot: directory }), realtime = new RealtimeRuntime(runtime);
    const runner = new GatewayAgentRunner({
      canResumeDeviceInteraction: (id, checkpoint) => runtime.canResumeDeviceInteraction(id, checkpoint),
      sessionIndex: { getSessionMetadata: async (id: string) => getSessionMetadata(id) },
      getConfig: () => config, emit: () => {}, publishRealtime: () => {},
    } as ConstructorParameters<typeof GatewayAgentRunner>[0]);
    const external = new EndpointToolProvider({ runtime, getCurrentContext: () => ({
      conversationId, channel: 'webchat', chatId: conversationId, origin: { type: 'system', source: 'internal' },
    }) });
    vi.spyOn(runner, 'runAgent').mockImplementation(async function* (_message, _channel, _chatId, _origin, _attachments, _thinking, options) {
      return runWithEmbeddedExecutionSession(conversationId, async () => {
        const tool = (await external.search('state')).find(entry => entry.toolRef.endsWith('read_state'))!;
        const result = await external.execute(tool.toolRef, {}, undefined, { toolCallId: 'resumed-read', signal: new AbortController().signal });
        expect(result.content).toEqual([{ type: 'text', text: 'device state verified' }]);
        return { status: 'ok', summary: 'verified' };
      }, options?.runId);
    });
    const service = { currentConfig: config, endpointTools: runtime, realtime, getResolvedAuth: () => auth,
      getAuthToken: () => token, isGatewayReady: () => true, getExtensionLoader: () => null,
      getClarificationState: runner.getClarificationState.bind(runner), resolveClarificationResponse: runner.resolveClarificationResponse.bind(runner),
    } as unknown as GatewayService;
    const app = createHonoApp({ service });
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port });
    server.on('upgrade', (request, socket, head) => { if (!realtime.handleUpgrade(request, socket, head)) socket.destroy(); });
    let host: Awaited<ReturnType<typeof connectDeviceBridge>> | undefined;
    stopGateway = async () => {
      await host?.close();
      runner.disposeClarifications();
      realtime.close(); runtime.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      closeXopcDatabase();
    };
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing listener');
    const origin = `http://127.0.0.1:${address.port}`;
    const request = (path: string, method = 'GET', body?: unknown) => fetch(origin + path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    host = await connectDeviceBridge({ gatewayUrl: origin, token, identityPath: join(directory, 'device.json'), registry });
    return { runner, runtime, request, host, port: address.port };
  };
  resetXopcDatabaseSingletonForTest();
  try {
    const first = await startGateway();
    await vi.waitFor(() => expect(first.runtime.providers.list()).toHaveLength(1));
    const claim = first.runtime.providers.list()[0];
    expect((await first.request('/api/endpoint-tools/providers/admission', 'POST', { principalId: claim.principalId,
      localId: claim.provider.localId, expectedDigest: claim.digest, allowed: true })).status).toBe(200);
    await vi.waitFor(() => expect(first.runtime.providers.list()[0].status).toBe('ready'));
    createConversation({ agentId: 'main' }, '', conversationId);
    insertSessionInput({ id: crypto.randomUUID(), conversationId, clientMessageId: 'start', requestedDelivery: 'next', effectiveDelivery: 'next',
      status: 'queued', content: 'Read the selected device when ready', origin: { type: 'system', source: 'cli' } });
    recordDeviceExecutionActor(conversationId, 'start', owner);
    claimNextSessionInput(conversationId, initialRunId);
    const targetPath = `/api/endpoint-tools/targets/${conversationId}`;
    expect((await first.request(targetPath, 'PUT', { endpointId: first.host.endpointId })).status).toBe(200);
    const tool = createDeviceUseTool({ runtime: first.runtime, conversationId: () => conversationId,
      requestClarification: (context, request) => first.runner.requestClarification({ ...context, request, publishStreamFor: () => () => {} }) });
    const result = await runWithEmbeddedExecutionSession(conversationId, () => tool.execute('wait-for-device', { op: 'wait', toolName }), initialRunId);
    const waitId = (result.details as { waitId: string }).waitId;
    const responsePath = `/api/clarifications/${waitId}/responses`;
    if (state === 'queued') {
      const initialWait = first.runner.getClarificationState(conversationId)!.clarification!;
      expect((await first.request(responsePath, 'POST', { action: 'answer', expectedVersion: initialWait.version,
        idempotencyKey: 'answer-before-restart', response: { choiceId: 'device_ready' } })).status).toBe(202);
      expect(first.runner.getClarificationState(conversationId)?.clarification?.status).toBe('queued');
    } else finishSessionInputRun(conversationId, initialRunId, 'suspended');
    expect(execute).not.toHaveBeenCalled();
    await stopGateway!(); stopGateway = undefined;
    const second = await startGateway(first.port);
    second.runner.recoverSessionInputs();
    await vi.waitFor(() => expect(second.runtime.providers.list()[0].status).toBe('ready'));
    await vi.waitFor(() => expect(second.runner.getClarificationState(conversationId)?.clarification?.status).toBe('open'));
    const snapshot = await second.request(`/api/sessions/${conversationId}/clarification`);
    const wait = (await snapshot.json()).payload.clarification;
    expect(wait).toMatchObject({ id: waitId, status: 'open', deviceInteraction: { endpointId: second.host.endpointId, toolName } });
    const command = { action: 'answer', expectedVersion: wait.version, idempotencyKey: 'device-ready', response: { choiceId: 'device_ready' } };
    expect((await second.request(responsePath, 'POST', command)).status).toBe(409);
    expect(execute).not.toHaveBeenCalled();
    expect((await second.request(targetPath, 'PUT', { endpointId: second.host.endpointId })).status).toBe(200);
    expect((await second.request(responsePath, 'POST', command)).status).toBe(202);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(second.runner.getClarificationState(conversationId)?.clarification).toBeNull());
    expect((await second.request(responsePath, 'POST', command)).status).toBe(200);
  } finally {
    await stopGateway?.();
    resetXopcDatabaseSingletonForTest();
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);

it.each(['commit', 'lose-result', 'commit-failure', 'target-revoked'] as const)('recovers a live MCP write safely across Gateway restart (%s)', async outcome => {
  const { startDeviceHost } = await import('../../endpoint-tools/device-host.js');
  const { EndpointToolProvider } = await import('../../agent/external-tools/endpoint-provider.js');
  const { createConversation } = await import('../../storage/sqlite/conversation-repository.js');
  const { insertSessionInput, claimNextSessionInput, recoverSessionInputState } = await import('../../storage/sqlite/session-input-repository.js');
  const { recordDeviceExecutionActor } = await import('../../endpoint-tools/execution-actor.js');
  const { getSqliteDatabase } = await import('../../storage/sqlite/transaction.js');
  const directory = mkdtempSync(join(tmpdir(), 'xopc-live-form-restart-'));
  const effects = join(directory, 'effects');
  const conversationId = crypto.randomUUID();
  const token = 'live-form-fixture-token', tokenEnv = 'XOPC_LIVE_FORM_FIXTURE_TOKEN';
  const previousToken = process.env[tokenEnv];
  process.env[tokenEnv] = token;
  let host: Awaited<ReturnType<typeof startDeviceHost>> | undefined;
  let stopGateway: (() => Promise<void>) | undefined;
  const startGateway = async (port = 0) => {
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    const runtime = new EndpointToolRuntime({ uploadRoot: directory }), realtime = new RealtimeRuntime(runtime);
    const auth = { mode: 'token' as const, token };
    const service = { currentConfig: ConfigSchema.parse({ gateway: { auth } }), endpointTools: runtime, realtime,
      getResolvedAuth: () => auth, getAuthToken: () => token, isGatewayReady: () => true, getExtensionLoader: () => null,
    } as unknown as GatewayService;
    const server = serve({ fetch: createHonoApp({ service }).fetch, hostname: '127.0.0.1', port });
    server.on('upgrade', (request, socket, head) => { if (!realtime.handleUpgrade(request, socket, head)) socket.destroy(); });
    stopGateway = async () => {
      runtime.close();
      realtime.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      closeXopcDatabase();
    };
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing listener');
    const origin = `http://127.0.0.1:${address.port}`;
    const request = (path: string, method = 'GET', body?: unknown) => fetch(origin + path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { runtime, port: address.port, origin, request };
  };
  resetXopcDatabaseSingletonForTest();
  try {
    const first = await startGateway();
    host = await startDeviceHost({ gatewayUrl: first.origin, tokenEnv, identityPath: join(directory, 'host.json'), displayName: 'Form fixture',
      providers: [{ localId: 'forms', title: 'Forms', summary: 'Count effects around one form', gatewayFormInput: 1,
        server: { command: process.execPath, args: [join(process.cwd(), 'scripts/fixtures/device-mcp.mjs')],
          env: { XOPC_FIXTURE_EFFECT_PATH: effects } }, policies: { write_with_form: {
          effect: 'write', sensitivity: 'public', confirmation: 'always', requiresForeground: false,
          requiredPermissions: [], timeoutMs: 25_000, maxConcurrency: 1, supportsCancellation: true, idempotent: false, resultKinds: ['text'],
        } } }],
    }, { confirm: async () => true });
    await vi.waitFor(() => expect(first.runtime.providers.list()).toHaveLength(1));
    const claim = first.runtime.providers.list()[0];
    expect((await first.request('/api/endpoint-tools/providers/admission', 'POST', {
      principalId: claim.principalId, localId: claim.provider.localId, expectedDigest: claim.digest, allowed: true,
    })).status).toBe(200);
    await vi.waitFor(() => expect(first.runtime.providers.list()[0].status).toBe('ready'));
    createConversation({ agentId: 'main' }, '', conversationId);
    insertSessionInput({ id: crypto.randomUUID(), conversationId, clientMessageId: 'write', requestedDelivery: 'next',
      effectiveDelivery: 'next', status: 'queued', content: 'Write with one form', origin: { type: 'system', source: 'cli' } });
    recordDeviceExecutionActor(conversationId, 'write', { kind: 'owner', principalId: 'gateway-owner', scopes: ['gateway.admin'] });
    claimNextSessionInput(conversationId, crypto.randomUUID());
    expect((await first.request(`/api/endpoint-tools/targets/${conversationId}`, 'PUT', { endpointId: host.endpointId })).status).toBe(200);
    const provider = new EndpointToolProvider({ runtime: first.runtime, getCurrentContext: () => ({
      conversationId, channel: 'webchat', chatId: conversationId, origin: { type: 'system', source: 'internal' },
    }) });
    const [tool] = await provider.search('form');
    const executing = provider.execute(tool.toolRef, {}, undefined, { toolCallId: 'single-write', signal: new AbortController().signal })
      .then(() => undefined, error => error);
    const path = `/api/endpoint-tools/interactions/${conversationId}`;
    let original: { invocationId: string; requestId: string } | undefined;
    await vi.waitFor(async () => {
      original = (await (await first.request(path)).json()).payload[0];
      expect(original?.invocationId).toBeDefined();
    });
    expect(readFileSync(effects, 'utf8')).toBe('before\n');
    if (outcome === 'target-revoked') first.runtime.targets.clear(conversationId);
    await stopGateway!(); stopGateway = undefined;
    expect((await executing)?.code).toBe('OUTCOME_UNKNOWN');
    const second = await startGateway(first.port);
    recoverSessionInputState();
    if (outcome === 'target-revoked') {
      const send = vi.spyOn(second.runtime.registry, 'send');
      await vi.waitFor(() => expect(send).toHaveBeenCalledWith(host!.endpointId, 'tool.cancel',
        expect.objectContaining({ invocationId: original!.invocationId })), { timeout: 15_000 });
      expect((await (await second.request(path)).json()).payload).toEqual([]);
      expect(readFileSync(effects, 'utf8')).toBe('before\n');
      expect(getSqliteDatabase().prepare('SELECT state FROM capability_operations').get()).toEqual({ state: 'unknown' });
      return;
    }
    await vi.waitFor(async () => {
      const result = (await (await second.request(path)).json()).payload[0];
      expect(result).toMatchObject({ invocationId: original!.invocationId, requestId: original!.requestId });
    }, { timeout: 15_000 });
    expect(readFileSync(effects, 'utf8')).toBe('before\n');
    const answer = { requestId: original!.requestId, action: 'accept', content: { answer: 'done' } };
    if (outcome === 'commit-failure') getSqliteDatabase().exec(`CREATE TEMP TRIGGER fail_recovered_commit BEFORE UPDATE OF state ON capability_operations
      WHEN NEW.state = 'succeeded' BEGIN SELECT RAISE(ABORT, 'injected recovery commit failure'); END`);
    const receive = second.runtime.handleMessage.bind(second.runtime);
    if (outcome === 'lose-result') vi.spyOn(second.runtime, 'handleMessage').mockImplementation((endpointId, connectionId, message) => {
      if (message.type === 'tool.result' && message.payload.invocationId === original!.invocationId) {
        second.runtime.disconnect(endpointId, 'Injected result loss');
        return;
      }
      receive(endpointId, connectionId, message);
    });
    expect((await second.request(path, 'POST', answer)).status).toBe(200);
    expect((await second.request(path, 'POST', answer)).status).toBe(409);
    await vi.waitFor(() => expect(readFileSync(effects, 'utf8')).toBe('before\nafter\n'));
    await vi.waitFor(() => expect(getSqliteDatabase().prepare('SELECT state FROM capability_operations').get()).toEqual({
      state: outcome === 'commit' ? 'succeeded' : 'unknown',
    }));
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS count FROM endpoint_tool_invocations').get()).toEqual({ count: 1 });
    await vi.waitFor(() => expect(getSqliteDatabase().prepare('SELECT status, error_code FROM endpoint_tool_invocations').get()).toEqual(
      outcome === 'commit' ? { status: 'succeeded', error_code: null } : { status: 'failed', error_code: 'OUTCOME_UNKNOWN' },
    ));
    const display = getSqliteDatabase().prepare("SELECT payload_json FROM transcript_entries WHERE json_extract(payload_json, '$.customType') = 'device_interaction_result'").all();
    expect(display).toHaveLength(outcome === 'commit' ? 1 : 0);
  } finally {
    await host?.close();
    await stopGateway?.();
    resetXopcDatabaseSingletonForTest();
    if (previousToken === undefined) delete process.env[tokenEnv]; else process.env[tokenEnv] = previousToken;
    rmSync(directory, { recursive: true, force: true });
  }
}, 35_000);
