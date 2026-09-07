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
import { listConnectorConnections, upsertConnectorConnection, upsertConnectorInstallation } from '../../storage/sqlite/connector-repository.js';
import { ConnectionRecoveryService, type ConnectionAction } from '../connection-recovery-service.js';
import { resolveConnectionCandidate } from '../connection-candidates.js';
import type { ComposioSessionsAdapter } from '../composio-sessions.js';

const sessionKey = 'agent:main:webchat:default:direct:recovery';
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
    ensureSessionRecord(sessionKey, dir);
    config = ConfigSchema.parse({});
    config.connectors = { instances: {} };
    config.connectors.instances['composio-gmail'] = {
      xopcConnector: { managed: true, connectorId: 'composio-gmail', enabled: true },
      runtime: { type: 'composio', role: 'toolkit', toolkit: 'gmail' },
    };
    upsertConnectorInstallation({ id: 'composio-gmail-local-owner', connectorId: 'composio-gmail', principalId: 'local-owner',
      enabled: true, allowedAgentIds: [], maxScope: 'read', confirmationPolicy: 'writes', selectedConnectionIds: [] });
    insertSessionInput({ id: 'origin', sessionKey, clientMessageId: 'origin', requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'Summarize my unread Gmail messages from last week.', origin });
    claimNextSessionInput(sessionKey, 'run-original');
    syncConnections.mockImplementation(async () => listConnectorConnections({ principalId: 'local-owner' }));
    authorize.mockResolvedValue({ toolkit: 'gmail', connectionId: 'provider-1', connectUrl: 'https://example.test/oauth', status: 'INITIATED' });
    searchCapabilities.mockResolvedValue({ toolSchemas: { GMAIL_FETCH_EMAILS: { inputSchema: { type: 'object' } } } });
    recovery = new ConnectionRecoveryService({ getConfig: () => config, saveConfig: vi.fn(async () => ({ saved: true })), drain,
      adapter: { authorize, syncConnections, createSession: async () => ({ search: searchCapabilities }) } as unknown as ComposioSessionsAdapter });
  });
  afterEach(() => { vi.unstubAllEnvs(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true }); });

  function requireWait() {
    requireSessionConnection({ sessionKey, principalId: 'local-owner', agentId: 'main', summary: 'Read Gmail', needs: [need] });
    return getActiveConnectionWait(sessionKey)!;
  }
  function activeConnection(id = 'connection-1') {
    return upsertConnectorConnection({ id, connectorId: need.connectorId, provider: 'composio', principalId: 'local-owner',
      providerConnectionId: id === 'connection-1' ? 'provider-1' : id, identity: { email: `${id}@example.test` }, status: 'active', isDefault: false, metadata: {} });
  }
  function action(action: ConnectionAction['action'], extra: Partial<ConnectionAction> = {}): ConnectionAction {
    const wait = getActiveConnectionWait(sessionKey)!;
    return { action, waitId: wait.id, expectedSessionId: wait.sessionId, expectedVersion: wait.version, idempotencyKey: crypto.randomUUID(), ...extra };
  }

  it('does not advertise schema-less Slack tools and preserves usable contracts across searches', async () => {
    upsertConnectorInstallation({ id: 'composio-slack-local-owner', connectorId: 'composio-slack', principalId: 'local-owner',
      enabled: true, allowedAgentIds: [], maxScope: 'read', confirmationPolicy: 'writes', selectedConnectionIds: [] });
    const search = vi.fn().mockResolvedValue({ toolSchemas: {
      SLACK_SEARCH_ALL: { description: 'Search messages' },
      SLACK_TEST_AUTH: { inputSchema: { type: 'object', properties: {} } },
    } });
    const provider = new ComposioToolProvider({ getConfig: () => config, getCurrentContext: () => ({ sessionKey, channel: 'webchat', chatId: sessionKey }),
      adapter: { createSession: async () => ({ search }) } as unknown as ComposioSessionsAdapter });
    expect((await provider.search('slack')).map(hit => hit.title)).toEqual(['SLACK_TEST_AUTH']);
    const ref = 'composio:composio-slack-local-owner:SLACK_TEST_AUTH';
    expect(await provider.describe(ref)).toBeTruthy();
    search.mockResolvedValue({ toolSchemas: { SLACK_TEST_AUTH: {} } });
    expect(await provider.search('slack')).toEqual([]);
    expect(await provider.describe(ref)).toBeTruthy();
  });

  it('does not request OAuth again for the selected account during a continuation', async () => {
    requireWait(); activeConnection();
    await recovery.act(sessionKey, action('continue'));
    finishSessionInputRun(sessionKey, 'run-original', 'suspended');
    const input = claimNextSessionInput(sessionKey, 'run-resume')!;
    expect(consumeConnectionResume(input)).toBe(true);
    const tool = createExternalToolGatewayTools([], () => ({ sessionKey, channel: 'webchat', chatId: sessionKey }))
      .find(tool => tool.name === 'xopc_require_connection')!;
    const result = await tool.execute('request-again', {
      requirements: [{ candidateRef: 'composio-gmail' }], purpose: 'Missing email tools',
      checkpoint: { completedSteps: [], pendingSteps: ['Read mail'] },
    });
    expect(JSON.stringify(result)).toContain('already_connected');
    expect(getActiveConnectionWait(sessionKey)).toBeUndefined();
  });

  it('finishes local setup after selecting an existing Gmail account without another OAuth flow', async () => {
    vi.stubEnv('XOPC_COMPOSIO_API_KEY', 'test-composio-api-key');
    config.connectors.instances = {};
    requireWait(); activeConnection('connection-1'); activeConnection('connection-2');
    expect(recovery.snapshot(sessionKey).wait?.needs[0].phase).toBe('choose_account');
    const selected = await recovery.act(sessionKey, action('select_account', { needKey: need.key, accountId: 'connection-2' }));
    expect(selected.snapshot.wait?.phase).toBe('ready');
    expect(selected.snapshot.wait?.needs[0].connectionId).toBe('connection-2');
    expect(Object.keys(config.connectors.instances)).toContain('composio-gmail');
    expect(authorize).not.toHaveBeenCalled();
    expect(drain).not.toHaveBeenCalled();
    expect((await recovery.act(sessionKey, action('continue'))).snapshot.wait?.phase).toBe('queued');
    expect(drain).toHaveBeenCalledOnce();
  });

  it('treats renewed authorizations for the same account as one choice and preserves an explicit binding', async () => {
    const original = activeConnection();
    upsertConnectorConnection({ ...original, id: 'renewed', providerConnectionId: 'renewed-provider', accountId: original.accountId });
    requireWait();
    expect(recovery.snapshot(sessionKey).wait?.needs[0].accounts).toHaveLength(1);
    expect(recovery.snapshot(sessionKey).wait?.phase).toBe('ready');
    const wait = getActiveConnectionWait(sessionKey)!;
    updateConnectionWait({ ...wait, needs: [{ ...need, connectionId: original.id, accountId: original.accountId }] }, wait.version);
    expect(recovery.snapshot(sessionKey).wait?.needs[0].connectionId).toBe(original.id);
    expect(recovery.snapshot(sessionKey).wait?.needs[0].accounts).toHaveLength(1);
  });

  it('continues with a single existing account when local setup is missing', async () => {
    vi.stubEnv('XOPC_COMPOSIO_API_KEY', 'test-composio-api-key');
    config.connectors.instances = {};
    requireWait(); activeConnection();
    expect(recovery.snapshot(sessionKey).wait?.phase).toBe('ready');
    expect((await recovery.act(sessionKey, action('continue'))).snapshot.wait?.phase).toBe('queued');
    expect(authorize).not.toHaveBeenCalled();
    expect(Object.keys(config.connectors.instances)).toContain('composio-gmail');
  });

  it('clears an unrelated pending authorization when the user selects an existing account', async () => {
    requireWait();
    await recovery.act(sessionKey, action('connect', { needKey: need.key }));
    activeConnection('existing');
    const selected = await recovery.act(sessionKey, action('select_account', { needKey: need.key, accountId: 'existing' }));
    expect(selected.snapshot.wait?.phase).toBe('queued');
    expect(getActiveConnectionWait(sessionKey)?.needs[0].attempt).toBeUndefined();
    expect(getActiveConnectionWait(sessionKey)?.needs[0].connectionId).toBe('existing');
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
    finishSessionInputRun(sessionKey, 'run-original', 'suspended');
    recoverSessionInputState();
    expect(getActiveConnectionWait(sessionKey)?.id).toBe(wait.id);
    expect(getSessionInputState(sessionKey).activeRunId).toBeUndefined();
  });
  it('creates OAuth URLs only on click and deduplicates a retried click', async () => {
    requireWait();
    expect(authorize).not.toHaveBeenCalled();
    const command = action('connect', { needKey: need.key });
    const response = await recovery.act(sessionKey, command);
    expect(response.authorizationUrl).toBe('https://example.test/oauth');
    await recovery.act(sessionKey, command);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(getActiveConnectionWait(sessionKey))).not.toContain('https:');
  });
  it('continues once after a verified authorization from the current click', async () => {
    requireWait();
    await recovery.act(sessionKey, action('connect', { needKey: need.key }));
    activeConnection();
    const checked = await recovery.act(sessionKey, action('check'));
    const wait = getActiveConnectionWait(sessionKey)!;
    expect(checked.snapshot.wait?.phase).toBe('queued');
    expect(wait.queuedInputId).toBeTruthy();
    finishSessionInputRun(sessionKey, 'run-original', 'suspended');
    const input = claimNextSessionInput(sessionKey, 'run-resume')!;
    expect(await recovery.preflight(input)).toBe(true);
    expect(consumeConnectionResume(input)).toBe(true);
    expect(consumeConnectionResume(input)).toBe(false);
    expect(getActiveConnectionWait(sessionKey)).toBeUndefined();
  });
  it('keeps an authorized account connected when the required tool contracts are missing', async () => {
    requireWait(); activeConnection();
    searchCapabilities.mockResolvedValue({ toolSchemas: { GMAIL_GET_PROFILE: { inputSchema: { type: 'object' } }, GMAIL_FETCH_EMAILS: {} } });
    const response = await recovery.act(sessionKey, action('continue'));
    expect(response.snapshot.wait?.needs[0]).toMatchObject({ phase: 'blocked', unavailable: false, capabilityError: expect.stringContaining('required tools are unavailable') });
    expect(getActiveConnectionWait(sessionKey)?.intent).toBeUndefined();
    expect(drain).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    await recovery.poll();
    expect(searchCapabilities).toHaveBeenCalledTimes(1);
    searchCapabilities.mockResolvedValue({ toolSchemas: { GMAIL_FETCH_EMAILS: { inputSchema: { type: 'object' } } } });
    expect((await recovery.act(sessionKey, action('check'))).snapshot.wait?.phase).toBe('ready');
    expect(drain).not.toHaveBeenCalled();
    expect((await recovery.act(sessionKey, action('continue'))).snapshot.wait?.phase).toBe('queued');
  });

  it('preserves authorization on a tool-check network error', async () => {
    requireWait(); activeConnection();
    searchCapabilities.mockRejectedValue(new Error('network unavailable'));
    const response = await recovery.act(sessionKey, action('continue'));
    expect(response.snapshot.wait?.needs[0]).toMatchObject({ phase: 'blocked', unavailable: false, capabilityError: expect.stringContaining('could not be checked') });
    expect(authorize).not.toHaveBeenCalled();
    expect(drain).not.toHaveBeenCalled();
  });

  it('rechecks capability availability before consuming a queued continuation', async () => {
    requireWait(); activeConnection();
    await recovery.act(sessionKey, action('continue'));
    finishSessionInputRun(sessionKey, 'run-original', 'suspended');
    const input = claimNextSessionInput(sessionKey, 'run-resume')!;
    searchCapabilities.mockResolvedValue({ toolSchemas: {} });
    expect(await recovery.preflight(input)).toBe(false);
    expect(getActiveConnectionWait(sessionKey)?.needs[0]?.capabilityError).toBeTruthy();
    expect(getActiveConnectionWait(sessionKey)?.status).toBe('open');
  });

  it('does not auto-resume when the account was connected in settings', async () => {
    requireWait(); activeConnection();
    await recovery.act(sessionKey, action('check'));
    expect(getActiveConnectionWait(sessionKey)?.status).toBe('open');
    expect(drain).not.toHaveBeenCalled();
  });
  it('requires explicit account selection when several accounts are connected', async () => {
    requireWait(); activeConnection(); activeConnection('connection-2');
    expect(recovery.snapshot(sessionKey).wait?.needs[0].phase).toBe('choose_account');
    await recovery.act(sessionKey, action('continue'));
    expect(drain).not.toHaveBeenCalled();
    await recovery.act(sessionKey, action('select_account', { needKey: need.key, accountId: 'connection-2' }));
    expect(getActiveConnectionWait(sessionKey)?.needs[0].connectionId).toBe('connection-2');
  });
  it('requires review of a delayed objective before resuming', async () => {
    const wait = requireWait(); activeConnection();
    updateConnectionWait({ ...wait, createdAt: Date.now() - 86_400_000 }, wait.version);
    await recovery.act(sessionKey, action('continue'));
    expect(recovery.snapshot(sessionKey).wait?.phase).toBe('review_scope');
    expect(drain).not.toHaveBeenCalled();
    await recovery.act(sessionKey, action('confirm_scope'));
    expect(drain).toHaveBeenCalledOnce();
  });
  it('cancels a queued continuation when newer user input arrives', async () => {
    const wait = requireWait(); activeConnection();
    const queued = queueConnectionResolution(wait, 'continued');
    invalidateConnectionResumeIntent(sessionKey);
    expect(getSessionInputById(sessionKey, queued.queuedInputId!)?.status).toBe('cancelled');
    expect(getActiveConnectionWait(sessionKey)?.intent).toBeUndefined();
    expect(getActiveConnectionWait(sessionKey)?.reviewRequired).toBe(true);
  });
  it('rejects an old action after reset even if the authorization completes', async () => {
    requireWait();
    const command = action('connect', { needKey: need.key });
    resetSessionRecord(sessionKey, dir); activeConnection();
    await expect(recovery.act(sessionKey, command)).rejects.toThrow('SESSION_CHANGED');
    expect(authorize).not.toHaveBeenCalled();
    expect(recovery.snapshot(sessionKey).wait).toBeNull();
  });
  it('does not resurrect a cancelled wait from a late authorization result', async () => {
    const wait = requireWait();
    let complete!: (value: unknown) => void;
    authorize.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const promise = recovery.act(sessionKey, action('connect', { needKey: need.key }));
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledOnce());
    cancelConnectionObjective(sessionKey);
    complete({ connectionId: 'late', status: 'ACTIVE', connectUrl: 'https://example.test/oauth' });
    await expect(promise).rejects.toThrow('WAIT_CHANGED');
    expect(getConnectionWait(wait.id)?.resolution).toBe('cancelled');
    expect(drain).not.toHaveBeenCalled();
  });
  it('keeps network failures distinct from revoked authorization', async () => {
    requireWait(); const connection = activeConnection();
    syncConnections.mockRejectedValueOnce(new Error('Network unavailable'));
    await expect(recovery.act(sessionKey, action('check'))).rejects.toThrow('Network unavailable');
    expect(listConnectorConnections({ principalId: 'local-owner' })[0].status).toBe(connection.status);
    expect(getActiveConnectionWait(sessionKey)?.status).toBe('open');
  });
  it('rechecks revocation in the worker and preserves the objective', async () => {
    requireWait(); const connection = activeConnection();
    await recovery.act(sessionKey, action('continue'));
    finishSessionInputRun(sessionKey, 'run-original', 'suspended');
    const input = claimNextSessionInput(sessionKey, 'run-resume')!;
    upsertConnectorConnection({ ...connection, status: 'revoked' });
    expect(await recovery.preflight(input)).toBe(false);
    expect(getActiveConnectionWait(sessionKey)?.status).toBe('open');
  });
  it('persists skip suppression in the internal continuation', () => {
    const wait = requireWait(); queueConnectionResolution(wait, 'skipped');
    finishSessionInputRun(sessionKey, 'run-original', 'suspended');
    const input = claimNextSessionInput(sessionKey, 'run-skip')!;
    expect(consumeConnectionResume(input)).toBe(true);
    expect(requireSessionConnection({ sessionKey, principalId: 'local-owner', agentId: 'main', summary: 'Read Gmail', needs: [need] }).status).toBe('skipped');
  });
  it('does not turn an installation policy denial into an OAuth retry', async () => {
    requireWait();
    upsertConnectorInstallation({ id: 'composio-gmail-local-owner', connectorId: 'composio-gmail', principalId: 'local-owner', enabled: false,
      allowedAgentIds: [], maxScope: 'read', confirmationPolicy: 'writes', selectedConnectionIds: [] });
    await expect(recovery.act(sessionKey, action('connect', { needKey: need.key }))).rejects.toThrow('policy');
    expect(authorize).not.toHaveBeenCalled();
  });
  it('checks authorization and queues continuation without a connected browser', async () => {
    requireWait();
    await recovery.act(sessionKey, action('connect', { needKey: need.key }));
    activeConnection();
    await recovery.poll();
    expect(getActiveConnectionWait(sessionKey)?.status).toBe('queued');
    expect(drain).toHaveBeenCalledOnce();
  });
  it('can retry after worker preflight fails, using a fresh queue identity', async () => {
    requireWait(); const connection = activeConnection();
    await recovery.act(sessionKey, action('continue'));
    finishSessionInputRun(sessionKey, 'run-original', 'suspended');
    const first = claimNextSessionInput(sessionKey, 'run-first')!;
    upsertConnectorConnection({ ...connection, status: 'revoked' });
    expect(await recovery.preflight(first)).toBe(false);
    finishSessionInputRun(sessionKey, 'run-first', 'cancelled');
    activeConnection();
    await recovery.act(sessionKey, action('continue'));
    const second = claimNextSessionInput(sessionKey, 'run-second')!;
    expect(second.id).not.toBe(first.id);
    expect(await recovery.preflight(second)).toBe(true);
  });
  it('keeps a domain TaskRun waiting until the typed continuation is claimed', () => {
    const task = new TaskRepository().create({ title: 'Mail review', objective: 'Read email' });
    const runs = new TaskRunRepository();
    const run = runs.create({ taskId: task.id, executorKind: 'agent', executorRef: { agentId: 'main' },
      trigger: {}, correlationId: 'task-domain', idempotencyKey: 'task-domain', contractVersion: 1, sessionKey });
    getSqliteDatabase().prepare('UPDATE session_inputs SET task_run_id = ? WHERE id = ?').run(run.id, 'origin');
    const wait = requireWait();
    expect(runs.get(run.id)?.status).toBe('waiting');
    expect(runs.claimNext({ owner: 'other-worker', leaseMs: 1000 })).toBeUndefined();
    queueConnectionResolution(wait, 'skipped');
    finishSessionInputRun(sessionKey, 'run-original', 'suspended');
    const input = claimNextSessionInput(sessionKey, 'gateway-resume')!;
    expect(input.taskRunId).toBe(run.id);
    expect(input.runId).not.toBe(run.id);
    expect(runs.claimNext({ owner: 'other-worker', leaseMs: 1000 })).toBeUndefined();
    expect(consumeConnectionResume(input)).toBe(true);
    expect(runs.get(run.id)?.status).toBe('running');
  });
  it('never exposes the removed connect tool or an OAuth URL during discovery', async () => {
    const provider = new ComposioToolProvider({ getConfig: () => config,
      getCurrentContext: () => ({ sessionKey, channel: 'webchat', chatId: sessionKey }),
      adapter: { createSession: async () => ({ search: async () => ({ toolSchemas: { GMAIL_FETCH_EMAILS: { inputSchema: { type: 'object' } } } }) }) } as unknown as ComposioSessionsAdapter });
    const hits = await provider.search('Gmail');
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('GMAIL_FETCH_EMAILS');
    expect(JSON.stringify(hits)).not.toContain('$connect');
    expect(await provider.describe('composio:composio-gmail-local-owner:$connect')).toBeUndefined();
  });
  it('keeps two account selectors distinct while merging repeated needs', () => {
    requireSessionConnection({ sessionKey, principalId: 'local-owner', agentId: 'main', summary: 'Compare two inboxes',
      needs: [{ ...need, key: 'gmail:work', accountSelector: 'Work' }, { ...need, key: 'gmail:personal', accountSelector: 'Personal' }] });
    activeConnection();
    const view = recovery.snapshot(sessionKey).wait!;
    expect(view.needs).toHaveLength(2);
    expect(view.needs.every(item => item.phase === 'choose_account')).toBe(true);
  });
  it('requires a deliberate source change and leaves unrelated apps unable to satisfy Gmail', async () => {
    requireWait();
    await recovery.act(sessionKey, action('replace_source', { needKey: need.key, candidateRef: 'composio-outlook' }));
    expect(getActiveConnectionWait(sessionKey)?.needs[0].connectorId).toBe('composio-outlook');
    expect(getActiveConnectionWait(sessionKey)?.summary).toContain('as confirmed by the user');
    expect(drain).not.toHaveBeenCalled();
  });

  it('installs a missing Gmail connector on the first explicit connect action', async () => {
    vi.stubEnv('XOPC_STATE_DIR', dir);
    vi.stubEnv('COMPOSIO_API_KEY', 'test-only-key');
    delete config.connectors!.instances['composio-gmail'];
    requireWait();
    await recovery.act(sessionKey, action('connect', { needKey: need.key }));
    expect(config.connectors!.instances['composio-gmail']).toBeDefined();
    expect(authorize).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ principalId: 'local-owner', toolkit: 'gmail' }));
  });
  it('does not mistake insufficient action permissions for missing OAuth', () => {
    requireSessionConnection({ sessionKey, principalId: 'local-owner', agentId: 'main', summary: 'Send email', needs: [{ ...need, capabilities: ['GMAIL_SEND_EMAIL'] }] });
    activeConnection();
    const view = recovery.snapshot(sessionKey).wait!;
    expect(view.needs[0].phase).toBe('blocked');
    expect(view.needs[0].reason).toContain('permissions');
  });

});
