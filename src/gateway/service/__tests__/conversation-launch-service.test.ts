import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import { serve } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationLaunchView } from '@xopcai/gateway-contract';

import { ConfigSchema } from '../../../config/schema.js';
import { seedTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { createXopcUseTool } from '../../../agent/tools/xopc-use-tool.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/connection.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { getSessionMetadata, deleteSessionRecord, resetSessionRecord } from '../../../storage/sqlite/session-repository.js';
import { getSessionInputById, getSessionInputState } from '../../../storage/sqlite/session-input-repository.js';
import { getSessionPreparation } from '../../../storage/sqlite/session-creation-repository.js';
import { appendTranscriptEntry, loadTranscriptRowsForSession } from '../../../storage/sqlite/transcript-repository.js';
import { messagesToClientHistory } from '../../../session/client-history.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { listConversationLaunches } from '../../../storage/sqlite/conversation-launch-repository.js';
import { ProjectService } from '../../../projects/project-service.js';
import { createHonoApp } from '../../hono/app.js';
import type { GatewayService } from '../../service.js';
import { SessionInputCoordinator } from '../session-input-coordinator.js';
import { launchConversation } from '../conversation-launch-service.js';

vi.mock('../../../providers/index.js', async importOriginal => ({ ...await importOriginal<object>(), resolveModel: () => ({ id: 'model' }) }));
vi.mock('../../../providers/model-thinking.js', () => ({ getModelThinking: () => ({ options: ['off'] }) }));

describe('Agent conversation launch', () => {
  let dir: string;
  let sourceId: string;
  let service: GatewayService;
  let projects: ProjectService;
  let coordinator: SessionInputCoordinator;
  let finish: (() => void) | undefined;
  const token = 'launch-test-token';
  const context = (key = 'launch-1') => ({ sourceConversationId: sourceId, toolCallId: 'call-1', idempotencyKey: key });
  const args = { prompt: 'hello', title: 'Greeting', project: { kind: 'none' as const } };
  const create = async (key = 'launch-1'): Promise<ConversationLaunchView> => {
    const result = await launchConversation(service, args, context(key));
    if (!('conversationId' in result)) throw new Error('Expected accepted launch');
    return result;
  };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-launch-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    seedTestAgentCatalog();
    sourceId = randomUUID();
    createConversation({ agentId: 'main' }, '', sourceId);
    projects = new ProjectService();
    coordinator = new SessionInputCoordinator({
      coalesceWindowMs: 1,
      sessionExists: async id => Boolean(getSessionMetadata(id)),
      prepareAttachments: async (_id, attachments) => attachments,
      prepareContexts: async () => [], steer: async () => false, emit: vi.fn(),
      execute: async input => {
        appendTranscriptEntry(input.conversationId, { role: 'user', content: input.content, timestamp: Date.now(), turnId: input.runId } as never);
        await new Promise<void>(resolve => { finish = resolve; });
        appendTranscriptEntry(input.conversationId, { role: 'assistant', content: [{ type: 'text', text: '你好！' }], timestamp: Date.now(), turnId: input.runId } as never);
        return { status: 'ok', summary: '你好！' };
      },
    });
    service = {
      currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
      getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
      isGatewayReady: () => true, getExtensionLoader: () => null,
      projects, sessions: { getSession: async (id: string) => getSessionMetadata(id),
        getAgentConfig: async () => ({ model: 'test/model', thinkingLevel: 'off', fixedModel: true }) },
      getSessionInputState, emit: vi.fn(), sessionPreparations: { wake: vi.fn() },
      withSessionInputSubmission: coordinator.withSubmission.bind(coordinator),
      prepareSessionCommandInput: coordinator.prepareInput.bind(coordinator),
      dispatchAcceptedSessionInput: coordinator.dispatchAcceptedInput.bind(coordinator),
      drainSessionInputs: coordinator.drain.bind(coordinator),
    } as unknown as GatewayService;
  });
  afterEach(async () => {
    finish?.(); finish = undefined;
    await vi.waitFor(() => expect(getSqliteDatabase().prepare("SELECT count(*) AS n FROM session_inputs WHERE status='running'").get()).toEqual({ n: 0 }));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates once, executes independently, persists provenance and pins the first reply across later turns and reopen', async () => {
    const [first, replay] = await Promise.all([create(), create()]);
    expect(replay.conversationId).toBe(first.conversationId);
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM conversation_launches').get()).toEqual({ n: 1 });
    expect(getSessionMetadata(first.conversationId)).toMatchObject({ name: 'Greeting', agentId: 'main' });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const queued = getSessionInputById(first.conversationId, first.inputId)!;
    expect(queued).toMatchObject({ content: 'hello', origin: { type: 'conversation', launchId: first.launchId } });
    finish!();
    await vi.waitFor(() => expect(getSessionInputById(first.conversationId, first.inputId)?.status).toBe('completed'));
    expect(listConversationLaunches(sourceId, [first.conversationId])[0]).toMatchObject({ status: 'completed', summary: '你好！' });
    const history = messagesToClientHistory(loadTranscriptRowsForSession(first.conversationId) as never);
    expect(history.find(row => row.role === 'user')?.metadata?.conversationOrigin).toEqual({ launchId: first.launchId, conversationId: sourceId, agentId: 'main' });
    appendTranscriptEntry(first.conversationId, { role: 'assistant', content: 'Later unrelated reply', timestamp: Date.now(), turnId: 'later' } as never);
    expect(listConversationLaunches(sourceId, [first.conversationId])[0]?.summary).toBe('你好！');
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
    expect((await create()).conversationId).toBe(first.conversationId);
    expect(messagesToClientHistory(loadTranscriptRowsForSession(first.conversationId) as never)[0]?.metadata?.conversationOrigin?.conversationId).toBe(sourceId);
    await expect(launchConversation(service, { ...args, prompt: 'different' }, context())).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    deleteSessionRecord(first.conversationId);
    await expect(create()).rejects.toMatchObject({ code: 'SESSION_DELETED' });
    expect(listConversationLaunches(sourceId, [first.conversationId])[0]?.status).toBe('unavailable');
  });

  it('validates project selection, previews without writes, and wakes preparation for a workspace project', async () => {
    await expect(launchConversation(service, { prompt: 'hello', project: { kind: 'project', projectId: 'missing-project' } }, context())).rejects.toThrow('Project not found');
    expect(await launchConversation(service, args, { ...context(), dryRun: true })).toMatchObject({ dryRun: true });
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM conversation_launches').get()).toEqual({ n: 0 });
    const project = projects.create({ name: 'Project', workspaceRoot: dir, executionMode: 'managed_worktree' });
    projects.attachSession(sourceId, project.id);
    const result = await launchConversation(service, { prompt: 'hello', project: { kind: 'current' } }, context());
    if (!('conversationId' in result)) throw new Error('Expected launch');
    expect(getSessionMetadata(result.conversationId)?.projectId).toBe(project.id);
    expect(getSessionPreparation(result.conversationId)?.creation.execution).toEqual({ mode: 'managed_worktree' });
    expect(service.sessionPreparations.wake).toHaveBeenCalledWith(result.conversationId);
    expect(getSessionInputById(result.conversationId, result.inputId)?.status).toBe('queued');
  });

  it('creates and runs a projectless conversation when the tool omits project in a projectless source', async () => {
    const tool = createXopcUseTool({ getCurrentConversationId: () => sourceId,
      launchConversation: (input, ctx) => launchConversation(service, input, ctx) });
    const output = await tool.execute('projectless-default', { mode: 'conversation', command: 'create', args: { prompt: 'hello' } });
    const result = output.details.result as ConversationLaunchView;
    expect(result.conversationId).toBeTypeOf('string');
    expect(getSessionMetadata(result.conversationId)?.projectId).toBeUndefined();
    expect(getSessionPreparation(result.conversationId)).toBeUndefined();
    expect(output.details.delivery?.primary).toMatchObject({ kind: 'session', id: result.conversationId });
    expect(output.details.delivery?.primary?.projectId).toBeUndefined();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    finish!();
    await vi.waitFor(() => expect(listConversationLaunches(sourceId, [result.conversationId])[0]).toMatchObject({ status: 'completed', summary: '你好！' }));
    expect(service.sessionPreparations.wake).not.toHaveBeenCalled();
  });

  it('creates a projectless conversation from a project source when kind none is explicit', async () => {
    const project = projects.create({ name: 'Project', workspaceRoot: dir, executionMode: 'managed_worktree' });
    projects.attachSession(sourceId, project.id);
    const result = await create();
    expect(getSessionMetadata(sourceId)?.projectId).toBe(project.id);
    expect(getSessionMetadata(result.conversationId)?.projectId).toBeUndefined();
    expect(getSessionPreparation(result.conversationId)).toBeUndefined();
    expect(service.sessionPreparations.wake).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  });

  it('recovers a committed input after a lost dispatch and database restart', async () => {
    service.withSessionInputSubmission = async (_id, operation) => operation();
    service.drainSessionInputs = vi.fn(async () => {});
    const first = await create();
    expect(getSessionInputById(first.conversationId, first.inputId)?.status).toBe('queued');
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
    coordinator.recover();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    finish!();
    await vi.waitFor(() => expect(listConversationLaunches(sourceId, [first.conversationId])[0]).toMatchObject({ status: 'completed', summary: '你好！' }));
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM conversation_launches').get()).toEqual({ n: 1 });
  });

  it('preserves the requested text and does not inherit the source transcript', async () => {
    service.withSessionInputSubmission = async (_id, operation) => operation();
    service.drainSessionInputs = vi.fn(async () => {});
    appendTranscriptEntry(sourceId, { role: 'user', content: 'Private parent context', timestamp: Date.now() } as never);
    const result = await launchConversation(service, { ...args, prompt: ' hello\n' }, context());
    if (!('conversationId' in result)) throw new Error('Expected launch');
    expect(getSessionInputById(result.conversationId, result.inputId)?.content).toBe(' hello\n');
    expect(loadTranscriptRowsForSession(result.conversationId)).toEqual([]);
  });

  it('bounds launches per turn and recursion without leaving orphan conversations', async () => {
    service.withSessionInputSubmission = async (_id, operation) => operation();
    service.drainSessionInputs = vi.fn(async () => {});
    for (let i = 0; i < 3; i++) {
      await launchConversation(service, args, { ...context(`bounded-${i}`), sourceRunId: 'one-run' });
    }
    await expect(launchConversation(service, args, { ...context('fourth'), sourceRunId: 'one-run' })).rejects.toThrow('Turn conversation launch limit');
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 4 });
    let ancestor = sourceId;
    for (let i = 0; i < 3; i++) {
      const launched = await launchConversation(service, args, { ...context(`depth-${i}`), sourceConversationId: ancestor });
      if (!('conversationId' in launched)) throw new Error('Expected launch');
      ancestor = launched.conversationId;
    }
    await expect(launchConversation(service, args, { ...context('too-deep'), sourceConversationId: ancestor })).rejects.toThrow('depth limit');
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 7 });
    // A fresh user turn in the third conversation is not automatic recursive delegation.
    const manual = await launchConversation(service, args, { ...context('human-request'), sourceConversationId: ancestor, sourceRunId: 'human-run' });
    expect(manual).toHaveProperty('conversationId');
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 8 });
  });

  it('rolls back the target and input when acceptance fails, and returns a structured card through xopc_use', async () => {
    const prepare = service.prepareSessionCommandInput.bind(service);
    service.prepareSessionCommandInput = async input => {
      const prepared = await prepare(input);
      resetSessionRecord(sourceId, '');
      return prepared;
    };
    // Resetting the source during preparation must not leave an orphan target.
    await expect(create()).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 1 });
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM session_inputs').get()).toEqual({ n: 0 });
    service.prepareSessionCommandInput = prepare;
    const tool = createXopcUseTool({ getCurrentConversationId: () => sourceId,
      launchConversation: (input, ctx) => launchConversation(service, input, ctx) });
    const output = await tool.execute('tool-card', { mode: 'conversation', command: 'create', args });
    expect(output.details.delivery).toMatchObject({ operation: 'created', primary: { kind: 'session', title: 'Greeting', capabilities: ['open'] } });
    expect((output.details.result as ConversationLaunchView).conversationId).toBe(output.details.delivery?.primary?.id);
    const denied = createXopcUseTool({ getCurrentConversationId: () => sourceId, authorizeCapability: () => false,
      launchConversation: vi.fn() });
    expect((await denied.execute('denied', { mode: 'conversation', command: 'create', args })).details.result).toMatchObject({ ok: false });
  });

  it('serves batch results and provenance through a listening authenticated Gateway and rejects forged origins', async () => {
    const first = await create();
    const app = createHonoApp({ service });
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    try {
      if (!server.listening) await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing listener');
      const base = `http://127.0.0.1:${address.port}`;
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const path = `/api/sessions/${sourceId}/launched-conversations?ids=${first.conversationId}`;
      expect((await fetch(base + path)).status).toBe(401);
      const results = await fetch(base + path, { headers });
      expect(results.status).toBe(200);
      expect(await results.json()).toMatchObject({ items: [{ conversationId: first.conversationId }] });
      const originPath = `/api/sessions/${first.conversationId}/launch-origin?launchId=${first.launchId}`;
      expect(await (await fetch(base + originPath, { headers })).json()).toMatchObject({ available: true, conversationId: sourceId });
      const wrong = await fetch(base + `/api/sessions/${sourceId}/launch-origin?launchId=${first.launchId}`, { headers });
      expect(wrong.status).toBe(404);
      const forged = await fetch(base + `/api/sessions/${randomUUID()}/inputs`, { method: 'POST', headers, body: JSON.stringify({
        kind: 'start', clientMessageId: 'forged', creation: { agentId: 'main', projectId: null, execution: null, temporary: false, model: 'test/model', thinkingLevel: 'off' },
        input: { content: 'hello' }, origin: { type: 'conversation', launchId: first.launchId },
      }) });
      expect(forged.status).toBe(403);
      deleteSessionRecord(sourceId);
      expect(await (await fetch(base + originPath, { headers })).json()).toMatchObject({ available: false });
    } finally {
      await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    }
  });
});
