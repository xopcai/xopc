import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../../config/schema.js';
import { ScenePreferenceService } from '../../../scenes/preferences.js';
import { SceneMailContextProvider } from '../../../scenes/mailContext.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest, upsertKnowledgeSourceItems } from '../../../storage/sqlite/index.js';
import { upsertConnectorInstallation, upsertConnectorConnection } from '../../../storage/sqlite/connector-repository.js';
import { startKnowledgeSyncRun, finishKnowledgeSyncRun } from '../../../storage/sqlite/knowledge-repository.js';
import { runSceneCutover } from '../../../storage/sqlite/migrations/scenes/cutover.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { createBrowserSession } from '../../../storage/sqlite/browser-session-repository.js';
import { auth } from '../../hono/middleware/auth.js';
import { gatewayScopes } from '../../hono/middleware/scopes.js';
import type { AuthenticatedRouteDeps } from '../../hono/routes/deps.js';
import { registerAuthenticatedLazyRouteFallback, resetLazyRouteBundlesForTests } from '../../hono/routes/lazy-fallback.js';
import { GatewaySceneHost } from '../host.js';
import { GatewaySceneMailContext } from '../mailContext.js';

describe('Gateway scene host on a converted production database', () => {
  let directory: string;
  let db: DatabaseSync;
  let host: GatewaySceneHost;
  let server: ReturnType<typeof serve> | undefined;
  let origin: string;
  let now: number;
  let accountId: string;
  let sourceId: string;
  const execute = vi.fn();
  const publish = vi.fn();
  const principal = () => ({ ownerId: 'local-owner', workspaceId: directory });
  const makeHost = () => new GatewaySceneHost(db, { principal: principal(), config: () => ({} as Config),
    executor: { execute }, mail: new SceneMailContextProvider(db, () => now), publish, clock: () => now, intervalMs: 100 });
  const sync = () => {
    const run = startKnowledgeSyncRun({ sourceInstanceId: 'mail-source', collectionScope: 'inbox', nowMs: now });
    finishKnowledgeSyncRun({ runId: run.id, status: 'succeeded', nowMs: now });
  };
  const input = () => ({ templateKey: 'mail-follow-up', templateVersion: '1.0.0', goal: 'Confirm a review date',
    scope: { kind: 'objects', ids: [sourceId] }, permissions: { accountIds: [accountId], contextProviders: ['mail'], effectHandlers: [] } });
  const request = (path: string, method = 'GET', body?: unknown, key = 'request') => fetch(`${origin}/api/scenes${path}`, {
    method, headers: { authorization: 'Bearer scene-host', 'content-type': 'application/json', 'Idempotency-Key': key },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-scene-host-'));
    now = Date.parse('2026-09-20T04:00:00Z');
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'xopc.db') }); db = getSqliteDatabase();
    execute.mockReset().mockImplementation(async ({ evidence }) => ({ kind: 'artifact', summary: 'Could you confirm the review date?', evidenceIds: evidence.map((item) => item.id) }));
    publish.mockReset();
    upsertConnectorInstallation({ id: 'installation', connectorId: 'composio-gmail', principalId: 'local-owner', enabled: true,
      allowedAgentIds: [], maxScope: 'read', confirmationPolicy: 'writes', selectedAccountIds: null });
    const connection = upsertConnectorConnection({ id: 'connection', installationId: 'installation', connectorId: 'composio-gmail',
      provider: 'composio', principalId: 'local-owner', providerConnectionId: 'mail', identity: {}, status: 'active', isDefault: true, metadata: {} });
    accountId = connection.accountId!;
    sourceId = upsertKnowledgeSourceItems([{ sourceInstanceId: 'mail-source', collectionScope: 'inbox', externalId: 'message',
      itemType: 'email', occurredAt: new Date(now).toISOString(), contentHash: 'revision-1',
      normalizedText: JSON.stringify({ threadId: 'thread', subject: 'Review', content: 'Please confirm a review date.', labels: ['INBOX'] }),
      metadata: { workspaceId: directory, connectionId: connection.id }, sensitivity: 'personal', retentionClass: 'bounded',
      synthesisPipeline: 'connected_knowledge', synthesisStatus: 'pending' }]).items[0].id;
    sync();
    const configPath = join(directory, 'config.json'); writeFileSync(configPath, '{}');
    expect(makeHost).toThrow('conversion');
    await runSceneCutover({ db, configPath, backupRoot: directory, owners: [principal()], mailAccounts: [], checklists: [] });
    host = makeHost();
    resetLazyRouteBundlesForTests();
    const pass = async (_c, next) => { await next(); };
    const deps = { service: { currentWorkspacePath: directory }, scenes: host.http,
      strictRateLimitMiddleware: pass, chatRateLimitMiddleware: pass, xopcCloudPollRateLimitMiddleware: pass } as AuthenticatedRouteDeps;
    const app = new Hono();
    app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'scene-host', allowTailscale: false }) }));
    app.use(gatewayScopes()); registerAuthenticatedLazyRouteFallback(app, deps);
    await new Promise<void>((resolve) => { server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, resolve); });
    origin = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await host?.stop();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    server = undefined;
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); resetLazyRouteBundlesForTests();
    rmSync(directory, { recursive: true, force: true });
  });

  it('selects connected mail over authenticated HTTP and automatically publishes a due draft exactly once across restart', async () => {
    const sources = await (await request('/sources/mail')).json();
    expect(sources.sources).toMatchObject([{ id: sourceId, accountId }]);
    const response = await request('/activations', 'POST', input());
    expect(response.status).toBe(201);
    const { activation } = await response.json();
    expect(activation.ownerId).toBe('local-owner');
    expect((await request(`/activations/${activation.id}/work-items`, 'POST', { subjectId: sourceId, accountId, dueAt: now + 1000 })).status).toBe(201);
    now += 1000; sync();
    host.start(); host.start();
    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
    expect(execute).toHaveBeenCalledOnce();
    const results = await (await request('/outcomes')).json();
    expect(results.outcomes).toHaveLength(1);
    expect(results.outcomes[0].content.summary).toBe('Could you confirm the review date?');
    expect(publish.mock.calls[0]).toMatchObject(['notification.created', { type: 'scene.result', target: { kind: 'scene_result', activationId: activation.id } }]);
    expect(db.prepare('SELECT status FROM notification_result_outbox').get()?.status).toBe('settled');
    expect(db.prepare('SELECT count(*) AS n FROM notification_deliveries').get()?.n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM notification_dispatches').get()?.n).toBe(0);
    await host.stop(); host = makeHost(); host.start(); await host.tick();
    expect(execute).toHaveBeenCalledOnce(); expect(publish).toHaveBeenCalledOnce();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('rechecks actual account permissions before activation and before a scheduled execution', async () => {
    const activation = await host.http.application.start(principal(), input(), 'start');
    host.http.application.createWorkItem(principal(), activation.id, { subjectId: sourceId, accountId, dueAt: now + 1000 });
    db.prepare('UPDATE connector_accounts SET enabled = 0 WHERE id = ?').run(accountId);
    expect(await host.http.application.preflight(principal(), input())).toMatchObject({ ready: false });
    now += 1000; sync(); await host.tick();
    expect(execute).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
    expect(host.http.repository.listInbox(principal())).toEqual([]);
  });

  it('keeps the same scene and mailbox across token authentication and renewed browser sessions', async () => {
    const activation = await host.http.application.start(principal(), input(), 'start');
    for (let index = 0; index < 2; index++) {
      const session = createBrowserSession({ mode: 'token', token: 'scene-host', allowTailscale: false });
      const headers = { cookie: `xopc-local-session=${session.token}` };
      const response = await fetch(`${origin}/api/scenes/activations/${activation.id}`, { headers });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ activation: { ownerId: 'local-owner', id: activation.id } });
      const sources = await (await fetch(`${origin}/api/scenes/sources/mail`, { headers })).json();
      expect(sources.sources).toMatchObject([{ id: sourceId, accountId }]);
    }
  });

  it('rolls back an event if outbox acknowledgement fails, then recovers publication without rerunning the model', async () => {
    const activation = await host.http.application.start(principal(), input(), 'start');
    host.http.application.check(principal(), activation.id, 'check');
    db.exec(`CREATE TRIGGER reject_ack BEFORE UPDATE ON notification_result_outbox
      WHEN NEW.status = 'settled' BEGIN SELECT RAISE(ABORT, 'disk unavailable'); END`);
    await host.tick();
    expect(db.prepare('SELECT count(*) AS n FROM notification_events').get()?.n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM notification_attention_budget').get()?.n).toBe(0);
    expect(publish).not.toHaveBeenCalled();
    await host.stop(); db.exec('DROP TRIGGER reject_ack');
    now += 30001; host = makeHost(); await host.tick(); await host.tick();
    expect(publish).toHaveBeenCalledOnce(); expect(execute).toHaveBeenCalledOnce();
    expect(db.prepare('SELECT status FROM notification_result_outbox').get()?.status).toBe('settled');
  });

  it('drains a committed result after restart and cancels publication after permission revocation', async () => {
    const activation = await host.http.application.start(principal(), input(), 'start');
    host.http.application.check(principal(), activation.id, 'check');
    db.exec(`CREATE TRIGGER reject_publication BEFORE INSERT ON notification_events BEGIN SELECT RAISE(ABORT, 'disk unavailable'); END`);
    await host.tick();
    expect(host.http.repository.listInbox(principal())).toHaveLength(1);
    expect(db.prepare('SELECT count(*) AS n FROM notification_attention_budget').get()?.n).toBe(0);
    expect(publish).not.toHaveBeenCalled();
    await host.stop(); db.exec('DROP TRIGGER reject_publication');
    db.prepare('UPDATE connector_accounts SET enabled = 0 WHERE id = ?').run(accountId);
    now += 30001; host = makeHost(); await host.tick();
    expect(db.prepare('SELECT status, decision_reason FROM notification_result_outbox').get()).toMatchObject({ status: 'settled', decision_reason: 'permission_revoked' });
    expect(publish).not.toHaveBeenCalled(); expect(execute).toHaveBeenCalledOnce();
  });

  it('stops a pending model before database closure and discards its late result', async () => {
    let finish!: () => void;
    execute.mockImplementationOnce(async ({ evidence }) => { await new Promise<void>(resolve => { finish = resolve; }); return { kind: 'artifact', summary: 'Late', evidenceIds: evidence.map((item) => item.id) }; });
    const activation = await host.http.application.start(principal(), input(), 'start');
    host.http.application.check(principal(), activation.id, 'check');
    const running = host.tick(); await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    await host.stop(); await running; finish(); await Promise.resolve();
    expect(host.http.repository.listInbox(principal())).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
    await expect(host.tick()).rejects.toThrow('stopped');
  });

  it('honors pause and quiet hours while retaining a result for the page', async () => {
    const preferences = new ScenePreferenceService(db);
    preferences.update(principal(), { expectedRevision: 0, timezone: 'UTC', quietStartHour: 0, quietEndHour: 8 });
    const activation = await host.http.application.start(principal(), input(), 'start');
    host.http.application.check(principal(), activation.id, 'check'); await host.tick();
    expect(host.http.repository.listInbox(principal())).toHaveLength(1);
    expect(db.prepare('SELECT status, decision_reason FROM notification_result_outbox').get()).toMatchObject({ status: 'pending', decision_reason: 'quiet_hours' });
    await host.http.application.transition(principal(), activation.id, { expectedRevision: activation.revision, status: 'paused' });
    now += 5 * 3600000; await host.tick();
    expect(publish).not.toHaveBeenCalled(); expect(execute).toHaveBeenCalledOnce();
  });

  it('combines due results into one durable owner-scoped digest and does not replay it', async () => {
    new ScenePreferenceService(db).update(principal(), { expectedRevision: 0, digestEnabled: true,
      timezone: 'UTC', digestHour: 5, digestMinute: 0, quietStartHour: 0, quietEndHour: 0 });
    for (const key of ['first', 'second']) {
      const activation = await host.http.application.start(principal(), input(), key);
      host.http.application.check(principal(), activation.id, key); await host.tick();
    }
    expect(publish).not.toHaveBeenCalled();
    expect(db.prepare('SELECT count(*) AS n FROM notification_digest_queue').get()?.n).toBe(2);
    now += 3600000; await host.tick();
    expect(publish).toHaveBeenCalledOnce();
    const event = publish.mock.calls[0][1];
    expect(event.type).toBe('scene.digest');
    const response = await request(`/digests/${event.target.digestId}`);
    expect(response.status).toBe(200);
    expect((await response.json()).outcomes).toHaveLength(2);
    expect(db.prepare('SELECT count(*) AS n FROM notification_attention_budget').get()?.n).toBe(1);
    await host.stop(); host = makeHost(); await host.tick();
    expect(publish).toHaveBeenCalledOnce(); expect(execute).toHaveBeenCalledTimes(2);
  });

  it('keeps results visible when the notification budget is zero', async () => {
    new ScenePreferenceService(db).update(principal(), { expectedRevision: 0, dailyNotificationLimit: 0 });
    const activation = await host.http.application.start(principal(), input(), 'start');
    host.http.application.check(principal(), activation.id, 'check'); await host.tick();
    expect(host.http.repository.listInbox(principal())).toHaveLength(1);
    expect(db.prepare('SELECT decision_reason FROM notification_result_outbox').get()?.decision_reason).toBe('daily_budget');
    expect(publish).not.toHaveBeenCalled();
  });

  it('waits for a successful mail sync after the deadline and resumes without spending a model call early', async () => {
    const activation = await host.http.application.start(principal(), input(), 'start');
    host.http.application.createWorkItem(principal(), activation.id, { subjectId: sourceId, accountId, dueAt: now + 1000 });
    now += 1000; await host.tick();
    expect(execute).not.toHaveBeenCalled();
    expect(db.prepare('SELECT status, reason FROM scene_runs').get()).toMatchObject({ status: 'retry_wait', reason: 'source_not_ready' });
    now += 60000; sync(); await host.tick();
    expect(execute).toHaveBeenCalledOnce(); expect(publish).toHaveBeenCalledOnce();
  });

  describe('direct delegated Gmail thread reads', () => {
    const fetchThread = vi.fn();
    const message = (id = 'message', content = 'New live reply') => ({ id, threadId: 'thread', internalDate: String(now),
      labelIds: ['INBOX'], payload: { mimeType: 'text/plain', body: { data: Buffer.from(content).toString('base64url') } } });
    const response = (messages = [message()], nextPageToken?: string) => ({ decision: 'allowed',
      result: { successful: true, data: { messages, ...(nextPageToken ? { nextPageToken } : {}) } } });
    beforeEach(async () => {
      await host.stop();
      fetchThread.mockReset().mockImplementation(async () => response());
      host = new GatewaySceneHost(db, { principal: principal(), config: () => ({} as Config), executor: { execute }, publish,
        mail: new GatewaySceneMailContext(db, () => now, { executeWithPolicy: fetchThread }), clock: () => now, intervalMs: 100 });
      db.exec('DELETE FROM knowledge_sync_runs');
    });
    const check = async () => {
      const activation = await host.http.application.start(principal(), input(), 'live');
      host.http.application.check(principal(), activation.id, 'check'); await host.tick();
    };

    it('reads the delegated account and thread twice without mailbox sync, learning or mail writes', async () => {
      await check();
      expect(fetchThread).toHaveBeenCalledTimes(2);
      expect(fetchThread.mock.calls[0][0]).toMatchObject({ connection: { id: 'connection', accountId },
        action: { actionId: 'GMAIL_FETCH_MESSAGE_BY_THREAD_ID', scope: 'read' }, args: { user_id: 'me', thread_id: 'thread' } });
      expect(execute.mock.calls[0][0].evidence[0].content).toContain('New live reply');
      expect(publish).toHaveBeenCalledOnce();
      expect(db.prepare('SELECT count(*) AS n FROM knowledge_sync_runs').get()?.n).toBe(0);
      expect(db.prepare('SELECT count(*) AS n FROM connector_learning_jobs').get()?.n).toBe(0);
      expect(db.prepare('SELECT count(*) AS n FROM knowledge_source_items').get()?.n).toBe(1);
    });

    it('reads every bounded page and excludes drafts from model context', async () => {
      fetchThread.mockImplementation(async ({ args }) => args.page_token
        ? response([message('reply'), { ...message('draft'), labelIds: ['DRAFT'] }])
        : response([message('original')], 'page-2'));
      await check();
      expect(fetchThread).toHaveBeenCalledTimes(4);
      expect(execute.mock.calls[0][0].evidence.map(row => row.id)).toEqual([`mail:${accountId}:original`, `mail:${accountId}:reply`]);
      expect(publish).toHaveBeenCalledOnce();
    });

    it('automatically checks a due thread while mailbox learning is off', async () => {
      const activation = await host.http.application.start(principal(), input(), 'live');
      host.http.application.createWorkItem(principal(), activation.id, { subjectId: sourceId, accountId, dueAt: now + 1000 });
      now += 1000; host.start();
      await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
      expect(execute).toHaveBeenCalledOnce();
      expect(db.prepare('SELECT count(*) AS n FROM knowledge_sync_runs').get()?.n).toBe(0);
      expect(fetchThread.mock.calls.every(([call]) => call.args.thread_id === 'thread')).toBe(true);
    });

    it('stops a pending thread read and ignores the response after database closure', async () => {
      let finish!: (value: unknown) => void;
      fetchThread.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const activation = await host.http.application.start(principal(), input(), 'live');
      host.http.application.check(principal(), activation.id, 'check');
      const running = host.tick(); await vi.waitFor(() => expect(fetchThread).toHaveBeenCalledOnce());
      await host.stop(); await running;
      const result = response(); closeXopcDatabase(); finish(result);
      await new Promise(resolve => setImmediate(resolve));
      expect(execute).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
    });

    it('rejects background activation when the connector requires confirmation for every read', async () => {
      db.exec("UPDATE connector_installations SET confirmation_policy = 'always'");
      expect(await host.http.application.preflight(principal(), input())).toMatchObject({ ready: false });
      expect(fetchThread).not.toHaveBeenCalled();
    });

    it.each(['provider_error', 'partial_page', 'wrong_thread', 'missing_body'])('defers %s without falling back to cached messages', async (kind) => {
      fetchThread.mockImplementation(async () => kind === 'provider_error'
        ? { decision: 'allowed', result: { successful: false, error: 'unavailable' } }
        : kind === 'partial_page' ? response([message()], 'repeated')
        : kind === 'wrong_thread' ? response([{ ...message(), threadId: 'other' }])
        : response([{ ...message(), payload: {} }]));
      await check();
      expect(execute).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
      expect(db.prepare('SELECT status, reason FROM scene_runs').get()).toMatchObject({ status: 'retry_wait', reason: 'source_not_ready' });
    });

    it('rejects a permission revocation during the thread read', async () => {
      fetchThread.mockImplementationOnce(async () => {
        db.prepare('UPDATE connector_accounts SET enabled = 0 WHERE id = ?').run(accountId);
        return response();
      });
      await check();
      expect(execute).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
    });

    it('discards a generated draft if a new reply arrives during the model call', async () => {
      fetchThread.mockResolvedValueOnce(response()).mockResolvedValueOnce(response([message('new-reply', 'Already resolved')]));
      await check();
      expect(execute).toHaveBeenCalledOnce(); expect(publish).not.toHaveBeenCalled();
      expect(db.prepare('SELECT reason FROM scene_runs').get()?.reason).toBe('source_changed');
    });
  });
});
