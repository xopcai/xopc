import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { createExternalToolGatewayTools } from '../../agent/external-tools/gateway-tools.js';
import { ComposioToolProvider } from '../../agent/external-tools/composio-provider.js';
import { ConfigSchema, type Config } from '../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { ensureSessionRecord, resetSessionRecord } from '../../storage/sqlite/session-repository.js';
import { claimNextSessionInput, finishSessionInputRun, getSessionInputById, getSessionInputState, insertSessionInput, recoverSessionInputState } from '../../storage/sqlite/session-input-repository.js';
import { cancelConnectionObjective, consumeConnectionResume, getActiveConnectionWait, getConnectionWait, invalidateConnectionResumeIntent, queueConnectionResolution, requireSessionConnection, updateConnectionWait } from '../../storage/sqlite/connection-wait-repository.js';
import { decideConnectorApproval, listConnectorApprovals, getConnectorInstallation, listConnectorConnections, upsertConnectorActionMetadata, upsertConnectorConnection, upsertConnectorInstallation } from '../../storage/sqlite/connector-repository.js';
import { updateConnectorAccount } from '../../storage/sqlite/connector-account-repository.js';
import { resumeApprovedConnectorAction } from '../approval-resume.js';
import { ConnectionRecoveryService, type ConnectionAction } from '../connection-recovery-service.js';
import { resolveConnectionCandidate } from '../connection-candidates.js';
import type { ComposioSessionsAdapter } from '../composio-sessions.js';

const conversationId = "f04efcc8-b008-406b-8c54-760428488f0a";
const need = resolveConnectionCandidate('composio-gmail');
const origin = { type: 'endpoint' as const, endpointId: 'test' };

describe('durable connection recovery', () => {
  let dir: string;
  let config: Config;
  let recovery: ConnectionRecoveryService;
  const authorize = vi.fn();
  const syncConnections = vi.fn();
  const searchCapabilities = vi.fn();
  const drain = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'xopc-recovery-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    ensureSessionRecord(conversationId, dir, { agentId: "main", sourceChannel: "webchat", sourceChatId: "recovery" });
    config = ConfigSchema.parse({});
    config.connectors = { instances: {} };
    config.connectors.instances['composio-gmail'] = {
      xopcConnector: { managed: true, connectorId: 'composio-gmail', enabled: true },
      runtime: { type: 'composio', role: 'toolkit', toolkit: 'gmail' },
    };
    upsertConnectorInstallation({ id: 'composio-gmail-local-owner', connectorId: 'composio-gmail', principalId: 'local-owner',
      enabled: true, allowedAgentIds: [], maxScope: 'read', confirmationPolicy: 'writes', selectedAccountIds: null });
    insertSessionInput({ id: 'origin', conversationId, clientMessageId: 'origin', requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'Summarize my unread Gmail messages from last week.', origin });
    claimNextSessionInput(conversationId, 'run-original');
    syncConnections.mockImplementation(async () => listConnectorConnections({ principalId: 'local-owner' }));
    authorize.mockResolvedValue({ toolkit: 'gmail', connectionId: 'provider-1', connectUrl: 'https://example.test/oauth', status: 'INITIATED' });
    searchCapabilities.mockResolvedValue({ toolSchemas: { GMAIL_FETCH_EMAILS: { inputSchema: { type: 'object' } } } });
    recovery = new ConnectionRecoveryService({ getConfig: () => config, saveConfig: vi.fn(async () => ({ saved: true })), drain,
      adapter: { authorize, syncConnections, createSession: async () => ({ search: searchCapabilities }) } as unknown as ComposioSessionsAdapter });
  });
  afterEach(() => { vi.unstubAllEnvs(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true }); });

  function requireWait() {
    requireSessionConnection({ conversationId, principalId: 'local-owner', agentId: 'main', summary: 'Read Gmail', needs: [need] });
    return getActiveConnectionWait(conversationId)!;
  }
  function activeConnection(id = 'connection-1') {
    return upsertConnectorConnection({ id, connectorId: need.connectorId, provider: 'composio', principalId: 'local-owner',
      providerConnectionId: id === 'connection-1' ? 'provider-1' : id, identity: { email: `${id}@example.test` }, status: 'active', isDefault: false, metadata: {} });
  }

  it('binds approval to the account and resumes the same objective without accepting changed arguments', async () => {
    const account = activeConnection();
    upsertConnectorInstallation({ ...getConnectorInstallation('composio-gmail-local-owner')!, maxScope: 'write' });
    upsertConnectorActionMetadata({ connectorId: need.connectorId, actionId: 'GMAIL_SEND_EMAIL', toolkit: 'gmail', scope: 'write', curated: true,
      inputSchema: { type: 'object', properties: { body: { type: 'string' } } }, cachedAt: new Date().toISOString() });
    searchCapabilities.mockResolvedValue({ toolSchemas: { GMAIL_SEND_EMAIL: { inputSchema: { type: 'object' } } } });
    const execute = vi.fn(async (input: { confirmed?: boolean; beforeExecute?: () => void }) => {
      input.beforeExecute?.();
      return { decision: 'allowed', result: { sent: true } };
    });
    const provider = new ComposioToolProvider({ getConfig: () => config, getCurrentContext: () => ({ conversationId, channel: 'webchat', chatId: conversationId }),
      adapter: { syncConnections, executeWithPolicy: execute } as unknown as ComposioSessionsAdapter });
    const ref = 'composio:composio-gmail-local-owner:GMAIL_SEND_EMAIL';
    await provider.execute(ref, { body: 'Hello' }, undefined, { toolCallId: 'request' });
    const approval = listConnectorApprovals({ status: 'pending' })[0]!;
    expect(approval.waitId).toBe(getActiveConnectionWait(conversationId)?.id);
    expect(approval.argumentsPreview).toMatchObject({ account: { id: account.accountId }, arguments: { body: 'Hello' } });
    const approved = decideConnectorApproval(approval.id, 'approved')!;
    expect(await resumeApprovedConnectorAction(approved, recovery)).toBe(true);
    finishSessionInputRun(conversationId, 'run-original', 'completed');
    const resumed = claimNextSessionInput(conversationId, 'approved-run')!;
    consumeConnectionResume(resumed);
    const changed = await provider.execute(ref, { body: 'Different' }, approval.id, { toolCallId: 'changed' });
    expect(JSON.stringify(changed)).toContain('invalid');
    expect(execute).not.toHaveBeenCalled();
    const result = await provider.execute(ref, { body: 'Hello' }, approval.id, { toolCallId: 'approved' });
    expect(JSON.stringify(result)).toContain('sent');
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ confirmed: true, connection: expect.objectContaining({ accountId: account.accountId }) }));
    await provider.execute(ref, { body: 'Hello' }, approval.id, { toolCallId: 'replay' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not expose restricted identities to agent descriptors or let explicit IDs bypass account policy', async () => {
    const a = activeConnection(); const b = activeConnection('secret-account');
    updateConnectorAccount(b.accountId!, { allowedAgentIds: [] });
    upsertConnectorActionMetadata({ connectorId: need.connectorId, actionId: 'GMAIL_FETCH_EMAILS', toolkit: 'gmail', scope: 'read', curated: true,
      inputSchema: { type: 'object' }, cachedAt: new Date().toISOString() });
    const execute = vi.fn();
    const provider = new ComposioToolProvider({ getConfig: () => config, getCurrentContext: () => ({ conversationId, channel: 'webchat', chatId: conversationId }),
      adapter: { syncConnections, executeWithPolicy: execute } as unknown as ComposioSessionsAdapter });
    const ref = 'composio:composio-gmail-local-owner:GMAIL_FETCH_EMAILS';
    const description = JSON.stringify(await provider.describe(ref));
    expect(description).toContain(a.accountId);
    expect(description).not.toContain('secret-account');
    await provider.execute(ref, { xopcAccountId: b.accountId }, undefined, { toolCallId: 'denied' });
    expect(execute).not.toHaveBeenCalled();
    expect(recovery.snapshot(conversationId).wait?.needs[0].accounts).toHaveLength(0);
  });

  function writeFixture(execute: (input: { beforeExecute?: () => void }) => Promise<unknown>, confirmationPolicy: 'never' | 'writes' = 'never') {
    const connection = activeConnection();
    upsertConnectorInstallation({ ...getConnectorInstallation('composio-gmail-local-owner')!, maxScope: 'write', confirmationPolicy });
    const action = { connectorId: need.connectorId, actionId: 'GMAIL_SEND_EMAIL', toolkit: 'gmail', scope: 'write' as const,
      curated: true, inputSchema: { type: 'object', properties: { body: { type: 'string' } } }, cachedAt: new Date().toISOString() };
    upsertConnectorActionMetadata(action);
    const provider = new ComposioToolProvider({ getConfig: () => config,
      getCurrentContext: () => ({ conversationId, channel: 'webchat', chatId: conversationId }),
      adapter: { syncConnections, executeWithPolicy: execute } as unknown as ComposioSessionsAdapter });
    const call = (toolCallId = 'intent', body = 'Hello', approvalId?: string) => provider.execute(
      'composio:composio-gmail-local-owner:GMAIL_SEND_EMAIL', { body }, approvalId, { toolCallId });
    return { connection, action, call };
  }

  it('replays Composio receipts after reopen, rejects changed intent, and permits a distinct intent', async () => {
    const execute = vi.fn(async (input: { beforeExecute?: () => void }) => {
      input.beforeExecute?.();
      return { decision: 'allowed', result: { sent: true } };
    });
    const { call } = writeFixture(execute);
    const result = await call();
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
    expect(await call()).toEqual(result);
    await expect(call('intent', 'Changed')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await call('second-intent');
    expect(execute).toHaveBeenCalledTimes(2);
    upsertConnectorInstallation({ ...getConnectorInstallation('composio-gmail-local-owner')!, maxScope: 'read' });
    await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('never resends an uncertain Composio action', async () => {
    const execute = vi.fn(async (input: { beforeExecute?: () => void }) => {
      input.beforeExecute?.();
      throw new Error('Provider accepted the action but the response was lost');
    });
    const { call } = writeFixture(execute);
    await expect(call()).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    await expect(call()).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('retains an unsuccessful provider response as evidence without declaring the write unapplied', async () => {
    const execute = vi.fn(async (input: { beforeExecute?: () => void }) => {
      input.beforeExecute?.();
      return { decision: 'allowed', result: { successful: false, error: 'Remote response incomplete' } };
    });
    const { call } = writeFixture(execute);
    await expect(call()).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    await expect(call()).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(getSqliteDatabase().prepare('SELECT evidence_json FROM capability_operations').get()!.evidence_json).toContain('Remote response incomplete');
  });

  it('claims concurrent Composio writes once and rechecks authorization after session setup', async () => {
    let finish!: () => void;
    const send = vi.fn();
    const execute = vi.fn(async (input: { beforeExecute?: () => void }) => {
      await new Promise<void>(resolve => { finish = resolve; });
      input.beforeExecute?.();
      send();
      return { decision: 'allowed', result: {} };
    });
    const { call } = writeFixture(execute);
    const first = call();
    const rejected = expect(first).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    await expect(call()).rejects.toMatchObject({ code: 'IN_PROGRESS' });
    upsertConnectorInstallation({ ...getConnectorInstallation('composio-gmail-local-owner')!, maxScope: 'read' });
    finish();
    await rejected;
    expect(send).not.toHaveBeenCalled();
  });

  it('binds Composio approval to the exact contract but not metadata cache time', async () => {
    const execute = vi.fn(async (input: { beforeExecute?: () => void }) => {
      input.beforeExecute?.();
      return { decision: 'allowed', result: {} };
    });
    const { call, action } = writeFixture(execute, 'writes');
    await call();
    const approval = listConnectorApprovals({ status: 'pending' })[0]!;
    decideConnectorApproval(approval.id, 'approved');
    upsertConnectorActionMetadata({ ...action, inputSchema: { type: 'object' } });
    expect(JSON.stringify(await call('changed-contract', 'Hello', approval.id))).toContain('invalid');
    expect(execute).not.toHaveBeenCalled();
    upsertConnectorActionMetadata({ ...action, cachedAt: '2030-01-01T00:00:00.000Z' });
    await call('approved', 'Hello', approval.id);
    await call('replay', 'Hello', approval.id);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(listConnectorApprovals({ status: 'consumed' })).toHaveLength(1);
  });
  function action(action: ConnectionAction['action'], extra: Partial<ConnectionAction> = {}): ConnectionAction {
    const wait = getActiveConnectionWait(conversationId)!;
    return { action, waitId: wait.id, expectedTranscriptId: wait.transcriptId, expectedVersion: wait.version, idempotencyKey: crypto.randomUUID(), ...extra };
  }

  it('does not advertise schema-less Slack tools and preserves usable contracts across searches', async () => {
    upsertConnectorInstallation({ id: 'composio-slack-local-owner', connectorId: 'composio-slack', principalId: 'local-owner',
      enabled: true, allowedAgentIds: [], maxScope: 'read', confirmationPolicy: 'writes', selectedAccountIds: null });
    const search = vi.fn().mockResolvedValue({ toolSchemas: {
      SLACK_SEARCH_ALL: { description: 'Search messages' },
      SLACK_TEST_AUTH: { inputSchema: { type: 'object', properties: {} } },
    } });
    const provider = new ComposioToolProvider({ getConfig: () => config, getCurrentContext: () => ({ conversationId, channel: 'webchat', chatId: conversationId }),
      adapter: { createSession: async () => ({ search }) } as unknown as ComposioSessionsAdapter });
    expect((await provider.search('slack')).map(hit => hit.title)).toEqual(['SLACK_TEST_AUTH']);
    const ref = 'composio:composio-slack-local-owner:SLACK_TEST_AUTH';
    expect(await provider.describe(ref)).toBeTruthy();
    search.mockResolvedValue({ toolSchemas: { SLACK_TEST_AUTH: {} } });
    expect(await provider.search('slack')).toEqual([]);
    expect(await provider.describe(ref)).toBeTruthy();
  });

  it('isolates toolkit discovery failures so Twitter cannot block YouTube', async () => {
    upsertConnectorInstallation({ id: 'composio-gmail-local-owner', connectorId: 'composio-gmail', principalId: 'local-owner',
      enabled: false, allowedAgentIds: [], maxScope: 'read', confirmationPolicy: 'writes', selectedAccountIds: null });
    config.connectors!.instances = {
      'composio-twitter': {
        xopcConnector: { managed: true, connectorId: 'composio-twitter', enabled: true },
        runtime: { type: 'composio', role: 'toolkit', toolkit: 'twitter' },
      },
      'composio-youtube': {
        xopcConnector: { managed: true, connectorId: 'composio-youtube', enabled: true },
        runtime: { type: 'composio', role: 'toolkit', toolkit: 'youtube' },
      },
    };
    for (const toolkit of ['twitter', 'youtube']) {
      upsertConnectorInstallation({ id: `composio-${toolkit}-local-owner`, connectorId: `composio-${toolkit}`, principalId: 'local-owner',
        enabled: true, allowedAgentIds: [], maxScope: 'read', confirmationPolicy: 'writes', selectedAccountIds: null });
    }
    const createSession = vi.fn(async (context: { toolkits?: string[] }) => {
      const toolkit = context.toolkits?.[0];
      if (toolkit === 'twitter') {
        throw Object.assign(new Error('Twitter requires an explicit auth config.'), { status: 400 });
      }
      return {
        search: vi.fn(async () => ({
          toolSchemas: {
            YOUTUBE_SEARCH_YOU_TUBE: {
              description: 'Search YouTube',
              inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
            },
          },
        })),
      };
    });
    const provider = new ComposioToolProvider({
      getConfig: () => config,
      getCurrentContext: () => ({ conversationId, channel: 'webchat', chatId: conversationId }),
      adapter: { createSession } as unknown as ComposioSessionsAdapter,
    });

    await expect(provider.search('youtube')).resolves.toEqual([
      expect.objectContaining({ namespace: 'youtube', title: 'YOUTUBE_SEARCH_YOU_TUBE' }),
    ]);
    expect(createSession.mock.calls.map(([context]) => context.toolkits)).toEqual([
      ['twitter'],
      ['youtube'],
    ]);
  });

  it('does not request OAuth again for the selected account during a continuation', async () => {
    requireWait(); activeConnection();
    await recovery.act(conversationId, action('continue'));
    finishSessionInputRun(conversationId, 'run-original', 'suspended');
    const input = claimNextSessionInput(conversationId, 'run-resume')!;
    expect(consumeConnectionResume(input)).toBe(true);
    const tool = createExternalToolGatewayTools([], () => ({ conversationId, channel: 'webchat', chatId: conversationId }))
      .find(tool => tool.name === 'xopc_require_connection')!;
    const result = await tool.execute('request-again', {
      requirements: [{ candidateRef: 'composio-gmail' }], purpose: 'Missing email tools',
      checkpoint: { completedSteps: [], pendingSteps: ['Read mail'] },
    });
    expect(JSON.stringify(result)).toContain('already_connected');
    expect(getActiveConnectionWait(conversationId)).toBeUndefined();
  });

  it('finishes local setup after selecting an existing Gmail account without another OAuth flow', async () => {
    vi.stubEnv('XOPC_COMPOSIO_API_KEY', 'test-composio-api-key');
    config.connectors.instances = {};
    requireWait(); activeConnection('connection-1'); activeConnection('connection-2');
    expect(recovery.snapshot(conversationId).wait?.needs[0].phase).toBe('choose_account');
    const selected = await recovery.act(conversationId, action('select_account', { needKey: need.key, accountId: 'account:connection-2' }));
    expect(selected.snapshot.wait?.phase).toBe('ready');
    expect(selected.snapshot.wait?.needs[0].connectionId).toBe('connection-2');
    expect(Object.keys(config.connectors.instances)).toContain('composio-gmail');
    expect(authorize).not.toHaveBeenCalled();
    expect(drain).not.toHaveBeenCalled();
    expect((await recovery.act(conversationId, action('continue'))).snapshot.wait?.phase).toBe('queued');
    expect(drain).toHaveBeenCalledOnce();
  });

  it('treats renewed authorizations for the same account as one choice and preserves an explicit binding', async () => {
    const original = activeConnection();
    upsertConnectorConnection({ ...original, id: 'renewed', providerConnectionId: 'renewed-provider', accountId: original.accountId });
    requireWait();
    expect(recovery.snapshot(conversationId).wait?.needs[0].accounts).toHaveLength(1);
    expect(recovery.snapshot(conversationId).wait?.phase).toBe('ready');
    const wait = getActiveConnectionWait(conversationId)!;
    updateConnectionWait({ ...wait, needs: [{ ...need, connectionId: original.id, accountId: original.accountId }] }, wait.version);
    expect(recovery.snapshot(conversationId).wait?.needs[0].connectionId).toBe(original.id);
    expect(recovery.snapshot(conversationId).wait?.needs[0].accounts).toHaveLength(1);
  });

  it('continues with a single existing account when local setup is missing', async () => {
    vi.stubEnv('XOPC_COMPOSIO_API_KEY', 'test-composio-api-key');
    config.connectors.instances = {};
    requireWait(); activeConnection();
    expect(recovery.snapshot(conversationId).wait?.phase).toBe('ready');
    expect((await recovery.act(conversationId, action('continue'))).snapshot.wait?.phase).toBe('queued');
    expect(authorize).not.toHaveBeenCalled();
    expect(Object.keys(config.connectors.instances)).toContain('composio-gmail');
  });

  it('clears an unrelated pending authorization when the user selects an existing account', async () => {
    requireWait();
    await recovery.act(conversationId, action('connect', { needKey: need.key }));
    activeConnection('existing');
    const selected = await recovery.act(conversationId, action('select_account', { needKey: need.key, accountId: 'account:existing' }));
    expect(selected.snapshot.wait?.phase).toBe('queued');
    expect(getActiveConnectionWait(conversationId)?.needs[0].attempt).toBeUndefined();
    expect(getActiveConnectionWait(conversationId)?.needs[0].connectionId).toBe('existing');
    expect(authorize).toHaveBeenCalledTimes(1);
  });

  it('merges repeated requirements into one wait without storing authorization URLs', () => {
    const first = requireWait();
    expect(requireWait().id).toBe(first.id);
    expect(requireWait().version).toBe(first.version);
    expect(first.summary).toContain('last week');
    expect(JSON.stringify(first)).not.toContain('https:');
  });
  it('preserves the wait through a gateway restart', () => {
    const wait = requireWait();
    finishSessionInputRun(conversationId, 'run-original', 'suspended');
    recoverSessionInputState();
    expect(getActiveConnectionWait(conversationId)?.id).toBe(wait.id);
    expect(getSessionInputState(conversationId).activeRunId).toBeUndefined();
  });
  it('creates OAuth URLs only on click and deduplicates a retried click', async () => {
    requireWait();
    expect(authorize).not.toHaveBeenCalled();
    const command = action('connect', { needKey: need.key });
    const response = await recovery.act(conversationId, command);
    expect(response.authorizationUrl).toBe('https://example.test/oauth');
    await recovery.act(conversationId, command);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(getActiveConnectionWait(conversationId))).not.toContain('https:');
  });
  it('continues once after a verified authorization from the current click', async () => {
    requireWait();
    await recovery.act(conversationId, action('connect', { needKey: need.key }));
    activeConnection();
    const checked = await recovery.act(conversationId, action('check'));
    const wait = getActiveConnectionWait(conversationId)!;
    expect(checked.snapshot.wait?.phase).toBe('queued');
    expect(wait.queuedInputId).toBeTruthy();
    finishSessionInputRun(conversationId, 'run-original', 'suspended');
    const input = claimNextSessionInput(conversationId, 'run-resume')!;
    expect(await recovery.preflight(input)).toBe(true);
    expect(consumeConnectionResume(input)).toBe(true);
    expect(consumeConnectionResume(input)).toBe(false);
    expect(getActiveConnectionWait(conversationId)).toBeUndefined();
  });
  it('keeps an authorized account connected when the required tool contracts are missing', async () => {
    requireWait(); activeConnection();
    searchCapabilities.mockResolvedValue({ toolSchemas: { GMAIL_GET_PROFILE: { inputSchema: { type: 'object' } }, GMAIL_FETCH_EMAILS: {} } });
    const response = await recovery.act(conversationId, action('continue'));
    expect(response.snapshot.wait?.needs[0]).toMatchObject({ phase: 'blocked', unavailable: false, capabilityError: expect.stringContaining('required tools are unavailable') });
    expect(getActiveConnectionWait(conversationId)?.intent).toBeUndefined();
    expect(drain).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    await recovery.poll();
    expect(searchCapabilities).toHaveBeenCalledTimes(1);
    searchCapabilities.mockResolvedValue({ toolSchemas: { GMAIL_FETCH_EMAILS: { inputSchema: { type: 'object' } } } });
    expect((await recovery.act(conversationId, action('check'))).snapshot.wait?.phase).toBe('ready');
    expect(drain).not.toHaveBeenCalled();
    expect((await recovery.act(conversationId, action('continue'))).snapshot.wait?.phase).toBe('queued');
  });

  it('preserves authorization on a tool-check network error', async () => {
    requireWait(); activeConnection();
    searchCapabilities.mockRejectedValue(new Error('network unavailable'));
    const response = await recovery.act(conversationId, action('continue'));
    expect(response.snapshot.wait?.needs[0]).toMatchObject({ phase: 'blocked', unavailable: false, capabilityError: expect.stringContaining('could not be checked') });
    expect(authorize).not.toHaveBeenCalled();
    expect(drain).not.toHaveBeenCalled();
  });

  it('rechecks capability availability before consuming a queued continuation', async () => {
    requireWait(); activeConnection();
    await recovery.act(conversationId, action('continue'));
    finishSessionInputRun(conversationId, 'run-original', 'suspended');
    const input = claimNextSessionInput(conversationId, 'run-resume')!;
    searchCapabilities.mockResolvedValue({ toolSchemas: {} });
    expect(await recovery.preflight(input)).toBe(false);
    expect(getActiveConnectionWait(conversationId)?.needs[0]?.capabilityError).toBeTruthy();
    expect(getActiveConnectionWait(conversationId)?.status).toBe('open');
  });

  it('does not auto-resume when the account was connected in settings', async () => {
    requireWait(); activeConnection();
    await recovery.act(conversationId, action('check'));
    expect(getActiveConnectionWait(conversationId)?.status).toBe('open');
    expect(drain).not.toHaveBeenCalled();
  });
  it('requires explicit account selection when several accounts are connected', async () => {
    requireWait(); activeConnection(); activeConnection('connection-2');
    expect(recovery.snapshot(conversationId).wait?.needs[0].phase).toBe('choose_account');
    await recovery.act(conversationId, action('continue'));
    expect(drain).not.toHaveBeenCalled();
    await recovery.act(conversationId, action('select_account', { needKey: need.key, accountId: 'account:connection-2' }));
    expect(getActiveConnectionWait(conversationId)?.needs[0].connectionId).toBe('connection-2');
  });
  it('requires review of a delayed objective before resuming', async () => {
    const wait = requireWait(); activeConnection();
    updateConnectionWait({ ...wait, createdAt: Date.now() - 86_400_000 }, wait.version);
    await recovery.act(conversationId, action('continue'));
    expect(recovery.snapshot(conversationId).wait?.phase).toBe('review_scope');
    expect(drain).not.toHaveBeenCalled();
    await recovery.act(conversationId, action('confirm_scope'));
    expect(drain).toHaveBeenCalledOnce();
  });
  it('cancels a queued continuation when newer user input arrives', async () => {
    const wait = requireWait(); activeConnection();
    const queued = queueConnectionResolution(wait, 'continued');
    invalidateConnectionResumeIntent(conversationId);
    expect(getSessionInputById(conversationId, queued.queuedInputId!)?.status).toBe('cancelled');
    expect(getActiveConnectionWait(conversationId)?.intent).toBeUndefined();
    expect(getActiveConnectionWait(conversationId)?.reviewRequired).toBe(true);
  });
  it('rejects an old action after reset even if the authorization completes', async () => {
    requireWait();
    const command = action('connect', { needKey: need.key });
    resetSessionRecord(conversationId, dir); activeConnection();
    await expect(recovery.act(conversationId, command)).rejects.toThrow('SESSION_CHANGED');
    expect(authorize).not.toHaveBeenCalled();
    expect(recovery.snapshot(conversationId).wait).toBeNull();
  });
  it('does not resurrect a cancelled wait from a late authorization result', async () => {
    const wait = requireWait();
    let complete!: (value: unknown) => void;
    authorize.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const promise = recovery.act(conversationId, action('connect', { needKey: need.key }));
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledOnce());
    cancelConnectionObjective(conversationId);
    complete({ connectionId: 'late', status: 'ACTIVE', connectUrl: 'https://example.test/oauth' });
    await expect(promise).rejects.toThrow('WAIT_CHANGED');
    expect(getConnectionWait(wait.id)?.resolution).toBe('cancelled');
    expect(drain).not.toHaveBeenCalled();
  });
  it('keeps network failures distinct from revoked authorization', async () => {
    requireWait(); const connection = activeConnection();
    syncConnections.mockRejectedValueOnce(new Error('Network unavailable'));
    await expect(recovery.act(conversationId, action('check'))).rejects.toThrow('Network unavailable');
    expect(listConnectorConnections({ principalId: 'local-owner' })[0].status).toBe(connection.status);
    expect(getActiveConnectionWait(conversationId)?.status).toBe('open');
  });
  it('rechecks revocation in the worker and preserves the objective', async () => {
    requireWait(); const connection = activeConnection();
    await recovery.act(conversationId, action('continue'));
    finishSessionInputRun(conversationId, 'run-original', 'suspended');
    const input = claimNextSessionInput(conversationId, 'run-resume')!;
    upsertConnectorConnection({ ...connection, status: 'revoked' });
    expect(await recovery.preflight(input)).toBe(false);
    expect(getActiveConnectionWait(conversationId)?.status).toBe('open');
  });
  it('persists skip suppression in the internal continuation', () => {
    const wait = requireWait(); queueConnectionResolution(wait, 'skipped');
    finishSessionInputRun(conversationId, 'run-original', 'suspended');
    const input = claimNextSessionInput(conversationId, 'run-skip')!;
    expect(consumeConnectionResume(input)).toBe(true);
    expect(requireSessionConnection({ conversationId, principalId: 'local-owner', agentId: 'main', summary: 'Read Gmail', needs: [need] }).status).toBe('skipped');
  });
  it('does not turn an installation policy denial into an OAuth retry', async () => {
    requireWait();
    upsertConnectorInstallation({ id: 'composio-gmail-local-owner', connectorId: 'composio-gmail', principalId: 'local-owner', enabled: false,
      allowedAgentIds: [], maxScope: 'read', confirmationPolicy: 'writes', selectedAccountIds: null });
    await expect(recovery.act(conversationId, action('connect', { needKey: need.key }))).rejects.toThrow('policy');
    expect(authorize).not.toHaveBeenCalled();
  });
  it('checks authorization and queues continuation without a connected browser', async () => {
    requireWait();
    await recovery.act(conversationId, action('connect', { needKey: need.key }));
    activeConnection();
    await recovery.poll();
    expect(getActiveConnectionWait(conversationId)?.status).toBe('queued');
    expect(drain).toHaveBeenCalledOnce();
  });
  it('can retry after worker preflight fails, using a fresh queue identity', async () => {
    requireWait(); const connection = activeConnection();
    await recovery.act(conversationId, action('continue'));
    finishSessionInputRun(conversationId, 'run-original', 'suspended');
    const first = claimNextSessionInput(conversationId, 'run-first')!;
    upsertConnectorConnection({ ...connection, status: 'revoked' });
    expect(await recovery.preflight(first)).toBe(false);
    finishSessionInputRun(conversationId, 'run-first', 'cancelled');
    activeConnection();
    await recovery.act(conversationId, action('continue'));
    const second = claimNextSessionInput(conversationId, 'run-second')!;
    expect(second.id).not.toBe(first.id);
    expect(await recovery.preflight(second)).toBe(true);
  });
  it('keeps a domain TaskRun waiting until the typed continuation is claimed', () => {
    const task = new TaskRepository().create({ title: 'Mail review', objective: 'Read email' });
    const runs = new TaskRunRepository();
    const run = runs.create({ taskId: task.id, executorKind: 'agent', executorRef: { agentId: 'main' },
      trigger: {}, correlationId: 'task-domain', idempotencyKey: 'task-domain', contractVersion: 1, conversationId });
    getSqliteDatabase().prepare('UPDATE session_inputs SET task_run_id = ? WHERE id = ?').run(run.id, 'origin');
    const wait = requireWait();
    expect(runs.get(run.id)?.status).toBe('waiting');
    expect(runs.claimNext({ owner: 'other-worker', leaseMs: 1000 })).toBeUndefined();
    queueConnectionResolution(wait, 'skipped');
    finishSessionInputRun(conversationId, 'run-original', 'suspended');
    const input = claimNextSessionInput(conversationId, 'gateway-resume')!;
    expect(input.taskRunId).toBe(run.id);
    expect(input.runId).not.toBe(run.id);
    expect(runs.claimNext({ owner: 'other-worker', leaseMs: 1000 })).toBeUndefined();
    expect(consumeConnectionResume(input)).toBe(true);
    expect(runs.get(run.id)?.status).toBe('running');
  });
  it('never exposes the removed connect tool or an OAuth URL during discovery', async () => {
    const provider = new ComposioToolProvider({ getConfig: () => config,
      getCurrentContext: () => ({ conversationId, channel: 'webchat', chatId: conversationId }),
      adapter: { createSession: async () => ({ search: async () => ({ toolSchemas: { GMAIL_FETCH_EMAILS: { inputSchema: { type: 'object' } } } }) }) } as unknown as ComposioSessionsAdapter });
    const hits = await provider.search('Gmail');
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('GMAIL_FETCH_EMAILS');
    expect(JSON.stringify(hits)).not.toContain('$connect');
    expect(await provider.describe('composio:composio-gmail-local-owner:$connect')).toBeUndefined();
  });
  it('keeps two account selectors distinct while merging repeated needs', () => {
    requireSessionConnection({ conversationId, principalId: 'local-owner', agentId: 'main', summary: 'Compare two inboxes',
      needs: [{ ...need, key: 'gmail:work', accountSelector: 'Work' }, { ...need, key: 'gmail:personal', accountSelector: 'Personal' }] });
    activeConnection();
    const view = recovery.snapshot(conversationId).wait!;
    expect(view.needs).toHaveLength(2);
    expect(view.needs.every(item => item.phase === 'choose_account')).toBe(true);
  });
  it('requires a deliberate source change and leaves unrelated apps unable to satisfy Gmail', async () => {
    requireWait();
    await recovery.act(conversationId, action('replace_source', { needKey: need.key, candidateRef: 'composio-outlook' }));
    expect(getActiveConnectionWait(conversationId)?.needs[0].connectorId).toBe('composio-outlook');
    expect(getActiveConnectionWait(conversationId)?.summary).toContain('as confirmed by the user');
    expect(drain).not.toHaveBeenCalled();
  });

  it('installs a missing Gmail connector on the first explicit connect action', async () => {
    vi.stubEnv('XOPC_STATE_DIR', dir);
    vi.stubEnv('COMPOSIO_API_KEY', 'test-only-key');
    delete config.connectors!.instances['composio-gmail'];
    requireWait();
    await recovery.act(conversationId, action('connect', { needKey: need.key }));
    expect(config.connectors!.instances['composio-gmail']).toBeDefined();
    expect(authorize).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ principalId: 'local-owner', toolkit: 'gmail' }));
  });
  it('does not mistake insufficient action permissions for missing OAuth', () => {
    requireSessionConnection({ conversationId, principalId: 'local-owner', agentId: 'main', summary: 'Send email', needs: [{ ...need, capabilities: ['GMAIL_SEND_EMAIL'] }] });
    activeConnection();
    const view = recovery.snapshot(conversationId).wait!;
    expect(view.needs[0].phase).toBe('blocked');
    expect(view.needs[0].reason).toContain('permissions');
  });

});
