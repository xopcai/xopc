import { EndpointRegistry } from '../../endpoint-tools/registry.js';
import { EndpointContextStore } from '../../endpoint-tools/context-store.js';
import { createEndpointPrincipal } from '../../storage/sqlite/endpoint-principal-repository.js';
import { getSessionInputById } from '../../storage/sqlite/session-input-repository.js';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSessionMetadata, deleteSessionRecord } from '../../storage/sqlite/session-repository.js';
import { getSessionInputState } from '../../storage/sqlite/session-input-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { getSessionConfig } from '../../storage/sqlite/config-repository.js';
import { SessionInputCoordinator } from '../service/session-input-coordinator.js';
import { SessionPreparationWorker } from '../service/session-preparation-worker.js';
import { ProjectService } from '../../projects/project-service.js';
import { SessionEnvironmentService } from '../../execution-environments/session-environment-service.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

vi.mock('../../providers/index.js', async importOriginal => ({ ...await importOriginal<object>(), resolveModel: () => ({ id: 'model' }) }));
vi.mock('../../providers/model-thinking.js', () => ({ getModelThinking: () => ({ options: ['off'] }) }));
vi.mock('../../tui/tui-startup-resources.js', () => ({ collectTuiStartupResources: (_config: object, conversationId?: string, options?: { agentId?: string }) => ({
  context: [], skills: [], connectors: [], conversationId, agentId: options?.agentId,
}) }));
vi.mock('../../review/review-git.js', () => ({ resolveGitRoot: async (workspace: string) => workspace, buildReviewContext: async (workspace: string) => ({ workspace }) }));

it('receives strict first inputs through a listening authenticated Gateway, replays receipts and refuses resurrection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-command-http-'));
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
  seedTestAgentCatalog();
  const token = 'session-command-test-token';
  const registry = new EndpointRegistry();
  const contexts = new EndpointContextStore(registry);
  createEndpointPrincipal({ id: 'phone', kind: 'mobile', platform: 'ios', displayName: 'Phone', publicKey: 'fixture' });
  const hello = { principalId: 'phone', endpointId: 'ios:phone', connectionInstanceId: randomUUID(), displayName: 'Phone',
    kind: 'mobile' as const, platform: 'ios', appVersion: '1', availability: 'foreground' as const, nonce: 'nonce',
    signedAt: Date.now(), signature: 'fixture-signature', tools: [] };
  let registration = registry.register(hello, 'connection-1', { readyState: 1, send: () => {}, close: () => {} });
  contexts.heartbeat(hello.endpointId, { connectionEpoch: 'connection-1', sequence: 1, availability: 'foreground' });
  contexts.report(hello.endpointId, { version: 1, reportId: 'context-report', connectionEpoch: 'connection-1',
    sequence: 1, baseRevision: null, mode: 'full', capturedAt: Date.now(), values: { 'environment.timezone': 'Asia/Shanghai' } });
  let finish!: (value: { status: string; summary: string }) => void;
  const execute = vi.fn((_input: unknown) => new Promise<{ status: string; summary: string }>(resolve => { finish = resolve; }));
  const interrupt = vi.fn(async () => { finish({ status: 'aborted', summary: '' }); });
  const steer = vi.fn(async (_id: string, _content: string, _runId?: string, _options?: { onHandled?: () => void }) => true);
  const coordinator = new SessionInputCoordinator({
    prioritizeInput: () => true, interrupt, coalesceWindowMs: 5,
    sessionExists: async () => true, execute, emit: vi.fn(),
    prepareAttachments: async (_id, attachments) => attachments,
    prepareContexts: async () => [], steer,
  });
  const projects = new ProjectService();
  const service = {
    currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
    isGatewayReady: () => true, getExtensionLoader: () => null,
    projects,
    endpointTools: { registry, contexts },
    sessions: { getSession: async (id: string) => getSessionMetadata(id), getAgentConfig: async () => ({ model: 'test/model', thinkingLevel: 'off', fixedModel: true }) },
    getSessionInputState,
    controlSessionInputs: coordinator.control.bind(coordinator),
    emit: vi.fn(),
    withSessionInputSubmission: coordinator.withSubmission.bind(coordinator),
    prepareSessionCommandInput: coordinator.prepareInput.bind(coordinator),
    dispatchAcceptedSessionInput: coordinator.dispatchAcceptedInput.bind(coordinator),
    drainSessionInputs: coordinator.drain.bind(coordinator),
  } as unknown as GatewayService;
  const preparations = new SessionPreparationWorker(service);
  Object.assign(service, { sessionPreparations: preparations });
  const app = createHonoApp({ service });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing listener');
    const base = `http://127.0.0.1:${address.port}`;
    const id = randomUUID();
    const path = `/api/sessions/${id}/inputs`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const startup = await fetch(`${base}/api/tui/startup-resources?agentId=main`, { headers });
    expect(startup.status).toBe(200);
    expect((await startup.json()).payload).toMatchObject({ agentId: 'main' });
    const review = await fetch(`${base}/api/review/context?agentId=main`, { headers });
    expect(review.status, await review.clone().text()).toBe(200);
    expect(getSessionMetadata(id)).toBeNull();
    const firstPrompt = '/tmp inspect this folder';
    const command = { kind: 'start', clientMessageId: randomUUID(),
      creation: { agentId: 'main', projectId: null, execution: null, model: 'test/model', thinkingLevel: 'off', temporary: false, workingDirectory: dir },
      input: { content: firstPrompt, endpointContext: { version: 1, capturedAt: Date.now(), timezone: 'Asia/Shanghai', locale: 'zh-CN' } },
      origin: { type: 'endpoint', endpointId: hello.endpointId, token: registration.turnToken } };
    const post = (body: object, compact = false) => fetch(base + path + (compact ? '?view=compact' : ''), { method: 'POST', headers, body: JSON.stringify(body) });
    expect((await fetch(base + path, { method: 'POST', body: JSON.stringify(command) })).status).toBe(401);
    expect((await post({ content: 'old flat request', clientMessageId: 'old', delivery: 'next' })).status).toBe(400);
    expect((await fetch(`${base}/api/sessions`, { method: 'POST', headers, body: '{}' })).status).toBe(404);
    expect((await post({ ...command, creation: { ...command.creation, workingDirectory: '/' } })).status).toBe(400);
    expect(getSessionMetadata(id)).toBeNull();
    const accepted = await post(command, true);
    expect(accepted.status, await accepted.clone().text()).toBe(202);
    expect(getSessionConfig(id)?.workingDirectoryOverride).toBe(dir);
    const first = await accepted.json();
    expect(first.payload.receipt.conversationId).toBe(id);
    expect(first.payload.session).toEqual({ key: id, transcriptId: first.payload.receipt.transcriptId });
    const frozen = getSessionInputById(id, first.payload.receipt.inputId)!;
    expect(frozen.contextSnapshots).toEqual([expect.objectContaining({ kind: 'device_context', sourceId: hello.endpointId, title: 'Phone' })]);
    expect(JSON.parse(frozen.contextSnapshots![0].text).taskContext.fields['environment.timezone'])
      .toMatchObject({ status: 'fresh', value: 'Asia/Shanghai' });
    expect(JSON.stringify(frozen)).not.toContain(registration.turnToken);
    registration = registry.register(hello, 'connection-2', { readyState: 1, send: () => {}, close: () => {} });
    command.origin.token = registration.turnToken;
    const replay = await (await post(command)).json();
    expect(replay.payload.receipt).toEqual(first.payload.receipt);
    expect(replay.payload.session).toMatchObject({ key: id, agentId: 'main', transcriptId: first.payload.receipt.transcriptId });
    expect(getSessionInputState(id).inputs).toHaveLength(1);
    expect((await post({ ...command, input: { ...command.input, endpointContext: { ...command.input.endpointContext, timezone: 'UTC' } } })).status).toBe(409);
    const rename = await fetch(`${base}/api/endpoint-tools/devices/phone`, { method: 'PATCH', headers, body: JSON.stringify({ nickname: 'My phone', expectedRevision: 0 }) });
    expect(rename.status, await rename.clone().text()).toBe(200);
    expect((await rename.json()).payload).toMatchObject({ nickname: 'My phone', revision: 1 });
    expect((await fetch(`${base}/api/endpoint-tools/devices/phone`, { method: 'PATCH', headers, body: JSON.stringify({ nickname: 'Stale', expectedRevision: 0 }) })).status).toBe(409);
    expect(frozen.contextSnapshots![0]!.title).toBe('Phone');
    expect((await post({ ...command, input: { content: 'changed' } })).status).toBe(409);
    const receiptPath = `${base}/api/sessions/${id}/input-receipts/${command.clientMessageId}`;
    expect((await fetch(receiptPath, { headers })).status).toBe(200);
    const compactReceipt = await fetch(receiptPath + '?view=compact', { headers });
    expect(compactReceipt.status).toBe(200);
    expect((await compactReceipt.json()).payload).toMatchObject({
      receipt: first.payload.receipt,
      session: first.payload.session,
    });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute.mock.calls[0]![0]).toMatchObject({ content: firstPrompt });
    const configVersion = (getSqliteDatabase().prepare('SELECT updated_at FROM session_config WHERE conversation_id = ?').get(id) as { updated_at: number } | undefined)?.updated_at ?? 0;
    const append = { kind: 'append', clientMessageId: randomUUID(),
      expectedTranscriptId: getSessionMetadata(id)!.transcriptId, configVersion, delivery: 'next',
      input: { content: 'Just the cost' }, origin: command.origin };
    expect((await post({ ...append, configVersion: configVersion + 1 })).status).toBe(409);
    expect(interrupt).not.toHaveBeenCalled();
    const initialRunId = coordinator.snapshot(id).activeRunId;
    const steering = ['Keep it short', 'Use a table'].map(content => ({ ...append, clientMessageId: randomUUID(),
      delivery: 'steer', interrupt: false, input: { content } }));
    for (const command of steering) {
      const response = await post(command, true);
      expect(response.status, await response.clone().text()).toBe(202);
      expect((await response.json()).payload).toMatchObject({ effectiveDelivery: 'steer', inputState: { activeRunId: initialRunId } });
    }
    expect(steer.mock.calls.map(([, , runId, options]) => [runId, options?.onHandled && true])).toEqual([
      [initialRunId, true], [initialRunId, true],
    ]);
    expect(coordinator.snapshot(id).inputs.filter(input => input.status === 'injecting').map(input => input.content))
      .toEqual(['Keep it short', 'Use a table']);
    expect(interrupt).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
    for (const [, , , options] of steer.mock.calls) options?.onHandled?.();
    const deferred = { ...append, clientMessageId: randomUUID(), interrupt: false, input: { content: 'Later' } };
    expect((await post(deferred)).status).toBe(202);
    expect(interrupt).not.toHaveBeenCalled();
    const priority = await post(append);
    expect(priority.status, await priority.clone().text()).toBe(202);
    expect((await post(append)).status).toBe(202);
    expect(interrupt).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1]![0]).toMatchObject({ content: 'Just the cost' });
    finish({ status: 'ok', summary: '' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    expect(execute.mock.calls[2]![0]).toMatchObject({ content: 'Later' });
    finish({ status: 'ok', summary: '' });
    await vi.waitFor(() => expect(coordinator.snapshot(id).activeRunId).toBeUndefined());
    // Exercise the lazy authenticated control route through the listening server.
    const active = { ...deferred, clientMessageId: randomUUID(), input: { content: 'Active before stop' } };
    expect((await post(active)).status).toBe(202);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(4));
    expect((await post({ ...deferred, clientMessageId: randomUUID(), input: { content: 'Keep paused' } })).status).toBe(202);
    const stop = { operationId: randomUUID(), action: 'stop', expectedTranscriptId: append.expectedTranscriptId,
      expectedVersion: coordinator.snapshot(id).control.version };
    const controlPath = `${base}/api/sessions/${id}/input-control`;
    expect((await fetch(controlPath, { method: 'POST', body: JSON.stringify(stop) })).status).toBe(401);
    const controlPost = (body: object) => fetch(controlPath, { method: 'POST', headers, body: JSON.stringify(body) });
    const stopped = await controlPost(stop);
    expect(stopped.status, await stopped.clone().text()).toBe(200);
    expect((await stopped.json()).payload.control).toMatchObject({ paused: true, phase: 'idle' });
    expect(execute).toHaveBeenCalledTimes(4);
    expect(coordinator.snapshot(id).inputs).toMatchObject([{ content: 'Keep paused', status: 'queued' }]);
    expect((await controlPost(stop)).status).toBe(200);
    expect((await controlPost({ ...stop, operationId: randomUUID(), action: 'resume', onlyIfEmpty: true,
      expectedVersion: coordinator.snapshot(id).control.version })).status).toBe(409);
    expect((await controlPost({ ...stop, operationId: randomUUID(), action: 'resume' })).status).toBe(409);
    const single = { ...deferred, clientMessageId: randomUUID(), input: { content: 'Only this input' },
      execution: 'single', controlVersion: coordinator.snapshot(id).control.version };
    expect((await post(single)).status).toBe(202);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(5));
    expect(execute.mock.calls[4]![0]).toMatchObject({ content: 'Only this input' });
    finish({ status: 'ok', summary: '' });
    await vi.waitFor(() => expect(coordinator.snapshot(id).activeRunId).toBeUndefined());
    expect(execute).toHaveBeenCalledTimes(5);
    expect((await controlPost({ ...stop, operationId: randomUUID(), action: 'resume',
      expectedVersion: coordinator.snapshot(id).control.version })).status).toBe(200);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(6));
    finish({ status: 'ok', summary: '' });
    await vi.waitFor(() => expect(coordinator.snapshot(id).activeRunId).toBeUndefined());
    const emptyPause = { ...stop, operationId: randomUUID(), action: 'pause',
      expectedVersion: coordinator.snapshot(id).control.version };
    expect((await controlPost(emptyPause)).status).toBe(200);
    const cleaned = await controlPost({ ...emptyPause, operationId: randomUUID(), action: 'resume', onlyIfEmpty: true,
      expectedVersion: coordinator.snapshot(id).control.version });
    expect(cleaned.status).toBe(200);
    expect((await cleaned.json()).payload.control.paused).toBe(false);
    deleteSessionRecord(id);
    expect((await post(command)).status).toBe(410);
    expect((await fetch(receiptPath, { headers })).status).toBe(410);

    const workspaceRoot = join(dir, 'project');
    mkdirSync(workspaceRoot);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: workspaceRoot, stdio: 'pipe' });
    git('init');
    const file = join(workspaceRoot, 'draft.txt');
    writeFileSync(file, 'committed');
    git('add', 'draft.txt');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'Initial');
    writeFileSync(file, 'uncommitted');
    const project = projects.create({ name: 'Worktree project', workspaceRoot, executionMode: 'managed_worktree' });
    const projectConversationId = randomUUID();
    const projectSession = `${base}/api/sessions/${projectConversationId}`;
    const projectPost = (suffix: string, body: object) => fetch(projectSession + suffix, { method: 'POST', headers, body: JSON.stringify(body) });
    const firstProjectInput = { ...command, creation: { ...command.creation, projectId: project.id,
      execution: { mode: 'managed_worktree' }, workingDirectory: undefined }, input: { content: 'Project message' } };
    const projectAccepted = await projectPost('/inputs', firstProjectInput);
    expect(projectAccepted.status, await projectAccepted.clone().text()).toBe(202);
    const projectReceipt = (await projectAccepted.json()).payload.receipt;
    await preparations.stop();
    const projectQueue = await fetch(projectSession + '/input-state', { headers });
    expect(projectQueue.status).toBe(200);
    const failed = (await projectQueue.json()).payload;
    expect(failed.preparation).toMatchObject({ state: 'preparation_failed', executionMode: 'managed_worktree',
      lastError: expect.stringContaining('Repository has uncommitted changes:') });
    expect(failed.inputs).toMatchObject([{ id: projectReceipt.inputId, content: 'Project message', status: 'queued' }]);
    expect(execute).toHaveBeenCalledTimes(6);
    const useProjectFolder = { operationId: failed.preparation.operationId, expectedRevision: failed.preparation.revision,
      idempotencyKey: randomUUID(), executionMode: 'local_checkout' };
    const recovered = await projectPost('/preparation/retry', useProjectFolder);
    expect(recovered.status, await recovered.clone().text()).toBe(202);
    expect((await projectPost('/preparation/retry', useProjectFolder)).status).toBe(202);
    expect((await projectPost('/preparation/retry', { ...useProjectFolder, idempotencyKey: randomUUID() })).status).toBe(409);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(7));
    expect(execute.mock.calls[6]![0]).toMatchObject({ content: 'Project message' });
    expect(coordinator.snapshot(projectConversationId).inputs).toMatchObject([{ id: projectReceipt.inputId, status: 'running' }]);
    expect(new SessionEnvironmentService().get(projectConversationId)).toMatchObject({ kind: 'local_checkout', projectId: project.id });
    expect(projects.get(project.id)?.executionMode).toBe('managed_worktree');
    expect(readFileSync(file, 'utf8')).toBe('uncommitted');
    finish({ status: 'ok', summary: '' });
    await vi.waitFor(() => expect(coordinator.snapshot(projectConversationId).activeRunId).toBeUndefined());

    const defaultConversationId = randomUUID();
    const defaultProjectInput = { ...firstProjectInput, creation: { ...firstProjectInput.creation, execution: null } };
    const submitDefault = () => fetch(`${base}/api/sessions/${defaultConversationId}/inputs`, {
      method: 'POST', headers, body: JSON.stringify(defaultProjectInput),
    });
    const localAccepted = await submitDefault();
    expect(localAccepted.status, await localAccepted.clone().text()).toBe(202);
    const localReceipt = (await localAccepted.json()).payload.receipt;
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(8));
    expect(new SessionEnvironmentService().get(defaultConversationId)).toMatchObject({
      kind: 'local_checkout', projectId: project.id, rootPath: project.workspaceRoot,
    });
    const replayedLocal = await submitDefault();
    expect(replayedLocal.status, await replayedLocal.clone().text()).toBe(202);
    expect((await replayedLocal.json()).payload.receipt.inputId).toBe(localReceipt.inputId);
    expect(readFileSync(file, 'utf8')).toBe('uncommitted');
    finish({ status: 'ok', summary: '' });
    await vi.waitFor(() => expect(coordinator.snapshot(defaultConversationId).activeRunId).toBeUndefined());
    expect(execute).toHaveBeenCalledTimes(8);

    // Direct non-Project conversation with an external runtime agent is accepted using its default workspace.
    new AgentCatalogRepository().create({
      id: 'codex',
      enabled: true,
      execution: { kind: 'codex' },
      profile: { name: 'Codex' },
    }, { ready: true });
    const directExternalConversationId = randomUUID();
    const directExternalAccepted = await fetch(`${base}/api/sessions/${directExternalConversationId}/inputs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...command,
        clientMessageId: randomUUID(),
        creation: {
          agentId: 'codex',
          projectId: null,
          execution: null,
          model: 'codex',
          thinkingLevel: 'medium',
          temporary: false,
        },
        input: { content: 'Direct external chat without a project' },
      }),
    });
    expect(directExternalAccepted.status, await directExternalAccepted.clone().text()).toBe(202);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(9));
    expect(getSessionMetadata(directExternalConversationId)?.agentId).toBe('codex');
    finish({ status: 'ok', summary: '' });
    await vi.waitFor(() => expect(coordinator.snapshot(directExternalConversationId).activeRunId).toBeUndefined());
    expect(execute).toHaveBeenCalledTimes(9);
  } finally {
    await preparations.stop();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
