import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { fileResourceArtifactUri, TURN_OUTCOME_VERSION } from '@xopcai/gateway-contract';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, it, vi } from 'vitest';

import { createClarifyTool } from '../../agent/tools/clarify-tool.js';
import { createTaskCollaborationTool } from '../../agent/tools/task-collaboration-tool.js';
import { bootstrapApplicationStateSync } from '../../bootstrap/application-state.js';
import { ConfigSchema } from '../../config/schema.js';
import { fileResourceId } from '../../files/file-service.js';
import { createMcpConnection } from '../../mcp/connection-grants.js';
import { grantRemoteMcpConnection, revokeRemoteMcpConnection } from '../../mcp/remote-grants.js';
import { NotesService } from '../../notes/service.js';
import { NotesStore } from '../../notes/store.js';
import { buildTaskExecutionDirective } from '../../tasks/task-context-assembler.js';
import { TaskContextRepository } from '../../tasks/task-context-repository.js';
import { TaskConversationRepository } from '../../tasks/task-conversation-repository.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskRunCoordinator } from '../../tasks/task-run-coordinator.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import {
  claimNextSessionInput, closeXopcDatabase, ensureSessionRecord, finishSessionInputRun, insertSessionInput,
  openXopcDatabase, resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { createHonoApp } from '../hono/app.js';
import { getGatewayFileSpaceService } from '../file-space-service.js';
import { GatewayAgentRunner, type GatewayAgentRunnerOptions } from '../service/agent-runner.js';
import { SessionInputCoordinator } from '../service/session-input-coordinator.js';
import type { GatewayService } from '../service.js';

async function origin(server: ReturnType<typeof serve>): Promise<string> {
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing HTTP listener');
  return `http://127.0.0.1:${address.port}`;
}

it('combines OAuth scopes with revocable Gateway authority for remote reads and idempotent writes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'xopc-remote-mcp-'));
  vi.stubEnv('XOPC_STATE_DIR', directory);
  vi.stubEnv('XOPC_WORKSPACE', join(directory, 'workspace'));
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(directory, 'xopc.db') });
  bootstrapApplicationStateSync();
  const owner = randomUUID();
  const config = ConfigSchema.parse({ gateway: { auth: { mode: 'token', token: owner } } });
  const note = { id: 'fixture', title: 'Note', markdown: 'OAuth fixture', kind: 'thought', status: 'inbox', createdAt: 1, updatedAt: 1 };
  new NotesStore().addNote({ ...note, kind: 'thought', status: 'inbox', capturedVia: { channel: 'web' } });
  const notes = new NotesService();
  const getNote = vi.spyOn(notes, 'getNote').mockImplementation(async () => note as Awaited<ReturnType<NotesService['getNote']>>);
  const stopDelegatedTaskRun = vi.fn();
  const resumeDelegatedRunClarification = vi.fn();
  const workspace = join(directory, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const fileName = 'report.txt';
  const outputBytes = Buffer.alloc(50_000, 'a');
  writeFileSync(join(workspace, fileName), outputBytes);
  const steer = vi.fn(async () => true);
  const coordinator = new SessionInputCoordinator({
    sessionExists: async () => true, execute: async () => ({ status: 'ok', summary: 'fixture' }),
    prepareAttachments: async () => undefined, prepareContexts: async () => undefined, steer, emit: () => {},
  });
  const service = {
    currentConfig: config, getResolvedAuth: () => ({ mode: 'token', token: owner }),
    getAuthToken: () => owner, isGatewayReady: () => true, getExtensionLoader: () => null,
    notesServiceInstance: notes, dispatchTaskEvents: () => {}, dispatchTaskRuns: () => {}, stopDelegatedTaskRun, resumeDelegatedRunClarification,
    projects: { list: () => ({ items: [] }) }, sessions: { getEffectiveWorkspacePath: async () => workspace },
    deliverDelegatedTaskSteer: (conversationId: string, inputId: string) => coordinator.deliverDelegatedTaskSteer(conversationId, inputId),
  } as unknown as GatewayService;
  const app = createHonoApp({ service });
  const gateway = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'fixture', alg: 'RS256', use: 'sig' };
  const issuerHttp = serve({
    fetch: () => Response.json({ keys: [jwk] }), hostname: '127.0.0.1', port: 0,
  });
  const client = new Client({ name: 'legacy-test', version: '1' });
  const writer = new Client({ name: 'write-test', version: '1' });
  try {
    const [gatewayUrl, issuer] = await Promise.all([origin(gateway), origin(issuerHttp)]);
    const resource = gatewayUrl + '/mcp';
    const metadataUrl = gatewayUrl + '/.well-known/oauth-protected-resource/mcp';
    expect((await fetch(resource)).status).toBe(404);
    expect((await fetch(metadataUrl)).status).toBe(404);

    config.gateway.mcp = { resource, issuer, jwksUrl: issuer + '/jwks' };
    const unauthenticated = await fetch(resource);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get('WWW-Authenticate')).toContain(`resource_metadata="${metadataUrl}"`);
    expect(await (await fetch(metadataUrl)).json()).toMatchObject({
      resource, authorization_servers: [issuer], scopes_supported: ['mcp.read', 'mcp.write'],
    });
    expect((await fetch(resource, { headers: { Origin: 'https://other.example' } })).status).toBe(403);
    const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(resource, { headers: { Host: 'other.example' } }, response => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on('error', reject);
      request.end();
    });
    expect(foreignHostStatus).toBe(403);

    const identity = { issuer, resource, subject: 'approved-subject', clientId: 'approved-client' };
    const sign = (overrides: { issuer?: string; audience?: string; clientId?: string; scope?: string; expiry?: number; typ?: string } = {}) =>
      new SignJWT({ client_id: overrides.clientId ?? identity.clientId, scope: overrides.scope ?? 'mcp.read' })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid, typ: overrides.typ ?? 'at+jwt' })
        .setSubject(identity.subject).setIssuer(overrides.issuer ?? issuer).setAudience(overrides.audience ?? resource)
        .setIssuedAt().setJti(randomUUID()).setExpirationTime(overrides.expiry ?? '5m').sign(privateKey);
    const token = await sign();
    const headers = (credential: string) => ({ Authorization: `Bearer ${credential}` });
    const rpc = (method: string, params: Record<string, unknown>, credential = token, modern = false) => fetch(resource, {
      method: 'POST',
      headers: {
        ...headers(credential), Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
        ...(modern ? { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method,
          ...(typeof params.name === 'string' ? { 'Mcp-Name': params.name } : {}) } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {
        ...params, ...(modern ? { _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {},
        } } : {}),
      } }),
    });

    expect((await rpc('tools/list', {})).status).toBe(403);
    expect(() => grantRemoteMcpConnection(identity, { capabilityIds: ['xopc.notes.create'] })).toThrow('enable write access explicitly');
    const grant = grantRemoteMcpConnection(identity, { write: true,
      capabilityIds: ['xopc.notes.get', 'xopc.notes.list', 'xopc.notes.create', 'xopc.workspace.search',
        'xopc.tasks.create', 'xopc.task_runs.list', 'xopc.task_runs.get',
        'xopc.agent_runs.agents', 'xopc.agent_runs.start', 'xopc.agent_runs.get', 'xopc.agent_runs.cancel', 'xopc.agent_runs.steer',
        'xopc.agent_runs.result', 'xopc.agent_runs.events', 'xopc.agent_runs.respond', 'xopc.agent_runs.artifact_read'],
    });
    const readOnlyClient = { ...identity, clientId: 'read-only-client' };
    grantRemoteMcpConnection(readOnlyClient, { capabilityIds: ['xopc.notes.get'] });
    const otherWriter = { ...identity, clientId: 'other-writer' };
    grantRemoteMcpConnection(otherWriter, { write: true, capabilityIds: ['xopc.agent_runs.get', 'xopc.agent_runs.cancel',
      'xopc.agent_runs.steer', 'xopc.agent_runs.result', 'xopc.agent_runs.events', 'xopc.agent_runs.respond', 'xopc.agent_runs.artifact_read'] });
    for (const badToken of [
      owner, createMcpConnection(['xopc.notes.get']).token, await sign({ audience: issuer }),
      await sign({ issuer: gatewayUrl }), await sign({ typ: 'JWT' }), await sign({ expiry: 1 }),
    ]) {
      const response = await rpc('tools/list', {}, badToken);
      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toContain('error="invalid_token"');
    }
    const wrongScope = await rpc('tools/list', {}, await sign({ scope: 'mcp.read.narrower' }));
    expect(wrongScope.status).toBe(403);
    expect(wrongScope.headers.get('WWW-Authenticate')).toContain('error="insufficient_scope"');
    expect((await rpc('tools/list', {}, await sign({ clientId: 'different-client' }))).status).toBe(403);
    expect((await fetch(gatewayUrl + '/api/capabilities/operations', { headers: headers(token) })).status).toBe(401);
    expect((await fetch(gatewayUrl + '/api/mcp/bridge', { headers: headers(token) })).status).toBe(403);

    await client.connect(new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: headers(token) } }));
    expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual([
      'xopc_agent_runs_agents', 'xopc_agent_runs_artifact_read', 'xopc_agent_runs_events', 'xopc_agent_runs_get',
      'xopc_agent_runs_result', 'xopc_notes_get', 'xopc_notes_list',
      'xopc_task_runs_get', 'xopc_task_runs_list', 'xopc_workspace_search',
    ]);
    const read = await client.callTool({ name: 'xopc_notes_get', arguments: { id: 'fixture' } });
    expect(read.structuredContent).toEqual({ note });
    const write = await client.callTool({ name: 'xopc_notes_create', arguments: { title: 'Denied' } });
    expect(write).toMatchObject({ isError: true, content: [{ text: '{"code":"FORBIDDEN"}' }] });

    const modern = await rpc('tools/call', { name: 'xopc_notes_get', arguments: { id: 'fixture' } }, token, true);
    expect(modern.status).toBe(200);
    expect(await modern.json()).toMatchObject({ result: { structuredContent: { note } } });

    const writeToken = await sign({ scope: 'mcp.read mcp.write' });
    const ungrantedWrite = await rpc('tools/call', { name: 'xopc_notes_create', arguments: { idempotencyKey: 'denied' } },
      await sign({ clientId: readOnlyClient.clientId, scope: 'mcp.read mcp.write' }), true);
    expect(await ungrantedWrite.json()).toMatchObject({ result: { isError: true } });
    await writer.connect(new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: headers(writeToken) } }));
    expect((await writer.listTools()).tools.some(tool => tool.name === 'xopc_notes_create')).toBe(true);
    const create = (args: Record<string, string>) => writer.callTool({ name: 'xopc_notes_create', arguments: args });
    expect(await create({ title: 'Missing key' })).toMatchObject({ isError: true, content: [{ text: '{"code":"INVALID_INPUT"}' }] });
    const payload = { title: 'Remote fixture discoverable', markdown: '文'.repeat(25_000), idempotencyKey: 'fixture-key' };
    const [first, replay] = await Promise.all([create(payload), create(payload)]);
    expect(first.structuredContent).toMatchObject({ note: { title: payload.title, markdown: payload.markdown } });
    expect(replay.structuredContent).toEqual(first.structuredContent);
    const modernReplay = await rpc('tools/call', { name: 'xopc_notes_create', arguments: payload }, writeToken, true);
    expect(await modernReplay.json()).toMatchObject({ result: { structuredContent: first.structuredContent } });
    expect(await create({ ...payload, title: 'Changed' })).toMatchObject({
      isError: true, content: [{ text: '{"code":"REVISION_CONFLICT"}' }],
    });
    const found = await client.callTool({ name: 'xopc_workspace_search', arguments: { query: 'discoverable' } });
    expect(found.structuredContent).toMatchObject({ hits: [{ kind: 'note', title: payload.title }] });

    const task = await writer.callTool({ name: 'xopc_tasks_create', arguments: {
      idempotencyKey: 'task-key', title: 'Task run fixture', contract: { objective: 'Inspect execution' },
    } });
    expect(task.structuredContent).toMatchObject({ ok: true, model: { task: { phase: 'backlog' } } });
    const taskId = (task.structuredContent as { model: { task: { id: string } } }).model.task.id;
    const run = new TaskRunRepository().create({
      taskId, executorKind: 'human', executorRef: { actorId: 'internal-fixture' }, trigger: {},
      correlationId: 'internal-correlation', idempotencyKey: 'internal-run-key', contractVersion: 1,
    });
    const runs = await client.callTool({ name: 'xopc_task_runs_list', arguments: { taskId } });
    expect(runs.structuredContent).toMatchObject({ taskId, items: [{ id: run.id, status: 'queued' }] });
    const details = await client.callTool({ name: 'xopc_task_runs_get', arguments: { id: run.id } });
    expect(details.structuredContent).toEqual({ ok: true, run: {
      id: run.id, taskId, status: 'queued', executorKind: 'human', queuedAt: run.queuedAt, attempt: 1, version: 1,
    } });

    const delegate = (name: string, args: Record<string, unknown>) => writer.callTool({ name: 'xopc_agent_runs_' + name, arguments: args });
    const agents = await delegate('agents', {});
    const agentId = (agents.structuredContent as { defaultAgentId: string }).defaultAgentId;
    const delegatedInput = { title: 'Delegate fixture', prompt: '/a fixture prompt', agentId, idempotencyKey: 'delegate-key',
      references: [{ kind: 'note', id: 'fixture' }] };
    const delegated = await delegate('start', delegatedInput);
    expect(delegated.structuredContent).toMatchObject({ agentId, status: 'queued' });
    const { runId, taskId: delegatedTaskId } = delegated.structuredContent as { runId: string; taskId: string };
    expect(new TaskRepository().require(delegatedTaskId).contract?.brief).toContain('OAuth fixture');
    const firstPage = (await delegate('events', { runId, limit: 1 })).structuredContent;
    expect(firstPage).toMatchObject({ status: 'queued', events: [{ sequence: 1, type: 'task_run.created' }], nextSequence: 1 });
    expect(await delegate('start', { ...delegatedInput, callback: true, idempotencyKey: 'missing-callback' })).toMatchObject({
      isError: true, content: [{ text: '{"code":"UNAVAILABLE"}' }],
    });
    expect((await delegate('start', delegatedInput)).structuredContent).toEqual(delegated.structuredContent);
    expect(await delegate('start', { ...delegatedInput, prompt: 'Changed' })).toMatchObject({
      isError: true, content: [{ text: '{"code":"REVISION_CONFLICT"}' }],
    });
    const otherToken = await sign({ clientId: otherWriter.clientId, scope: 'mcp.read mcp.write' });
    expect(await delegate('steer', { runId, message: 'Too early', idempotencyKey: 'queued-steer' })).toMatchObject({
      isError: true, content: [{ text: '{"code":"REVISION_CONFLICT"}' }],
    });
    const foreignArgs = { get: {}, result: {}, events: {}, artifact_read: { artifactId: 'test' },
      cancel: { idempotencyKey: 'foreign' }, steer: { message: 'Foreign steer', idempotencyKey: 'foreign' },
      respond: { clarificationId: randomUUID(), expectedVersion: 1, idempotencyKey: 'foreign', response: { text: 'Foreign' } } };
    for (const [name, args] of Object.entries(foreignArgs)) {
      const argumentsForTool = { runId, ...args };
      const denied = await rpc('tools/call', { name: 'xopc_agent_runs_' + name, arguments: argumentsForTool }, otherToken, true);
      expect(await denied.json()).toMatchObject({ result: { isError: true, content: [{ text: '{"code":"NOT_FOUND"}' }] } });
    }
    const conversationId = randomUUID();
    ensureSessionRecord(conversationId, join(directory, 'workspace'), { agentId });
    const space = await getGatewayFileSpaceService(service).forContext('session', conversationId);
    const outputFileId = fileResourceId(space.id, fileName);
    const contextSnapshot = new TaskContextRepository().captureSnapshot({ ownerKind: 'task_run', ownerId: runId, query: 'Fixture' });
    expect(new TaskRunRepository().start({ runId, expectedVersion: 1, contextSnapshotId: contextSnapshot.id, policySnapshot: {}, conversationId })).toBeDefined();
    new TaskConversationRepository().activateExecutionSession({ taskId: delegatedTaskId, conversationId, agentId, runId });
    const activeInput = insertSessionInput({
      conversationId, id: randomUUID(), clientMessageId: 'active-task-input', origin: { type: 'system', source: 'task' },
      taskRunId: runId, requestedDelivery: 'next', effectiveDelivery: 'next', content: 'Original task', status: 'queued',
    });
    const turnId = randomUUID();
    expect(claimNextSessionInput(conversationId, turnId)?.id).toBe(activeInput.id);
    const steerArgs = { runId, message: 'Use shorter wording', idempotencyKey: 'live-steer' };
    const steerReceipt = (await delegate('steer', steerArgs)).structuredContent;
    expect(steerReceipt).toEqual({ runId, status: 'accepted', inputId: expect.any(String) });
    expect((await delegate('steer', steerArgs)).structuredContent).toEqual(steerReceipt);
    expect(steer).toHaveBeenCalledExactlyOnceWith(conversationId, steerArgs.message, turnId, expect.objectContaining({ clientMessageId: expect.any(String) }));
    const steerInputId = (steerReceipt as { inputId: string }).inputId;
    const getSteer = async () => (await delegate('get', { runId, steerInputId })).structuredContent;
    expect(await getSteer()).toMatchObject({ steer: { inputId: steerInputId, status: 'pending' } });
    expect(buildTaskExecutionDirective(conversationId)).toContain('ask the MCP requester with clarify');
    const collaboration = createTaskCollaborationTool({ getCurrentConversationId: () => conversationId, getCurrentAgentId: () => agentId });
    await expect(collaboration.execute('old-question', { command: 'post', kind: 'question', body: 'Which format?' }))
      .rejects.toThrow('Use clarify to ask the MCP requester');
    expect(new TaskRunRepository().require(runId).status).toBe('running');
    const agentRunner = new GatewayAgentRunner({
      sessionIndex: { getSessionMetadata: async () => null }, emit: vi.fn(),
    } as unknown as GatewayAgentRunnerOptions);
    let waitId: string | undefined;
    try {
      const clarify = createClarifyTool({ resolveAskUser: toolCallId => request => agentRunner.requestClarification({
        conversationId, runId: turnId, toolCallId, request, publishStreamFor: () => vi.fn(),
      }) });
      const result = await clarify.execute('ask', { question: 'Which format?' });
      expect(result.details.status).toBe('waiting');
      waitId = result.details.waitId;
    } finally {
      agentRunner.disposeClarifications();
    }
    expect((await delegate('get', { runId })).structuredContent).toMatchObject({
      status: 'waiting', clarification: { id: waitId, version: 1, question: 'Which format?' },
    });
    const reply = { runId, clarificationId: waitId, expectedVersion: 1, response: { text: 'Markdown' }, idempotencyKey: 'answer' };
    const accepted = await delegate('respond', reply);
    expect(accepted.structuredContent).toEqual({ runId, clarificationId: waitId, status: 'queued' });
    expect((await delegate('respond', reply)).structuredContent).toEqual(accepted.structuredContent);
    expect(resumeDelegatedRunClarification).toHaveBeenCalledWith(expect.objectContaining({ answer: 'Markdown', taskRunId: runId }));
    finishSessionInputRun(conversationId, turnId, 'completed');
    expect(await getSteer()).toMatchObject({ steer: { inputId: steerInputId, status: 'interrupted' } });
    expect(claimNextSessionInput(conversationId, randomUUID())?.taskRunId).toBe(runId);

    expect((await delegate('cancel', { runId, idempotencyKey: 'cancel-key' })).structuredContent).toMatchObject({
      runId, status: 'cancelled', executionStopConfirmed: false, result: { status: 'cancelled' },
    });
    expect(stopDelegatedTaskRun).toHaveBeenCalledWith(runId);
    expect((await delegate('get', { runId })).structuredContent).toMatchObject({ status: 'cancelled' });

    const completionStart = await delegate('start', { ...delegatedInput, idempotencyKey: 'complete',
      references: [{ kind: 'file', id: outputFileId }] });
    expect(completionStart).toMatchObject({ structuredContent: { status: 'queued' } });
    const { runId: completedRunId, taskId: completedTaskId } = completionStart.structuredContent as { runId: string; taskId: string };
    const resultSession = randomUUID();
    ensureSessionRecord(resultSession, workspace, { agentId });
    new TaskConversationRepository().activateExecutionSession({ taskId: completedTaskId, conversationId: resultSession, agentId, runId: completedRunId });
    const completion = TaskRunCoordinator.start({ runId: completedRunId, fallbackObjective: 'Publish report', context: {
      runId: completedRunId, taskId: completedTaskId, conversationId: resultSession, agentId, channel: 'webchat', origin: 'task', triggerKind: 'user',
    } });
    expect(completion).toBeDefined();
    const artifactId = 'fixture-report';
    const finalText = 'a'.repeat(11_999) + '😃 done';
    completion!.captureOutcome({ version: TURN_OUTCOME_VERSION, outcomeId: 'fixture-outcome', runId: completedRunId, turnId,
      status: 'succeeded', createdAt: new Date().toISOString(), evidence: [],
      deliverables: [{ artifactId, title: 'Report', kind: 'document', location: 'workspace', availability: 'available',
        capabilities: ['download'], uri: fileResourceArtifactUri(outputFileId) }],
      research: { version: 1, contractVersion: 1, instructionSequence: 0, review: 'model_reviewed', finalText,
        sources: [{ id: 'source', toolCallId: 'read', toolName: 'read_file', excerpt: 'Report', snapshotHash: 'a'.repeat(64), observedAt: Date.now() }],
        claims: [{ id: 'claim', statement: 'Report drafted', kind: 'fact', support: 'supported', sourceIds: ['source'] }],
        checks: [], finalArtifactIds: [artifactId], inspectedArtifactIds: [artifactId] },
    });
    completion!.finalize({ status: 'succeeded', summary: 'Message processed', assistantText: 'Done' });
    const firstResult = (await delegate('result', { runId: completedRunId })).structuredContent as { text: string; nextTextOffset: number };
    expect(firstResult).toMatchObject({ status: 'succeeded', textSource: 'final_answer', nextTextOffset: 12_001,
      artifacts: [{ artifactId, workspaceFileId: outputFileId, canRead: true }] });
    const secondResult = (await delegate('result', { runId: completedRunId, textOffset: firstResult.nextTextOffset })).structuredContent;
    expect(firstResult.text + secondResult?.text).toBe(finalText);
    const artifact = (await delegate('artifact_read', { runId: completedRunId, artifactId })).structuredContent as
      { data: string; nextOffset: number; revision: string };
    expect(artifact).toMatchObject({ size: outputBytes.length, nextOffset: 48 * 1024 });
    const remaining = (await delegate('artifact_read', {
      runId: completedRunId, artifactId, offset: artifact.nextOffset, expectedRevision: artifact.revision,
    })).structuredContent as { data: string; nextOffset: null };
    expect(remaining.nextOffset).toBeNull();
    expect(Buffer.concat([Buffer.from(artifact.data, 'base64'), Buffer.from(remaining.data, 'base64')])).toEqual(outputBytes);
    expect((await delegate('artifact_read', { runId, artifactId })).isError).toBe(true);

    let release!: () => void;
    const pendingRead = new Promise<void>(resolve => { release = resolve; });
    getNote.mockImplementationOnce(async () => { await pendingRead; return note; });
    const inFlight = client.callTool({ name: 'xopc_notes_get', arguments: { id: 'fixture' } });
    try {
      await vi.waitFor(() => expect(getNote).toHaveBeenCalledTimes(3));
      expect(revokeRemoteMcpConnection(grant.connectionId)).toBe(true);
    } finally {
      release();
    }
    expect(await inFlight).toMatchObject({ isError: true, content: [{ text: '{"code":"FORBIDDEN"}' }] });
    expect((await rpc('tools/list', {}, writeToken)).status).toBe(403);
  } finally {
    await Promise.all([client.close(), writer.close()]);
    await Promise.all([gateway, issuerHttp].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
}, 20_000);
