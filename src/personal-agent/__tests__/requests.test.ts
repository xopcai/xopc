import Ajv from 'ajv';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api, Model } from '@earendil-works/pi-ai';

import { seedTestDatabase } from '../../../test/sqlite-fixture.js';
import * as providers from '../../providers/index.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { deleteSessionRecord, getSessionMetadata, patchSessionMetadata, resetSessionRecord } from '../../storage/sqlite/session-repository.js';
import { claimNextSessionInput, insertSessionInput, finishSessionInputRun } from '../../storage/sqlite/session-input-repository.js';
import { cancelConnectionObjective, requireSessionConnection, getActiveConnectionWait, getConnectionWait, queueConnectionResolution, updateConnectionWait } from '../../storage/sqlite/connection-wait-repository.js';
import { upsertConnectorConnection, upsertConnectorInstallation, upsertConnectorActionMetadata } from '../../storage/sqlite/connector-repository.js';
import { TaskConversationRepository } from '../../tasks/task-conversation-repository.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskApplicationService } from '../../tasks/task-application-service.js';
import { TaskRunCoordinator } from '../../tasks/task-run-coordinator.js';
import { cancelPersonalTask } from '../task-cancel.js';
import { TaskAllocationDispatcher } from '../../tasks/task-allocation-service.js';
import { TaskAllocationRepository } from '../../tasks/task-allocation-repository.js';
import { TaskRunDispatcher } from '../../tasks/task-run-dispatcher.js';
import { ConnectionRecoveryService } from '../../connectors/connection-recovery-service.js';
import type { ComposioSessionsAdapter } from '../../connectors/composio-sessions.js';
import { TaskCollaborationRepository } from '../../tasks/task-collaboration-repository.js';
import { TaskCollaborationDelivery } from '../../tasks/task-collaboration-delivery.js';
import { buildTaskExecutionDirective } from '../../tasks/task-context-assembler.js';
import { createTaskCollaborationTool } from '../../agent/tools/task-collaboration-tool.js';
import { TaskMainUpdateDelivery } from '../../tasks/task-main-update-delivery.js';
import { createPersonalRequestTools } from '../../agent/tools/personal-request-tool.js';
import { createPersonalRequestResultTool } from '../../agent/tools/personal-request-result-tool.js';
import { resolveExecutionToolPolicy } from '../../agent/embedded/execution-tool-policy.js';
import { ComposioToolProvider } from '../../agent/external-tools/composio-provider.js';
import { assertPersonalRequestAccountAccess } from '../request-access.js';
import { createExternalToolGatewayTools } from '../../agent/external-tools/gateway-tools.js';
import type { ExternalToolProvider } from '../../agent/external-tools/types.js';
import { loadTranscriptRowsForSession } from '../../storage/sqlite/transcript-repository.js';
import { buildSessionContextForLlm } from '../../session/session-context-for-llm.js';
import { transcriptRowsToClientHistory } from '../../session/client-history.js';
import { createHonoApp } from '../../gateway/hono/app.js';
import { ConfigSchema } from '../../config/schema.js';
import type { GatewayService } from '../../gateway/service.js';
import { personalAgentId, personalConversationId } from '../repository.js';
import { AgentSelectionRepository } from '../../agent-matching/selection-repository.js';
import { personalCapabilities } from '../capability-service.js';
import { submitPersonalRequest, resolvePersonalRequestConnection, cancelPersonalRequest, requirePersonalWorkerConnection } from '../request-service.js';
import { getPersonalRequest, listPersonalRequests } from '../request-repository.js';
import { drainPersonalRequestContinuations, drainPersonalRequestResults } from '../request-delivery.js';
import * as resultReader from '../result-reader.js';
import { TaskResultDeliveryService } from '../../tasks/task-result-delivery-service.js';
import { PersonalReplyComposer } from '../reply-composer.js';
import { acquireEmbeddedRunLease } from '../../agent/embedded/runs.js';
import { SessionInputCoordinator } from '../../gateway/service/session-input-coordinator.js';
import { createPersonalTaskTool } from '../../agent/tools/personal-task-tool.js';
import { GatewayAgentRunner } from '../../gateway/service/agent-runner.js';

describe('Personal connected-app requests', () => {
  let directory: string;
  let conversationId: string;
  let agentId: string;
  beforeEach(() => {
    vi.spyOn(resultReader, 'warmPersonalResult').mockImplementation(() => {});
    directory = mkdtempSync(join(tmpdir(), 'xopc-personal-request-'));
    vi.stubEnv('XOPC_STATE_DIR', directory);
    vi.stubEnv('XOPC_LOG_LEVEL', 'silent');
    resetXopcDatabaseSingletonForTest();
    seedTestDatabase(join(directory, 'xopc.db'));
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    vi.spyOn(providers, 'resolveModel').mockReturnValue({ provider: 'openai', id: 'test', api: 'openai-responses' } as Model<Api>);
    vi.spyOn(providers, 'isProviderConfiguredSync').mockReturnValue(true);
    const catalog = new AgentCatalogRepository();
    catalog.ensureInitialized();
    agentId = personalAgentId('local-owner');
    conversationId = personalConversationId('local-owner');
    catalog.create({ id: agentId, profile: { name: 'Ada' }, toolAllowlist: ['personal_task', 'personal_request', 'personal_capability'] }, { ready: true });
    catalog.create({ id: 'mail-worker', profile: { name: 'Mail worker' },
      toolAllowlist: ['xopc_tool_search', 'xopc_tool_describe', 'xopc_tool_execute'] }, { ready: true });
    createConversation({ agentId, sourceChannel: 'webchat', customData: { personalAgent: true } }, '', conversationId);
    insertSessionInput({ id: 'origin', conversationId, clientMessageId: 'origin', requestedDelivery: 'next', effectiveDelivery: 'next',
      status: 'queued', content: '查一下最近的重要邮件', origin: { type: 'endpoint', endpointId: 'test' } });
    claimNextSessionInput(conversationId, 'main-run');
  });
  afterEach(async () => {
    await resultReader.stopPersonalResultPreparations();
    vi.restoreAllMocks();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });
  const installation = () => upsertConnectorInstallation({ id: 'composio-gmail-local-owner', connectorId: 'composio-gmail',
    principalId: 'local-owner', enabled: true, allowedAgentIds: [], maxScope: 'write', confirmationPolicy: 'writes', selectedAccountIds: null });
  const connection = (id = 'gmail-work') => {
    installation();
    return upsertConnectorConnection({ id, connectorId: 'composio-gmail', provider: 'composio', principalId: 'local-owner',
      providerConnectionId: id, status: 'active', identity: { email: `${id}@example.test` }, isDefault: false, metadata: {} });
  };
  const submit = (accountId?: string) => submitPersonalRequest({ conversationId, connectorId: 'composio-gmail', agentId: 'mail-worker',
    objective: '查一下最近的重要邮件，给出需要回复的事项', accountId, idempotencyKey: 'request-1',
    timeRange: { from: '2026-10-01T00:00:00+08:00', to: '2026-10-08T00:00:00+08:00', timezone: 'Asia/Shanghai', expression: '最近一周' } });

  it('requires a complete brief in model submissions and returns a compact acknowledgement', async () => {
    connection();
    const tool = createPersonalRequestTools({ getCurrentConversationId: () => conversationId }).find(tool => tool.name === 'personal_request')!;
    const validate = new Ajv({ strict: false }).compile(tool.parameters);
    expect(validate({ command: 'submit', connectorId: 'composio-gmail', objective: 'Summarize mail' })).toBe(false);
    const description = 'Preserve this complete staged requirement. '.repeat(80) + 'FINAL_REQUIREMENT';
    const input = { command: 'submit', connectorId: 'composio-gmail', objective: 'Summarize mail', description };
    expect(validate(input)).toBe(true);
    const first = JSON.parse((await tool.execute('submit', input)).content[0].text);
    await tool.execute('uncertain-retry', input);
    expect(first).not.toHaveProperty('requiresSpecialist');
    expect(first).not.toHaveProperty('truncated');
    expect(first.parameters).not.toHaveProperty('brief');
    expect(listPersonalRequests(conversationId)).toHaveLength(1);
    expect(new TaskRepository().require(first.taskId).body).toContain('FINAL_REQUIREMENT');
  });

  it('preserves the complete staged brief separately from its short objective', () => {
    connection();
    const description = 'First ask for the label and stop; after the answer confirm it and apply later instructions.';
    const request = submitPersonalRequest({ conversationId, connectorId: 'composio-gmail', objective: 'Summarize mail',
      description, agentId: 'mail-worker', idempotencyKey: 'complete-brief' });
    expect(request.parameters.brief).toBe(description);
    expect(new TaskRepository().require(request.taskId!).body).toContain(description);
    expect(() => submitPersonalRequest({ conversationId, connectorId: 'composio-gmail', objective: 'Summarize mail',
      description: 'Changed brief', agentId: 'mail-worker', idempotencyKey: 'complete-brief' })).toThrow('Idempotency');
  });

  it('preflights locally and starts one task for an already connected account', () => {
    expect(personalCapabilities(conversationId, 'gmail')[0].status).toBe('needs_connection');
    const account = connection();
    expect(personalCapabilities(conversationId, 'gmail')[0]).toMatchObject({ status: 'ready', executorAgentIds: ['mail-worker'] });
    const request = submit();
    expect(request).toMatchObject({ state: 'queued', accountId: account.accountId });
    const task = new TaskRepository().get(request.taskId!);
    expect(task?.body).toContain(request.objective);
    expect(task?.body).toContain('## Result for the originating conversation');
    expect(task?.body).toContain('Never substitute a progress page');
    expect(task?.body).toContain('call personal_request_result');
    expect(submit().taskId).toBe(request.taskId);
    expect(listPersonalRequests(conversationId)).toHaveLength(1);
    const choices = new AgentSelectionRepository().list(conversationId, { requestId: request.requestId });
    expect(choices).toHaveLength(2);
    expect(choices.every(choice => choice.taskId === request.taskId)).toBe(true);
    expect(choices.find(choice => choice.taskRunId)?.assessment.checks).toContainEqual(expect.objectContaining({ condition: 'connector', state: 'verified' }));
    expect(() => submitPersonalRequest({ conversationId, connectorId: 'composio-gmail', agentId: 'mail-worker', objective: 'different', idempotencyKey: 'request-1' })).toThrow('Idempotency');
  });

  it('submits without foreground executor selection and assigns within account permissions', async () => {
    connection();
    const catalog = new AgentCatalogRepository();
    catalog.create({ id: 'other-mail-worker', profile: { name: 'Other mail worker' },
      toolAllowlist: ['xopc_tool_search', 'xopc_tool_describe', 'xopc_tool_execute'] }, { ready: true });
    const accountId = personalCapabilities(conversationId, 'gmail')[0].accounts[0].accountId;
    getSqliteDatabase().prepare('UPDATE connector_accounts SET allowed_agent_ids_json = ? WHERE id = ?')
      .run(JSON.stringify([agentId, 'mail-worker']), accountId);
    const request = submitPersonalRequest({ conversationId, connectorId: 'composio-gmail', objective: '查一下重要邮件', idempotencyKey: 'auto-request' });
    expect(request.parameters.allocate).toBe(true);
    expect(new TaskRunRepository().listByTask(request.taskId!)).toHaveLength(0);
    const dispatch = new TaskAllocationDispatcher({ context: () => ({ ownAgentId: agentId,
      getAgentToolAvailability: (_id, name) => ({ condition: `tool:${name}`, state: 'verified', reasonCode: 'registered' }) }),
      wake: vi.fn(), decide: vi.fn(async ({ candidates }) => {
        expect(candidates.map(candidate => candidate.id)).toEqual(['mail-worker']);
        return { kind: 'select', agentId: 'mail-worker', reason: 'Authorized mail specialist' };
      }) });
    await dispatch.drain();
    expect(getPersonalRequest(request.requestId)?.executorAgentId).toBe('mail-worker');
    expect(new TaskRunRepository().listByTask(request.taskId!)).toHaveLength(1);
    expect(new AgentSelectionRepository().list(conversationId, { requestId: request.requestId })).toHaveLength(1);
  });

  it('blocks background assignment if account authorization is revoked after submission', async () => {
    const connected = connection();
    const request = submitPersonalRequest({ conversationId, connectorId: 'composio-gmail', objective: '查一下重要邮件', idempotencyKey: 'revoked-auto' });
    getSqliteDatabase().prepare('UPDATE connector_accounts SET enabled = 0 WHERE id = ?').run(connected.accountId);
    await new TaskAllocationDispatcher({ context: () => ({ ownAgentId: agentId,
      getAgentToolAvailability: (_id, name) => ({ condition: `tool:${name}`, state: 'verified', reasonCode: 'registered' }) }), wake: vi.fn() }).drain();
    expect(new TaskAllocationRepository().summary(request.taskId!)?.status).toBe('blocked');
    expect(new TaskRunRepository().listByTask(request.taskId!)).toHaveLength(0);
  });

  it('rechecks account permission after the router decision before starting any executor', async () => {
    const connected = connection();
    new AgentCatalogRepository().create({ id: 'second-mail-worker', profile: { name: 'Second mail worker' },
      toolAllowlist: ['xopc_tool_search', 'xopc_tool_describe', 'xopc_tool_execute'] }, { ready: true });
    const request = submitPersonalRequest({ conversationId, connectorId: 'composio-gmail', objective: '查看邮件', idempotencyKey: 'revoke-during-routing' });
    const decide = vi.fn(async () => {
      getSqliteDatabase().prepare('UPDATE connector_accounts SET enabled = 0 WHERE id = ?').run(connected.accountId);
      return { kind: 'select' as const, agentId: 'mail-worker', reason: 'Mail expertise' };
    });
    await new TaskAllocationDispatcher({ context: () => ({ ownAgentId: agentId,
      getAgentToolAvailability: (_id, name) => ({ condition: `tool:${name}`, state: 'verified', reasonCode: 'registered' }) }), decide, wake: vi.fn() }).drain();
    expect(decide).toHaveBeenCalledOnce();
    expect(new TaskRunRepository().listByTask(request.taskId!)).toHaveLength(0);
    expect(new TaskAllocationRepository().summary(request.taskId!)?.status).toBe('blocked');
  });

  it('cancels and replays a connected request through the actual Personal tool', async () => {
    connection();
    const request = submit();
    const tool = createPersonalRequestTools({ getCurrentConversationId: () => conversationId }).find(tool => tool.name === 'personal_request')!;
    const result = await tool.execute('cancel-request-tool', { command: 'cancel', requestId: request.requestId });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ state: 'cancelled', executionStopConfirmed: true });
    expect(getPersonalRequest(request.requestId)?.state).toBe('cancelled');
    const replay = await tool.execute('cancel-request-replay', { command: 'cancel', requestId: request.requestId });
    expect(JSON.parse((replay.content[0] as { text: string }).text)).toMatchObject({ state: 'cancelled', executionStopConfirmed: true });
  });

  it('persists request cancellation after the task control plane has already cancelled its run', async () => {
    connection();
    const request = submit();
    await cancelPersonalTask(request.taskId!, conversationId, 'cancel-connected-run');
    expect(getPersonalRequest(request.requestId)?.state).toBe('queued');
    cancelPersonalRequest(request);
    expect(getPersonalRequest(request.requestId)?.state).toBe('cancelled');
  });

  it('keeps a Task cancellation key bound to its original Run after reopening and restarting', async () => {
    connection();
    const request = submit();
    const runs = new TaskRunRepository();
    const original = runs.getActiveRoot(request.taskId!)!;
    runs.createWait({ taskId: request.taskId!, taskRunId: original.id, kind: 'user_input', reason: 'Need an answer', condition: { type: 'connection', connectionWaitId: 'old-task-wait' } });
    await cancelPersonalTask(request.taskId!, conversationId, 'task-cancel-original');
    expect(runs.listActiveWaits(request.taskId!)).toHaveLength(0);
    await cancelPersonalTask(request.taskId!, conversationId, 'task-cancel-closed-retry');
    const tasks = new TaskApplicationService();
    expect(tasks.execute({ taskId: request.taskId!, expectedVersion: new TaskRepository().require(request.taskId!).version,
      actor: { kind: 'user' }, idempotencyKey: 'task-reopen', command: { type: 'reopen', phase: 'active' } }).ok).toBe(true);
    expect(tasks.execute({ taskId: request.taskId!, expectedVersion: new TaskRepository().require(request.taskId!).version,
      actor: { kind: 'user' }, idempotencyKey: 'task-restart', command: { type: 'start', executor: { kind: 'agent', agentId: 'mail-worker' } } }).ok).toBe(true);
    const next = new TaskRunRepository().getActiveRoot(request.taskId!)!;
    const before = new TaskRepository().require(request.taskId!);
    closeXopcDatabase();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    await cancelPersonalTask(request.taskId!, conversationId, 'task-cancel-original');
    await cancelPersonalTask(request.taskId!, conversationId, 'task-cancel-closed-retry');
    expect(new TaskRunRepository().getActiveRoot(request.taskId!)).toEqual(next);
    expect(new TaskRepository().require(request.taskId!)).toEqual(before);
  });

  it('cancels an unallocated connected request so the router cannot launch it', async () => {
    connection();
    const request = submitPersonalRequest({ conversationId, connectorId: 'composio-gmail', objective: '查一下重要邮件', idempotencyKey: 'cancel-auto' });
    cancelPersonalRequest(request);
    await new TaskAllocationDispatcher({ context: () => ({ ownAgentId: agentId }), wake: vi.fn() }).drain();
    expect(new TaskRepository().require(request.taskId!).resolution).toBe('cancelled');
    expect(new TaskRunRepository().listByTask(request.taskId!)).toHaveLength(0);
  });

  it('freezes an explicit seven-day default against the original input time', () => {
    connection();
    const input = { conversationId, connectorId: 'composio-gmail', agentId: 'mail-worker', objective: '查看重要邮件', idempotencyKey: 'default-range' };
    const request = submitPersonalRequest(input);
    const range = request.parameters.timeRange!;
    expect(range.expression).toContain('no time range specified');
    expect(Date.parse(range.to) - Date.parse(range.from)).toBe(7 * 24 * 60 * 60_000);
    expect(submitPersonalRequest(input).parameters.timeRange).toEqual(range);
  });

  it('preserves background routing when connection completes later', async () => {
    const request = submitPersonalRequest({ conversationId, connectorId: 'composio-gmail', objective: '查看邮件', idempotencyKey: 'connect-auto' });
    expect(request.state).toBe('waiting_connection');
    const account = connection();
    const wait = getActiveConnectionWait(conversationId)!;
    const ready = updateConnectionWait({ ...wait, needs: wait.needs.map(need => ({ ...need, accountId: account.accountId, connectionId: account.id })) }, wait.version);
    queueConnectionResolution(ready, 'continued', resolvePersonalRequestConnection);
    const resumed = getPersonalRequest(request.requestId)!;
    expect(resumed.parameters.allocate).toBe(true);
    expect(new TaskAllocationRepository().summary(resumed.taskId!)?.status).toBe('pending');
    expect(new TaskRunRepository().listByTask(resumed.taskId!)).toHaveLength(0);
    await new TaskAllocationDispatcher({ context: () => ({ ownAgentId: agentId,
      getAgentToolAvailability: (_id, name) => ({ condition: `tool:${name}`, state: 'verified', reasonCode: 'registered' }) }), wake: vi.fn() }).drain();
    expect(getPersonalRequest(request.requestId)?.executorAgentId).toBe('mail-worker');
    expect(new TaskRunRepository().listByTask(resumed.taskId!)).toHaveLength(1);
  });

  it('keeps authorization in the main chat and resumes without another main-model input', () => {
    const request = submit();
    expect(request.state).toBe('waiting_connection');
    expect(new AgentSelectionRepository().list(conversationId, { requestId: request.requestId })[0]?.status).toBe('pending_connection');
    expect(request.taskId).toBeUndefined();
    const account = connection();
    const wait = getActiveConnectionWait(conversationId)!;
    const ready = updateConnectionWait({ ...wait, needs: wait.needs.map(need => ({ ...need, accountId: account.accountId, connectionId: account.id })) }, wait.version);
    const resolved = queueConnectionResolution(ready, 'continued', resolvePersonalRequestConnection);
    expect(resolved.status).toBe('closed');
    const resumed = getPersonalRequest(request.requestId)!;
    expect(resumed).toMatchObject({ state: 'queued', accountId: account.accountId });
    expect(resumed.taskId).toBeTruthy();
    const choices = new AgentSelectionRepository().list(conversationId, { requestId: request.requestId });
    expect(choices).toHaveLength(2);
    expect(new Set(choices.map(choice => choice.decisionGroupId)).size).toBe(1);
    expect(getSqliteDatabase().prepare("SELECT COUNT(*) AS count FROM session_inputs WHERE kind = 'connection_resume'").get()).toMatchObject({ count: 0 });
    expect(() => queueConnectionResolution(ready, 'continued', resolvePersonalRequestConnection)).toThrow('WAIT_CHANGED');
  });

  it('automatically resumes after OAuth polling, immediately shows feedback and dispatches the worker', async () => {
    const request = submit();
    const config = ConfigSchema.parse({ connectors: { instances: { 'composio-gmail': {
      xopcConnector: { managed: true, connectorId: 'composio-gmail', enabled: true },
      runtime: { type: 'composio', role: 'toolkit', toolkit: 'gmail' },
    } } } });
    installation();
    const notify = vi.fn();
    const recovery = new ConnectionRecoveryService({ getConfig: () => config,
      saveConfig: async () => ({ saved: true }), drain: vi.fn(), onPersonalRequestDelivered: notify,
      adapter: {
        authorize: async () => ({ connectionId: 'gmail-work', connectUrl: 'https://example.test/oauth' }),
        syncConnections: async () => [connection()],
        createSession: async () => ({ search: async () => ({ toolSchemas: {
          GMAIL_FETCH_EMAILS: { inputSchema: { type: 'object' } },
        } }) }),
      } as unknown as ComposioSessionsAdapter,
    });
    const wait = getConnectionWait(request.connectionWaitId!)!;
    await recovery.act(conversationId, { waitId: wait.id, expectedTranscriptId: wait.transcriptId,
      expectedVersion: wait.version, idempotencyKey: 'oauth-start', action: 'connect', needKey: wait.needs[0].key });
    await recovery.poll();
    const resumed = getPersonalRequest(request.requestId)!;
    expect(resumed.state).toBe('queued');
    expect(recovery.snapshot(conversationId).wait).toBeNull();
    expect(notify).toHaveBeenCalledOnce();
    let rows = loadTranscriptRowsForSession(conversationId);
    expect(transcriptRowsToClientHistory(rows)).toContainEqual(expect.objectContaining({ role: 'assistant', content: expect.stringContaining('连接成功') }));
    expect(JSON.stringify(buildSessionContextForLlm(rows))).not.toContain('连接成功');
    expect(getSqliteDatabase().prepare("SELECT COUNT(*) AS count FROM session_inputs WHERE kind = 'connection_resume'").get()).toMatchObject({ count: 0 });
    await recovery.poll();
    drainPersonalRequestContinuations(notify);
    rows = loadTranscriptRowsForSession(conversationId);
    expect(rows.filter(row => 'customType' in row && row.customType === 'personal_request_status')).toHaveLength(1);
    expect(notify).toHaveBeenCalledOnce();
    const runAgent = vi.fn(async () => {});
    await new TaskRunDispatcher({ workerId: 'test-worker', maxConcurrency: 1,
      ensureSession: async () => createConversation({ agentId: 'mail-worker', sourceChannel: 'webchat' }).key,
      runAgent }).drain();
    expect(runAgent).toHaveBeenCalledOnce();
    expect(runAgent).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.stringContaining(request.objective));
  });

  it('retries continuation notification after restart without appending duplicate feedback', () => {
    const request = submit();
    const account = connection();
    const wait = getConnectionWait(request.connectionWaitId!)!;
    queueConnectionResolution({ ...wait, needs: wait.needs.map(need => ({ ...need, accountId: account.accountId })) }, 'continued', resolvePersonalRequestConnection);
    drainPersonalRequestContinuations(() => { throw new Error('Disconnected event transport'); });
    const notify = vi.fn();
    drainPersonalRequestContinuations(notify);
    drainPersonalRequestContinuations(notify);
    expect(notify).toHaveBeenCalledOnce();
    expect(loadTranscriptRowsForSession(conversationId).filter(row => 'customType' in row && row.customType === 'personal_request_status')).toHaveLength(1);
  });

  it('requires account selection and honours installation permissions', () => {
    connection(); connection('gmail-personal');
    expect(personalCapabilities(conversationId, 'gmail')[0].status).toBe('needs_account_selection');
    const waiting = submit();
    expect(waiting.state).toBe('waiting_connection');
    upsertConnectorInstallation({ ...installation(), allowedAgentIds: [agentId] });
    expect(personalCapabilities(conversationId, 'gmail')[0].status).toBe('unavailable');
  });

  it('does not place delayed connection feedback into a reset transcript', () => {
    const request = submit();
    const account = connection();
    const wait = getConnectionWait(request.connectionWaitId!)!;
    queueConnectionResolution({ ...wait, needs: wait.needs.map(need => ({ ...need, accountId: account.accountId })) }, 'continued', resolvePersonalRequestConnection);
    resetSessionRecord(conversationId, directory);
    const notify = vi.fn();
    drainPersonalRequestContinuations(notify);
    expect(notify).not.toHaveBeenCalled();
    expect(loadTranscriptRowsForSession(conversationId)).toHaveLength(0);
  });

  it('cancels skipped requests and rejects cross-conversation submission', () => {
    const request = submit();
    queueConnectionResolution(getConnectionWait(request.connectionWaitId!)!, 'skipped', resolvePersonalRequestConnection);
    expect(getPersonalRequest(request.requestId)?.state).toBe('cancelled');
    const other = createConversation({ agentId: 'mail-worker' });
    expect(() => submitPersonalRequest({ conversationId: other.key, connectorId: 'composio-gmail', objective: 'read', agentId: 'mail-worker', idempotencyKey: 'other' })).toThrow('Personal conversation');
  });

  function worker() {
    const account = connection();
    const request = submit(account.accountId);
    const run = new TaskRunRepository().getLatestRoot(request.taskId!)!;
    const worker = createConversation({ agentId: 'mail-worker', sourceChannel: 'webchat' });
    new TaskConversationRepository().activateExecutionSession({ taskId: request.taskId!, conversationId: worker.key, agentId: 'mail-worker', runId: run.id });
    const coordinator = TaskRunCoordinator.start({ runId: run.id, fallbackObjective: request.objective,
      context: { runId: run.id, conversationId: worker.key, agentId: 'mail-worker', taskId: request.taskId!, channel: 'webchat', origin: 'task', triggerKind: 'user' } })!;
    return { account, request, worker, coordinator };
  }

  it.each(['late', 'reject'] as const)('keeps a pre-lease Task cancellation and processes the next main-chat message when SDK acknowledgement is %s', async outcome => {
    const { request, worker: chat } = worker();
    const root = new TaskRunRepository().getActiveRoot(request.taskId!)!;
    let releaseStartup!: () => void;
    const startup = new Promise<void>(resolve => { releaseStartup = resolve; });
    let releaseAck!: () => void;
    const ack = new Promise<void>(resolve => { releaseAck = resolve; });
    let entered = false;
    let lease: ReturnType<typeof acquireEmbeddedRunLease> | undefined;
    const model = vi.fn();
    const sdkStop = vi.fn(async () => { await ack; if (outcome === 'reject') throw new Error('SDK stop failed'); });
    const runner = new GatewayAgentRunner({ getConfig: () => ({}),
      getAgentService: () => ({ resolveUserTimezoneForSession: () => 'UTC', prepareInboundAttachments: async () => [],
        sessionStore: { idleCompaction: { interrupt: () => {} } }, beginInboundTurn: () => {}, endInboundTurn: () => {},
        turnDispatcher: { processDirectStreaming: async function* (_message: string, conversation: string, _origin: unknown,
          _attachments: unknown, _thinking: unknown, options: { runId: string; signal: AbortSignal }) {
          entered = true; await startup;
          expect(options.signal.aborted).toBe(true);
          lease = acquireEmbeddedRunLease({ conversationId: conversation, transcriptId: getSessionMetadata(conversation)!.transcriptId!, runId: options.runId });
          try {
            await lease.attach({} as never, sdkStop);
            if (!options.signal.aborted && !lease.signal.aborted) model();
          } finally { lease.release(); }
        } },
        getLastAssistantPlainText: () => '', takeTaskReviewStreamHint: () => undefined,
        outboundCoordinator: { emitSessionTurnComplete: async () => {} } }),
      sessionIndex: { getSessionMetadata: async (key: string) => getSessionMetadata(key), updateSessionMetadata: async () => {},
        appendTranscriptCustomEntry: async () => {}, appendTranscriptContextEntry: async () => {} },
      emit: () => {}, publishRealtime: () => {}, completeRealtimeTopic: () => {}, bus: { publishInbound: async () => {} },
    } as never);
    insertSessionInput({ id: 'prelease-worker', conversationId: chat.key, clientMessageId: 'prelease-worker', taskRunId: root.id,
      content: 'Read mail', requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', origin: { type: 'system', source: 'workflow' } });
    const draining = runner.inputs.drain(chat.key);
    finishSessionInputRun(conversationId, 'main-run', 'completed');
    const taskTool = createPersonalTaskTool({ getCurrentConversationId: () => conversationId, getCurrentAgentId: () => agentId });
    const execute = vi.fn(async (input: { content: string }) => {
      if (input.content === 'cancel task') await taskTool.execute('prelease-cancel', { command: 'cancel', taskId: request.taskId! });
      return { status: 'ok', summary: '' };
    });
    const main = new SessionInputCoordinator({ sessionExists: async () => true, execute,
      prepareAttachments: async () => undefined, prepareContexts: async () => undefined, steer: async () => false, emit: () => {} });
    const send = (content: string) => main.submit({ conversationId, clientMessageId: content, content, delivery: 'next', origin: { type: 'channel', channel: 'webchat' } });
    try {
      await vi.waitFor(() => expect(entered).toBe(true));
      await send('cancel task'); await main.waitForCompletion(conversationId, 'cancel task');
      expect(new TaskRunRepository().get(root.id)?.status).toBe('cancelled');
      releaseStartup();
      await vi.waitFor(() => expect(sdkStop).toHaveBeenCalledOnce());
      expect(lease!.signal.aborted).toBe(true);
      await send('next question'); await main.waitForCompletion(conversationId, 'next question');
      expect(execute).toHaveBeenCalledTimes(2);
      expect(model).not.toHaveBeenCalled();
      releaseAck(); await draining;
      runner.recoverSessionInputs(); await runner.inputs.drain(chat.key);
      expect(model).not.toHaveBeenCalled();
    } finally { releaseStartup(); releaseAck(); await draining; lease?.release(); runner.disposeClarifications(); }
  });

  it('clears every wait of a cancelled connection Run so the Task can be reopened and started', () => {
    const { account, request, worker: chat } = worker();
    const runs = new TaskRunRepository();
    const root = runs.getActiveRoot(request.taskId!)!;
    upsertConnectorConnection({ ...account, status: 'expired' });
    const waiting = requirePersonalWorkerConnection(chat.key);
    const wait = getConnectionWait(waiting.connectionWaitId!)!;
    runs.createWait({ taskId: request.taskId!, taskRunId: root.id, kind: 'user_input',
      reason: 'Another requirement', condition: { type: 'connection', connectionWaitId: 'another-old-requirement' } });
    cancelConnectionObjective(conversationId, wait.id, wait.objectiveRevision);
    cancelPersonalRequest(getPersonalRequest(request.requestId)!);
    expect(runs.get(root.id)?.status).toBe('cancelled');
    expect(runs.listActiveWaits(request.taskId!)).toHaveLength(0);
    closeXopcDatabase(); openXopcDatabase({ path: join(directory, 'xopc.db') });
    expect(runs.reconcileCancelledRuns()).toBe(0);
    const tasks = new TaskApplicationService();
    expect(tasks.execute({ taskId: request.taskId!, expectedVersion: new TaskRepository().require(request.taskId!).version,
      actor: { kind: 'user' }, idempotencyKey: 'reopen-after-all-waits', command: { type: 'reopen', phase: 'active' } }).ok).toBe(true);
    expect(tasks.execute({ taskId: request.taskId!, expectedVersion: new TaskRepository().require(request.taskId!).version,
      actor: { kind: 'user' }, idempotencyKey: 'start-after-all-waits', command: { type: 'start', executor: { kind: 'agent', agentId: 'mail-worker' } } }).ok).toBe(true);
  });

  it.each(['late', 'reject'] as const)('finishes ordinary Task cancellation and the next message before SDK acknowledgement is %s', async outcome => {
    const { request, worker: chat } = worker();
    const root = new TaskRunRepository().getActiveRoot(request.taskId!)!;
    insertSessionInput({ id: 'task-stop-input', conversationId: chat.key, clientMessageId: 'task-stop-input', taskRunId: root.id,
      content: 'Read mail', requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', origin: { type: 'system', source: 'workflow' } });
    claimNextSessionInput(chat.key, 'task-stop-execution');
    const lease = acquireEmbeddedRunLease({ conversationId: chat.key, transcriptId: getSessionMetadata(chat.key)!.transcriptId!, runId: 'task-stop-execution' });
    let release!: () => void;
    const acknowledgement = new Promise<void>(resolve => { release = resolve; });
    const stop = vi.fn(async () => { await acknowledgement; if (outcome === 'reject') throw new Error('SDK stop failed'); });
    await lease.attach({} as never, stop);
    finishSessionInputRun(conversationId, 'main-run', 'completed');
    const tool = createPersonalTaskTool({ getCurrentConversationId: () => conversationId, getCurrentAgentId: () => agentId });
    const execute = vi.fn(async (input: { content: string }) => {
      if (input.content === 'cancel task') {
        const result = await tool.execute('task-stop-cancel', { command: 'cancel', taskId: request.taskId! });
        expect(JSON.parse(result.content[0].text)).toMatchObject({ status: 'cancelled', executionStopConfirmed: false });
      }
      return { status: 'ok', summary: '' };
    });
    const inputs = new SessionInputCoordinator({ sessionExists: async () => true, execute,
      prepareAttachments: async () => undefined, prepareContexts: async () => undefined, steer: async () => false, emit: () => {} });
    const send = (content: string) => inputs.submit({ conversationId, clientMessageId: content, content, delivery: 'next', origin: { type: 'channel', channel: 'webchat' } });
    try {
      await send('cancel task');
      await inputs.waitForCompletion(conversationId, 'cancel task');
      expect(new TaskRunRepository().get(root.id)?.status).toBe('cancelled');
      expect(lease.signal.aborted).toBe(true);
      expect(stop).toHaveBeenCalledOnce();
      await tool.execute('task-stop-cancel', { command: 'cancel', taskId: request.taskId! });
      expect(stop).toHaveBeenCalledOnce();
      lease.release(); finishSessionInputRun(chat.key, 'task-stop-execution', 'cancelled');
      await send('next question');
      await inputs.waitForCompletion(conversationId, 'next question');
      expect(execute).toHaveBeenCalledTimes(2);
      release(); await acknowledgement;
      await inputs.drain(conversationId);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(new TaskRunRepository().get(root.id)?.status).toBe('cancelled');
    } finally { release(); lease.release(); }
  });

  it.each(['tool', 'service', 'task'] as const)('does not wait for a late worker stop or cancel its replacement through %s', async path => {
    const { request, worker: chat } = worker();
    const oldRun = new TaskRunRepository().getActiveRoot(request.taskId!)!;
    insertSessionInput({ id: 'old-worker-input', conversationId: chat.key, clientMessageId: 'old-worker-input', taskRunId: oldRun.id,
      content: 'Read mail', requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', origin: { type: 'system', source: 'workflow' } });
    claimNextSessionInput(chat.key, 'old-worker-execution');
    const old = acquireEmbeddedRunLease({ conversationId: chat.key, transcriptId: getSessionMetadata(chat.key)!.transcriptId!, runId: 'old-worker-execution' });
    let releaseAck!: () => void;
    const ack = new Promise<void>(resolve => { releaseAck = resolve; });
    const stop = vi.fn(async () => { await ack; });
    await old.attach({} as never, stop);
    const tool = createPersonalRequestTools({ getCurrentConversationId: () => conversationId }).find(tool => tool.name === 'personal_request')!;
    const taskTool = createPersonalTaskTool({ getCurrentConversationId: () => conversationId, getCurrentAgentId: () => agentId });
    const repeatCancellation = () => path === 'task'
      ? taskTool.execute('old-worker-cancel', { command: 'cancel', taskId: request.taskId! })
      : tool.execute('old-worker-cancel', { command: 'cancel', requestId: request.requestId });
    let next: ReturnType<typeof acquireEmbeddedRunLease> | undefined;
    try {
      if (path !== 'service') await repeatCancellation();
      else cancelPersonalRequest(request);
      expect(old.signal.aborted).toBe(true);
      expect(stop).toHaveBeenCalledOnce();
      await repeatCancellation();
      expect(stop).toHaveBeenCalledOnce();
      old.release();
      finishSessionInputRun(chat.key, 'old-worker-execution', 'cancelled');
      const tasks = new TaskApplicationService();
      expect(tasks.execute({ taskId: request.taskId!, expectedVersion: new TaskRepository().require(request.taskId!).version,
        actor: { kind: 'user' }, idempotencyKey: 'late-stop-reopen', command: { type: 'reopen', phase: 'active' } }).ok).toBe(true);
      expect(tasks.execute({ taskId: request.taskId!, expectedVersion: new TaskRepository().require(request.taskId!).version,
        actor: { kind: 'user' }, idempotencyKey: 'late-stop-start', command: { type: 'start', executor: { kind: 'agent', agentId: 'mail-worker' } } }).ok).toBe(true);
      const newRun = new TaskRunRepository().getActiveRoot(request.taskId!)!;
      insertSessionInput({ id: 'new-worker-input', conversationId: chat.key, clientMessageId: 'new-worker-input', taskRunId: newRun.id,
        content: 'New work', requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', origin: { type: 'system', source: 'workflow' } });
      claimNextSessionInput(chat.key, 'new-worker-execution');
      next = acquireEmbeddedRunLease({ conversationId: chat.key, transcriptId: getSessionMetadata(chat.key)!.transcriptId!, runId: 'new-worker-execution' });
      releaseAck();
      await ack;
      await repeatCancellation();
      expect(next.signal.aborted).toBe(false);
      expect(new TaskRunRepository().getActiveRoot(request.taskId!)).toEqual(newRun);
    } finally { releaseAck(); old.release(); next?.release(); }
  });

  it('reads retained connected results after completion and rechecks account access on a cached read', async () => {
    const { request, worker: chat, coordinator } = worker();
    await createPersonalRequestResultTool(() => chat.key).execute('publish-read', { summary: 'Saved result summary', coverage: { from: '2026-10-02T00:00:00+08:00', to: '2026-10-08T00:00:00+08:00', scannedCount: 10, partial: false }, items: [{
      messageId: 'mail-read', subject: 'RETAINED-SUBJECT-735', sender: 'Saved sender', receivedAt: '2026-10-07T09:00:00Z',
      importanceReason: 'The deadline is Thursday; this is a frozen saved result.' }] }, undefined, undefined);
    coordinator.finalize({ status: 'succeeded', summary: 'Mail summarized', assistantText: 'Result published' });
    drainPersonalRequestResults();
    const resultId = `personal-request:${request.requestId}`;
    expect(resultReader.listPersonalResults(conversationId).items.map(item => item.resultId)).toContain(resultId);
    let body: Record<string, unknown> = {};
    for (let n = 0; n < 100; n++) {
      body = await resultReader.readPersonalResult(conversationId, { command: 'read', resultId });
      if (body.status !== 'preparing') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    expect(body.status).toBe('ready');
    expect(body.text).toContain('RETAINED-SUBJECT-735');
    upsertConnectorInstallation({ ...installation(), allowedAgentIds: [agentId, 'mail-worker'] });
    const retained = resultReader.resolvePersonalResultReference(conversationId, resultId);
    expect(() => resultReader.assertPersonalResultDelegateAccess(conversationId, retained, 'mail-worker')).not.toThrow();
    expect(() => resultReader.assertPersonalResultDelegateAccess(conversationId, retained, 'unpermitted-worker')).toThrow('permit this Task executor');
    upsertConnectorInstallation({ ...installation(), enabled: false });
    await expect(resultReader.readPersonalResult(conversationId, { command: 'read', resultId })).rejects.toThrow('account access');
    expect(resultReader.listPersonalResults(conversationId).items).toHaveLength(0);
  }, 15000);

  it('delivers structured mail while the main run is active, without duplicate results', async () => {
    const { request, worker: chat, coordinator } = worker();
    await createPersonalRequestResultTool(() => chat.key).execute('publish', { summary: '有一封需要回复的邮件',
      coverage: { from: '2026-10-02T00:00:00+08:00', to: '2026-10-08T00:00:00+08:00', scannedCount: 10, partial: false },
      items: [{ messageId: 'mail-1', subject: 'Deadline', sender: 'Boss', receivedAt: '2026-10-07T09:00:00Z',
        importanceReason: '需要在周五前回复', openUrl: 'https://mail.google.com/mail/u/0/#inbox/mail-1' }] }, undefined, undefined);
    coordinator.finalize({ status: 'succeeded', summary: 'Mail summarized', assistantText: 'Result published' });
    const decide = vi.fn(async () => ({ notify: true, reason: 'deliver' }));
    const submitAndConfirm = vi.fn(async () => true);
    await new TaskMainUpdateDelivery().drain({ isAvailable: () => true, decide, submitAndConfirm });
    expect(decide).not.toHaveBeenCalled();
    expect(submitAndConfirm).not.toHaveBeenCalled();
    const notify = vi.fn();
    drainPersonalRequestResults(notify); drainPersonalRequestResults(notify);
    expect(loadTranscriptRowsForSession(conversationId).filter(row => 'customType' in row && row.customType === 'task_result_delivery')).toHaveLength(0);
    const compose = vi.fn(async () => '有一封邮件值得先看，需要在周五前回复。');
    await new PersonalReplyComposer(compose).drain(notify);
    expect(compose).not.toHaveBeenCalled();
    finishSessionInputRun(conversationId, 'main-run', 'completed');
    await new PersonalReplyComposer(compose).drain(notify);
    await new PersonalReplyComposer(compose).drain(notify);
    expect(compose).toHaveBeenCalledTimes(1);
    const rows = loadTranscriptRowsForSession(conversationId);
    expect(rows.filter(row => 'customType' in row && row.customType === 'task_result_delivery')).toHaveLength(1);
    expect(JSON.stringify(rows)).toContain('查询尚未覆盖全部邮件');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(getPersonalRequest(request.requestId)?.state).toBe('completed');
    expect(JSON.stringify(buildSessionContextForLlm(rows))).toContain('有一封邮件值得先看');
  });

  it('shares a connected request reply and its artifacts in the same outbox row', async () => {
    const { request, worker: chat, coordinator } = worker();
    const run = new TaskRunRepository().getLatestRoot(request.taskId!)!;
    await createPersonalRequestResultTool(() => chat.key).execute('publish', { summary: 'Mail ready', items: [],
      coverage: { from: '2026-10-02T00:00:00+08:00', to: '2026-10-08T00:00:00+08:00', scannedCount: 0, partial: false } }, undefined, undefined);
    coordinator.captureOutcome({ version: 1, outcomeId: 'mail-site', runId: run.id, turnId: run.id,
      status: 'succeeded', summary: 'Published site', evidence: [], createdAt: new Date().toISOString(),
      deliverables: [{ artifactId: 'mail-site', title: 'Mail report', kind: 'site', availability: 'available',
        location: 'external_host', shareUrl: 'https://example.test/report', capabilities: ['open'] }] });
    coordinator.finalize({ status: 'succeeded', summary: 'Ready', assistantText: 'Published' });
    drainPersonalRequestResults();
    const compose = vi.fn(async () => 'Your mail report is ready.');
    await new PersonalReplyComposer(compose).drain(vi.fn());
    expect(compose).not.toHaveBeenCalled();
    const db = getSqliteDatabase();
    expect(db.prepare('SELECT status, reply_status FROM task_result_deliveries WHERE task_run_id = ?').all(run.id))
      .toEqual([{ status: 'pending', reply_status: 'pending' }]);
    await new TaskResultDeliveryService().drain(vi.fn());
    finishSessionInputRun(conversationId, 'main-run', 'completed');
    await new PersonalReplyComposer(compose).drain(vi.fn());
    drainPersonalRequestResults();
    expect(compose).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT status, reply_status FROM task_result_deliveries WHERE task_run_id = ?').all(run.id))
      .toEqual([{ status: 'delivered', reply_status: 'delivered' }]);
    expect(loadTranscriptRowsForSession(conversationId).filter(row => 'customType' in row && row.customType === 'task_result_delivery'))
      .toHaveLength(2);
  });

  it('retains results without inserting them into a reset transcript', async () => {
    const { request, worker: chat, coordinator } = worker();
    await createPersonalRequestResultTool(() => chat.key).execute('publish', { summary: 'Result', items: [],
      coverage: { from: '2026-10-01T00:00:00+08:00', to: '2026-10-08T00:00:00+08:00', scannedCount: 0, partial: false } }, undefined, undefined);
    coordinator.finalize({ status: 'succeeded', summary: 'Result', assistantText: 'Result' });
    resetSessionRecord(conversationId, directory);
    drainPersonalRequestResults();
    expect(loadTranscriptRowsForSession(conversationId)).toHaveLength(0);
    expect(getPersonalRequest(request.requestId)?.state).toBe('completed');
    expect(getPersonalRequest(request.requestId)?.result?.summary).toBe('Result');
  });

  it('returns an expired worker account to the main chat and resumes the same TaskRun', () => {
    const { account, request, worker: chat } = worker();
    const runs = new TaskRunRepository();
    const runId = runs.getActiveRoot(request.taskId!)!.id;
    expect(() => requirePersonalWorkerConnection(chat.key)).toThrow('account is connected');
    upsertConnectorConnection({ ...account, status: 'expired' });
    expect(personalCapabilities(conversationId, 'gmail')[0].status).toBe('needs_reauthorization');
    const waiting = requirePersonalWorkerConnection(chat.key);
    const wait = getConnectionWait(waiting.connectionWaitId!)!;
    expect(wait.conversationId).toBe(conversationId);
    expect(runs.get(runId)?.status).toBe('waiting');
    upsertConnectorConnection({ ...account, status: 'active' });
    const ready = updateConnectionWait({ ...wait, needs: wait.needs.map(need => ({ ...need,
      accountId: account.accountId, connectionId: account.id, unavailable: false })) }, wait.version);
    queueConnectionResolution(ready, 'continued', resolvePersonalRequestConnection);
    expect(runs.getActiveRoot(request.taskId!)?.id).toBe(runId);
    expect(runs.listActiveWaits(request.taskId!)).toHaveLength(0);
    expect(getPersonalRequest(request.requestId)?.state).toBe('queued');
  });

  it('closes the waiting Personal Task and allocation when its connection objective is cancelled', () => {
    const { account, request, worker: chat } = worker();
    upsertConnectorConnection({ ...account, status: 'expired' });
    const waiting = requirePersonalWorkerConnection(chat.key);
    const wait = getConnectionWait(waiting.connectionWaitId!)!;
    cancelConnectionObjective(conversationId, wait.id, wait.objectiveRevision);
    cancelConnectionObjective(conversationId, wait.id, wait.objectiveRevision);
    // The durable cancellation control retries the existing domain cancellation after fencing recovery.
    cancelPersonalRequest(getPersonalRequest(request.requestId)!);
    cancelPersonalRequest(getPersonalRequest(request.requestId)!);
    expect(getPersonalRequest(request.requestId)?.state).toBe('cancelled');
    expect(new TaskRepository().require(request.taskId!)).toMatchObject({ phase: 'closed', resolution: 'cancelled' });
    expect(new TaskRunRepository().getActiveRoot(request.taskId!)).toBeUndefined();
    expect(getConnectionWait(wait.id)?.resolution).toBe('cancelled');
  });

  it('retries old cancellation cleanup without cancelling a different new connection objective', () => {
    const { account, request, worker: chat } = worker();
    upsertConnectorConnection({ ...account, status: 'expired' });
    const waiting = requirePersonalWorkerConnection(chat.key);
    const oldWait = getConnectionWait(waiting.connectionWaitId!)!;
    cancelConnectionObjective(conversationId, oldWait.id, oldWait.objectiveRevision);
    const next = requireSessionConnection({ conversationId, principalId: 'local-owner', agentId,
      summary: 'A different new goal', needs: [{ key: 'new-gmail-goal', label: 'Gmail',
        target: { type: 'connector', connectorId: 'composio-gmail' }, capabilities: ['tools'] }] });
    expect(next.waitId).not.toBe(oldWait.id);
    cancelPersonalRequest(getPersonalRequest(request.requestId)!);
    cancelPersonalRequest(getPersonalRequest(request.requestId)!);
    expect(getConnectionWait(next.waitId!)?.status).toBe('open');
    expect(new TaskRepository().require(request.taskId!)).toMatchObject({ phase: 'closed', resolution: 'cancelled' });
  });

  it.each(['current', 'legacy'] as const)('fences stale and persisted %s cleanup retries after a cancelled Task is reopened with a new Run', async format => {
    const { account, request, worker: chat } = worker();
    upsertConnectorConnection({ ...account, status: 'expired' });
    const waiting = requirePersonalWorkerConnection(chat.key);
    const wait = getConnectionWait(waiting.connectionWaitId!)!;
    cancelConnectionObjective(conversationId, wait.id, wait.objectiveRevision);
    const stale = getPersonalRequest(request.requestId)!;
    cancelPersonalRequest(stale);
    expect(getPersonalRequest(request.requestId)?.parameters.cancellationCleanupCompleted).toBe(true);
    if (format === 'legacy') getSqliteDatabase().prepare(`UPDATE personal_requests
      SET parameters_json = json_remove(parameters_json, '$.taskRunId', '$.cancellationCleanupCompleted') WHERE request_id = ?`).run(request.requestId);
    const tasks = new TaskApplicationService();
    const reopen = tasks.execute({ taskId: request.taskId!, expectedVersion: new TaskRepository().require(request.taskId!).version,
      actor: { kind: 'user' }, idempotencyKey: 'reopen-after-cancel', command: { type: 'reopen', phase: 'active' } });
    expect(reopen.ok).toBe(true);
    const start = tasks.execute({ taskId: request.taskId!, expectedVersion: new TaskRepository().require(request.taskId!).version,
      actor: { kind: 'user' }, idempotencyKey: 'new-run-after-cancel', command: { type: 'start', executor: { kind: 'agent', agentId: 'mail-worker' } } });
    expect(start.ok).toBe(true);
    const next = new TaskRunRepository().getActiveRoot(request.taskId!)!;
    const before = new TaskRepository().require(request.taskId!);
    cancelPersonalRequest(stale);
    closeXopcDatabase();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    cancelPersonalRequest(getPersonalRequest(request.requestId)!);
    expect(new TaskRunRepository().getActiveRoot(request.taskId!)).toEqual(next);
    const replay = createPersonalRequestTools({ getCurrentConversationId: () => conversationId }).find(tool => tool.name === 'personal_request')!;
    await replay.execute('late-old-cancel', { command: 'cancel', requestId: request.requestId });
    await replay.execute('late-old-cancel', { command: 'cancel', requestId: request.requestId });
    expect(new TaskRunRepository().getActiveRoot(request.taskId!)).toEqual(next);
    expect(new TaskRepository().require(request.taskId!)).toEqual(before);
  });

  it('cancels worker access after deleting the main conversation', async () => {
    const { request, worker: chat } = worker();
    expect(resolveExecutionToolPolicy(chat.key).surface).toBe('personal_request_worker');
    const runId = new TaskRunRepository().getActiveRoot(request.taskId!)!.id;
    patchSessionMetadata(chat.key, { customData: { personalReadRequestId: request.requestId } });
    deleteSessionRecord(conversationId);
    expect(getPersonalRequest(request.requestId)).toBeUndefined();
    expect(resolveExecutionToolPolicy(chat.key)).toMatchObject({ surface: 'personal_request_worker', nativeMcp: false, codemode: false });
    expect(new TaskRunRepository().get(runId)?.status).toBe('cancelled');
    const execute = vi.fn();
    const tools = createExternalToolGatewayTools([{ source: 'composio', search: async () => [], describe: async () => undefined, execute }],
      () => ({ conversationId: chat.key, channel: 'webchat', chatId: chat.key, origin: { type: 'system', source: 'internal' } }));
    await expect(tools.find(tool => tool.name === 'xopc_tool_execute')!.execute('late', { toolRef: 'composio:any:any', revision: 'x' }, undefined, undefined)).rejects.toThrow('no longer active');
    expect(execute).not.toHaveBeenCalled();
  });

  it('enforces account and read-only scope before provider execution, and blocks cancelled workers', async () => {
    const { account, request, worker: chat } = worker();
    const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }], details: {} }));
    const provider: ExternalToolProvider = { source: 'composio', search: async () => [], execute,
      describe: async ref => ({ toolRef: ref, source: 'composio', namespace: 'gmail', title: 'read', summary: 'read',
        description: 'read', batchRead: false, inputSchema: { type: 'object', properties: { xopcAccountId: { type: 'string' } } } }) };
    const tools = createExternalToolGatewayTools([provider], () => ({ conversationId: chat.key, channel: 'webchat', chatId: chat.key }));
    const tool = tools.find(tool => tool.name === 'xopc_tool_execute')!;
    await expect(tool.execute('wrong-account', { toolRef: 'composio:composio-gmail-local-owner:GMAIL_SEND_EMAIL', revision: 'x', arguments: { xopcAccountId: 'wrong' } }, undefined, undefined)).rejects.toThrow('selected Personal');
    upsertConnectorActionMetadata({ connectorId: 'composio-gmail', actionId: 'GMAIL_SEND_EMAIL', scope: 'write', curated: true, cachedAt: new Date().toISOString() });
    await expect(tool.execute('write', { toolRef: 'composio:composio-gmail-local-owner:GMAIL_SEND_EMAIL', revision: 'x', arguments: { xopcAccountId: account.accountId } }, undefined, undefined)).rejects.toThrow('curated read');
    cancelPersonalRequest(request);
    await expect(tool.execute('cancelled', { toolRef: 'composio:composio-gmail-local-owner:GMAIL_FETCH_EMAILS', revision: 'x', arguments: { xopcAccountId: account.accountId } }, undefined, undefined)).rejects.toThrow('no longer active');
    expect(execute).not.toHaveBeenCalled();
  });

  it('uses one board for connected questions, answers, instructions and confirmations without granting account access', async () => {
    const { request, worker: chat, account } = worker();
    const runs = new TaskRunRepository();
    const runId = runs.getActiveRoot(request.taskId!)!.id;
    const executor = createTaskCollaborationTool({ getCurrentConversationId: () => chat.key,
      getCurrentAgentId: () => 'mail-worker', dispatchTaskRuns: vi.fn() });
    const personal = createPersonalRequestTools({ getCurrentConversationId: () => conversationId,
      getCurrentAgentId: () => agentId, dispatchTaskRuns: vi.fn() }).find(tool => tool.name === 'personal_request')!;
    expect(resolveExecutionToolPolicy(chat.key).surface).toBe('personal_request_worker');
    expect(buildTaskExecutionDirective(chat.key)).toContain('task_collaboration command post');
    await executor.execute('ask', { command: 'post', kind: 'question', body: 'Which label?', idempotencyKey: 'question' });
    const board = new TaskCollaborationRepository();
    const question = board.latest(request.taskId!)!;
    const mainUpdate = vi.fn(async () => true);
    const decide = vi.fn();
    await new TaskMainUpdateDelivery().drain({ isAvailable: () => true, decide, submitAndConfirm: mainUpdate });
    expect(mainUpdate).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining(request.requestId) }));
    expect(decide).not.toHaveBeenCalled();
    const snapshot = JSON.parse((await personal.execute('read', { command: 'get', requestId: request.requestId })).content[0].text);
    expect(snapshot.coordination.waits[0].condition.collaborationEntryId).toBe(question.id);
    const answer = { command: 'answer', requestId: request.requestId, questionId: question.id,
      instruction: 'Work report', idempotencyKey: 'owner-answer' };
    await personal.execute('answer', answer); await personal.execute('answer-replay', answer);
    expect(board.coordination(request.taskId!).filter(entry => entry.kind === 'answer')).toHaveLength(1);
    const answerEntry = board.latest(request.taskId!)!;
    await new TaskCollaborationDelivery().drain(vi.fn(async () => true));
    expect(runs.listActiveWaits(request.taskId!)).toHaveLength(0);
    expect(runs.getActiveRoot(request.taskId!)?.id).toBe(runId);
    await executor.execute('ack-answer', { command: 'post', kind: 'ack', causationId: answerEntry.id, body: 'Use Work report', idempotencyKey: 'ack-answer' });
    await personal.execute('instruct', { command: 'instruct', requestId: request.requestId,
      instruction: 'Only show urgent messages. Do not change accounts.', idempotencyKey: 'owner-change' });
    const instruction = board.latest(request.taskId!)!;
    const submitDelivery = vi.fn(async () => true);
    await new TaskCollaborationDelivery().drain(submitDelivery);
    expect(submitDelivery).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('task_collaboration command post') }));
    await executor.execute('ack-change', { command: 'post', kind: 'ack', causationId: instruction.id, body: 'Will filter urgent mail', idempotencyKey: 'ack-change' });
    expect(board.get(instruction.id)?.deliveryStatus).toBe('confirmed');
    expect(getPersonalRequest(request.requestId)?.accountId).toBe(account.accountId);
    expect(runs.listByTask(request.taskId!)).toHaveLength(1);
    const unrelated = new TaskRepository().create({ title: 'Unrelated', objective: 'Private' });
    const otherEntry = board.append({ taskId: unrelated.id, authorKind: 'system', authorId: 'test', kind: 'question', body: 'Private', idempotencyKey: 'other' });
    await expect(executor.execute('cross-task', { command: 'get', entryId: otherEntry.id })).rejects.toThrow('does not belong');
  });

  it('keeps account authorization waits unresolved by ordinary answers and instructions', async () => {
    const { request, worker: chat, account } = worker();
    const executor = createTaskCollaborationTool({ getCurrentConversationId: () => chat.key, getCurrentAgentId: () => 'mail-worker' });
    await executor.execute('ask', { command: 'post', kind: 'question', body: 'Which label?', idempotencyKey: 'label' });
    const board = new TaskCollaborationRepository();
    const question = board.latest(request.taskId!)!;
    upsertConnectorConnection({ ...account, status: 'expired' });
    const waiting = requirePersonalWorkerConnection(chat.key);
    const personal = createPersonalRequestTools({ getCurrentConversationId: () => conversationId, getCurrentAgentId: () => agentId }).find(tool => tool.name === 'personal_request')!;
    await personal.execute('answer', { command: 'answer', requestId: request.requestId, questionId: question.id,
      instruction: 'Work label; this text does not reconnect', idempotencyKey: 'label-answer' });
    await personal.execute('instruct', { command: 'instruct', requestId: request.requestId,
      instruction: 'Only urgent items', idempotencyKey: 'urgent-instruction' });
    await new TaskCollaborationDelivery().drain(vi.fn(async () => true));
    const runs = new TaskRunRepository();
    expect(runs.listActiveWaits(request.taskId!)).toMatchObject([{ condition: { connectionWaitId: waiting.connectionWaitId } }]);
    expect(getConnectionWait(waiting.connectionWaitId!)?.status).toBe('open');
    expect(board.coordination(request.taskId!).find(entry => entry.kind === 'instruction')?.deliveryStatus).toBe('pending');
    expect(board.list(request.taskId!).some(entry => entry.kind === 'progress' && entry.body.includes('连接界面'))).toBe(true);
  });

  it('saves a supplemental brief while awaiting initial authorization without creating another Request', async () => {
    const request = submit();
    const personal = createPersonalRequestTools({ getCurrentConversationId: () => conversationId }).find(tool => tool.name === 'personal_request')!;
    const input = { command: 'instruct', requestId: request.requestId, instruction: 'Only urgent items', idempotencyKey: 'before-auth' };
    await personal.execute('change', input); await personal.execute('change-replay', input);
    expect(listPersonalRequests(conversationId)).toHaveLength(1);
    expect(getPersonalRequest(request.requestId)?.objective.match(/Only urgent items/g)).toHaveLength(1);
    const account = connection();
    const wait = getConnectionWait(request.connectionWaitId!)!;
    queueConnectionResolution({ ...wait, needs: wait.needs.map(need => ({ ...need, accountId: account.accountId })) }, 'continued', resolvePersonalRequestConnection);
    const resumed = getPersonalRequest(request.requestId)!;
    expect(new TaskRepository().require(resumed.taskId!).body).toContain('Only urgent items');
    expect(resumed.parameters.timeRange).toEqual(request.parameters.timeRange);
    expect(new TaskRepository().list()).toHaveLength(1);
  });

  it('preserves an explicitly revised absolute query range for final coverage checks', async () => {
    const { request, worker: chat } = worker();
    const personal = createPersonalRequestTools({ getCurrentConversationId: () => conversationId, getCurrentAgentId: () => agentId }).find(tool => tool.name === 'personal_request')!;
    const range = { from: '2026-10-07T00:00:00+08:00', to: '2026-10-08T00:00:00+08:00', timezone: 'Asia/Shanghai', expression: 'Only October 7' };
    await expect(personal.execute('bad-range', { command: 'instruct', requestId: request.requestId, instruction: 'Change range',
      timeRange: { ...range, from: range.to } })).rejects.toThrow('valid absolute time range');
    expect(new TaskCollaborationRepository().coordination(request.taskId!)).toHaveLength(0);
    await personal.execute('range', { command: 'instruct', requestId: request.requestId, instruction: 'Only October 7', timeRange: range });
    expect(getPersonalRequest(request.requestId)?.parameters.timeRange).toEqual(range);
    expect(new TaskCollaborationRepository().latest(request.taskId!)?.body).toContain(range.from);
    await createPersonalRequestResultTool(() => chat.key).execute('latest-result', { summary: 'New range covered', items: [],
      coverage: { from: range.from, to: range.to, scannedCount: 0, partial: false } });
    expect(getPersonalRequest(request.requestId)?.result?.coverage?.partial).toBe(false);
  });

  it('does not deliver saved structured items published before the latest requirement', async () => {
    const { request, worker: chat, coordinator } = worker();
    await createPersonalRequestResultTool(() => chat.key).execute('old-result', { summary: 'Old report', items: [{ messageId: 'stale-item',
      subject: 'Old subject', sender: 'Sender', receivedAt: '2026-10-07T09:00:00Z', importanceReason: 'Old filter' }],
      coverage: { from: '2026-10-01T00:00:00+08:00', to: '2026-10-08T00:00:00+08:00', scannedCount: 1, partial: false } });
    const board = new TaskCollaborationRepository();
    board.append({ taskId: request.taskId!, authorKind: 'main_agent', authorId: agentId, kind: 'instruction', body: 'Change the report filter', idempotencyKey: 'late-change' });
    coordinator.finalize({ status: 'succeeded', summary: 'Finished', assistantText: 'Result' });
    finishSessionInputRun(conversationId, 'main-run', 'completed');
    drainPersonalRequestResults();
    const compose = vi.fn(async () => 'New requirements remain unverified');
    await new PersonalReplyComposer(compose).drain(vi.fn());
    expect(compose).toHaveBeenCalledWith(expect.objectContaining({
      report: expect.stringContaining('Supplemental requirements arrived'),
      delivery: expect.objectContaining({ outcome: expect.objectContaining({ status: 'partial' }) }) }), expect.any(AbortSignal));
    expect(compose.mock.calls[0]?.[0]).not.toHaveProperty('preservedText');
    expect(JSON.stringify(loadTranscriptRowsForSession(conversationId))).not.toContain('Old subject');
  });

  it('adopts a republished result after the new instruction and confirms it once', async () => {
    const { request, worker: chat, coordinator } = worker();
    const publish = createPersonalRequestResultTool(() => chat.key);
    const coverage = { from: '2026-10-01T00:00:00+08:00', to: '2026-10-08T00:00:00+08:00', scannedCount: 2, partial: false };
    await publish.execute('initial', { summary: 'Old report', items: [], coverage });
    const personal = createPersonalRequestTools({ getCurrentConversationId: () => conversationId, getCurrentAgentId: () => agentId }).find(tool => tool.name === 'personal_request')!;
    await personal.execute('new-requirement', { command: 'instruct', requestId: request.requestId,
      instruction: 'Use new title and only urgent mail', idempotencyKey: 'latest-brief' });
    const board = new TaskCollaborationRepository();
    const instruction = board.latest(request.taskId!)!;
    await new TaskCollaborationDelivery().drain(vi.fn(async () => true));
    await createTaskCollaborationTool({ getCurrentConversationId: () => chat.key, getCurrentAgentId: () => 'mail-worker' })
      .execute('confirm', { command: 'post', kind: 'ack', causationId: instruction.id, body: 'Will use the new title and filter', idempotencyKey: 'confirmed' });
    const result = { summary: 'New report: urgent only', coverage, items: [{ messageId: 'urgent', subject: 'Urgent deadline',
      sender: 'Boss', receivedAt: '2026-10-07T09:00:00Z', importanceReason: 'Urgent' }] };
    await publish.execute('current', result); await publish.execute('current-replay', result);
    expect(board.list(request.taskId!).filter(entry => entry.kind === 'result' && entry.authorKind === 'worker_agent')).toHaveLength(2);
    coordinator.finalize({ status: 'succeeded', summary: result.summary, assistantText: result.summary });
    finishSessionInputRun(conversationId, 'main-run', 'completed');
    drainPersonalRequestResults();
    const compose = vi.fn(async () => result.summary);
    await new PersonalReplyComposer(compose).drain(vi.fn());
    expect(compose).toHaveBeenCalledWith(expect.objectContaining({ report: result.summary,
      preservedText: expect.stringContaining('Urgent deadline'), delivery: expect.objectContaining({ outcome: expect.objectContaining({ status: 'succeeded' }) }) }), expect.any(AbortSignal));
    expect(JSON.stringify(loadTranscriptRowsForSession(conversationId))).toContain('Urgent deadline');
  });

  it('permits curated mail reads without broadening the separate batch-read allowlist', async () => {
    const { account, worker: chat } = worker();
    const ref = 'composio:composio-gmail-local-owner:GMAIL_FETCH_EMAILS';
    upsertConnectorActionMetadata({ connectorId: 'composio-gmail', actionId: 'GMAIL_FETCH_EMAILS', scope: 'read', curated: true, cachedAt: new Date().toISOString() });
    const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'Read verified' }], details: {} }));
    const provider: ExternalToolProvider = { source: 'composio', search: async () => [], execute,
      describe: async () => ({ toolRef: ref, source: 'composio', namespace: 'gmail', title: 'Read', summary: 'Read', description: 'Read',
        readOnly: true, batchRead: false, inputSchema: { type: 'object', properties: { xopcAccountId: { type: 'string' } }, required: ['xopcAccountId'] } }) };
    const tools = createExternalToolGatewayTools([provider], () => ({ conversationId: chat.key, channel: 'webchat', chatId: chat.key, origin: { type: 'system', source: 'internal' } }));
    const contract = await tools.find(tool => tool.name === 'xopc_tool_describe')!.execute('describe', { toolRefs: [ref] });
    const revision = JSON.parse((contract.content[0] as { text: string }).text).tools[0].revision;
    await tools.find(tool => tool.name === 'xopc_tool_execute')!.execute('read', { toolRef: ref, revision, readOnly: true, arguments: { xopcAccountId: account.accountId } });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('rechecks Personal owner access at the Composio SDK effect boundary', async () => {
    const { request, account, worker: chat } = worker();
    upsertConnectorActionMetadata({ connectorId: 'composio-gmail', toolkit: 'gmail', actionId: 'GMAIL_FETCH_EMAILS', scope: 'read', curated: true,
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } }, cachedAt: new Date().toISOString() });
    const effect = vi.fn();
    const adapter = {
      syncConnections: async () => [account],
      executeWithPolicy: async (input: { beforeExecute?: () => void }) => {
        getSqliteDatabase().prepare('UPDATE connector_accounts SET allowed_agent_ids_json = ? WHERE id = ?').run(JSON.stringify(['mail-worker']), account.accountId);
        input.beforeExecute?.(); effect();
        return { decision: 'allowed', result: { items: [] } };
      },
    } as unknown as ComposioSessionsAdapter;
    const config = ConfigSchema.parse({ connectors: { instances: { 'composio-gmail': {
      xopcConnector: { managed: true, connectorId: 'composio-gmail', enabled: true }, runtime: { type: 'composio', role: 'toolkit', toolkit: 'gmail' },
    } } } });
    const provider = new ComposioToolProvider({ getConfig: () => config, agentId: 'mail-worker', adapter,
      getCurrentContext: () => ({ conversationId: chat.key, channel: 'webchat', chatId: chat.key }) });
    await expect(provider.execute('composio:composio-gmail-local-owner:GMAIL_FETCH_EMAILS', { xopcAccountId: account.accountId, query: 'urgent' }, undefined,
      { toolCallId: 'dispatch', authorize: () => assertPersonalRequestAccountAccess(request) })).rejects.toThrow('authorization no longer permits');
    expect(effect).not.toHaveBeenCalled();
  });

  it('rechecks authorization after asynchronous schema discovery and before app dispatch', async () => {
    const { account, worker: chat } = worker();
    const ref = 'composio:composio-gmail-local-owner:GMAIL_FETCH_EMAILS';
    upsertConnectorActionMetadata({ connectorId: 'composio-gmail', actionId: 'GMAIL_FETCH_EMAILS', scope: 'read', curated: true, cachedAt: new Date().toISOString() });
    let revoke = false;
    const execute = vi.fn();
    const provider: ExternalToolProvider = { source: 'composio', search: async () => [], execute,
      describe: async () => {
        if (revoke) getSqliteDatabase().prepare('UPDATE connector_accounts SET allowed_agent_ids_json = ? WHERE id = ?')
          .run(JSON.stringify(['mail-worker']), account.accountId);
        return { toolRef: ref, source: 'composio', namespace: 'gmail', title: 'Read', summary: 'Read', description: 'Read', batchRead: true,
          inputSchema: { type: 'object', properties: { xopcAccountId: { type: 'string' } }, required: ['xopcAccountId'] } };
      } };
    const tools = createExternalToolGatewayTools([provider], () => ({ conversationId: chat.key, channel: 'webchat', chatId: chat.key, origin: { type: 'system', source: 'internal' } }));
    const contract = await tools.find(tool => tool.name === 'xopc_tool_describe')!.execute('describe', { toolRefs: [ref] });
    const revision = JSON.parse((contract.content[0] as { text: string }).text).tools[0].revision;
    revoke = true;
    await expect(tools.find(tool => tool.name === 'xopc_tool_execute')!.execute('revoked-after-describe', { toolRef: ref, revision,
      arguments: { xopcAccountId: account.accountId } })).rejects.toThrow('authorization no longer permits');
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['owner', 'executor', 'account', 'installation'] as const)('blocks remote execution after %s authorization is revoked', async which => {
    const { account, worker: chat } = worker();
    upsertConnectorActionMetadata({ connectorId: 'composio-gmail', actionId: 'GMAIL_FETCH_EMAILS', scope: 'read', curated: true, cachedAt: new Date().toISOString() });
    const execute = vi.fn();
    const tools = createExternalToolGatewayTools([{ source: 'composio', search: async () => [], describe: async () => undefined, execute }],
      () => ({ conversationId: chat.key, channel: 'webchat', chatId: chat.key, origin: { type: 'system', source: 'internal' } }));
    if (which === 'installation') upsertConnectorInstallation({ ...installation(), enabled: false });
    else if (which === 'account') getSqliteDatabase().prepare('UPDATE connector_accounts SET enabled = 0 WHERE id = ?').run(account.accountId);
    else getSqliteDatabase().prepare('UPDATE connector_accounts SET allowed_agent_ids_json = ? WHERE id = ?')
      .run(JSON.stringify(which === 'owner' ? ['mail-worker'] : [agentId]), account.accountId);
    await expect(tools.find(tool => tool.name === 'xopc_tool_execute')!.execute('blocked', {
      toolRef: 'composio:composio-gmail-local-owner:GMAIL_FETCH_EMAILS', revision: 'fixture', arguments: { xopcAccountId: account.accountId } })).rejects.toThrow('authorization no longer permits');
    expect(execute).not.toHaveBeenCalled();
  });

  it('serves authenticated request snapshot and cancellation through real lazy Gateway routes', async () => {
    const request = submit();
    const token = 'personal-request-test';
    const app = createHonoApp({ service: { currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
      getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token, isGatewayReady: () => true,
      getExtensionLoader: () => null } as unknown as GatewayService });
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    try {
      if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server');
      const base = `http://127.0.0.1:${address.port}/api/personal-agent/requests`;
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      expect((await fetch(base)).status).toBe(401);
      expect((await fetch(base, { headers })).status).toBe(200);
      expect((await fetch(`${base}/${request.requestId}`, { headers })).status).toBe(200);
      expect((await fetch(`${base}/${request.requestId}/cancel`, { headers, method: 'POST', body: JSON.stringify({ expectedVersion: request.version + 1 }) })).status).toBe(409);
      expect((await fetch(`${base}/${request.requestId}/cancel`, { headers, method: 'POST', body: JSON.stringify({ expectedVersion: request.version }) })).status).toBe(200);
      expect(getPersonalRequest(request.requestId)?.state).toBe('cancelled');
      expect(getSessionMetadata(conversationId)).toBeTruthy();
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
