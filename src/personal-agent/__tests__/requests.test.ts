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
import { getActiveConnectionWait, getConnectionWait, queueConnectionResolution, updateConnectionWait } from '../../storage/sqlite/connection-wait-repository.js';
import { upsertConnectorConnection, upsertConnectorInstallation, upsertConnectorActionMetadata } from '../../storage/sqlite/connector-repository.js';
import { TaskConversationRepository } from '../../tasks/task-conversation-repository.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskRunCoordinator } from '../../tasks/task-run-coordinator.js';
import { TaskRunDispatcher } from '../../tasks/task-run-dispatcher.js';
import { ConnectionRecoveryService } from '../../connectors/connection-recovery-service.js';
import type { ComposioSessionsAdapter } from '../../connectors/composio-sessions.js';
import { TaskMainUpdateDelivery } from '../../tasks/task-main-update-delivery.js';
import { createPersonalRequestResultTool } from '../../agent/tools/personal-request-result-tool.js';
import { createExternalToolGatewayTools } from '../../agent/external-tools/gateway-tools.js';
import type { ExternalToolProvider } from '../../agent/external-tools/types.js';
import { loadTranscriptRowsForSession } from '../../storage/sqlite/transcript-repository.js';
import { buildSessionContextForLlm } from '../../session/session-context-for-llm.js';
import { transcriptRowsToClientHistory } from '../../session/client-history.js';
import { createHonoApp } from '../../gateway/hono/app.js';
import { ConfigSchema } from '../../config/schema.js';
import type { GatewayService } from '../../gateway/service.js';
import { personalAgentId, personalConversationId } from '../repository.js';
import { personalCapabilities } from '../capability-service.js';
import { submitPersonalRequest, resolvePersonalRequestConnection, cancelPersonalRequest, requirePersonalWorkerConnection } from '../request-service.js';
import { getPersonalRequest, listPersonalRequests } from '../request-repository.js';
import { drainPersonalRequestContinuations, drainPersonalRequestResults } from '../request-delivery.js';
import { TaskResultDeliveryService } from '../../tasks/task-result-delivery-service.js';
import { PersonalReplyComposer } from '../reply-composer.js';

describe('Personal connected-app requests', () => {
  let directory: string;
  let conversationId: string;
  let agentId: string;
  beforeEach(() => {
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
  afterEach(() => {
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
    expect(() => submitPersonalRequest({ conversationId, connectorId: 'composio-gmail', agentId: 'mail-worker', objective: 'different', idempotencyKey: 'request-1' })).toThrow('Idempotency');
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

  it('keeps authorization in the main chat and resumes without another main-model input', () => {
    const request = submit();
    expect(request.state).toBe('waiting_connection');
    expect(request.taskId).toBeUndefined();
    const account = connection();
    const wait = getActiveConnectionWait(conversationId)!;
    const ready = updateConnectionWait({ ...wait, needs: wait.needs.map(need => ({ ...need, accountId: account.accountId, connectionId: account.id })) }, wait.version);
    const resolved = queueConnectionResolution(ready, 'continued', resolvePersonalRequestConnection);
    expect(resolved.status).toBe('closed');
    const resumed = getPersonalRequest(request.requestId)!;
    expect(resumed).toMatchObject({ state: 'queued', accountId: account.accountId });
    expect(resumed.taskId).toBeTruthy();
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

  it('cancels worker access after deleting the main conversation', async () => {
    const { request, worker: chat } = worker();
    const runId = new TaskRunRepository().getActiveRoot(request.taskId!)!.id;
    patchSessionMetadata(chat.key, { customData: { personalReadRequestId: request.requestId } });
    deleteSessionRecord(conversationId);
    expect(getPersonalRequest(request.requestId)).toBeUndefined();
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
