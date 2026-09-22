import { BrowserSubscriptionService } from '../../../../notifications/browserSubscriptions.js';
import { ScenePreferenceService } from '../../../../scenes/preferences.js';
import type { AddressInfo } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SceneExecutionService } from '../../../../scenes/execution.js';
import { SceneInboxService } from '../../../../scenes/inbox.js';
import { SceneMetrics } from '../../../../scenes/metrics.js';
import { SceneMailContextProvider } from '../../../../scenes/mailContext.js';
import { SceneRepository } from '../../../../scenes/repository.js';
import { openXopcDatabase, closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../../../storage/sqlite/transaction.js';
import { SceneApplicationService } from '../../../../scenes/service.js';
import { familyPlanTemplate, mailFollowUpTemplate } from '../../../../scenes/templates.js';
import { SceneUserNotesProvider } from '../../../../scenes/userNotes.js';
import { createXopcUseTool } from '../../../../agent/tools/xopc-use-tool.js';
import { auth } from '../../middleware/auth.js';
import { gatewayScopes } from '../../middleware/scopes.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import { getLoadedLazyRouteBundleIdsForTests, registerAuthenticatedLazyRouteFallback, resetLazyRouteBundlesForTests } from '../lazy-fallback.js';

describe('scene APIs through authenticated Gateway HTTP and lazy dispatch', () => {
  let db: DatabaseSync;
  let repository: SceneRepository;
  let runtime: SceneExecutionService;
  let server: ReturnType<typeof serve>;
  let origin: string;
  let deps: AuthenticatedRouteDeps;
  const input = { templateKey: familyPlanTemplate.key, templateVersion: familyPlanTemplate.version, goal: 'Keep family arrangements manageable.',
    scope: { kind: 'personal' }, permissions: { accountIds: [], contextProviders: ['user_notes'], effectHandlers: [] } };
  const request = (path: string, method = 'GET', body?: unknown, authenticated = true,
    key = method === 'POST' && path === '/activations' ? 'request'
      : method === 'POST' && path.endsWith('/checks') ? path : randomUUID()) => fetch(`${origin}/api/scenes${path}`, {
    method, headers: { 'content-type': 'application/json', 'Idempotency-Key': key, ...(authenticated ? { authorization: 'Bearer scenes-http-test' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  beforeEach(async () => {
    resetLazyRouteBundlesForTests();
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
    db = getSqliteDatabase();

    repository = new SceneRepository(db);
    repository.installTemplate(familyPlanTemplate);
    const provider = new SceneUserNotesProvider(db);
    const authorize = async () => input.permissions;
    const application = new SceneApplicationService(repository, [provider], authorize);
    runtime = new SceneExecutionService(repository, [provider], { execute: async ({ evidence }) => ({
      kind: 'artifact', summary: 'Leave Sunday free for rest.', evidenceIds: evidence.map((entry) => entry.id),
    }) }, authorize);
    const pass = async (_c, next) => { await next(); };
    deps = { service: { currentWorkspacePath: 'workspace' } as never, strictRateLimitMiddleware: pass,
      chatRateLimitMiddleware: pass, xopcCloudPollRateLimitMiddleware: pass,
      scenes: { repository, application, inbox: new SceneInboxService(db), mail: new SceneMailContextProvider(db), browser: new BrowserSubscriptionService(db), preferences: new ScenePreferenceService(db), metrics: new SceneMetrics(db) } };
    const app = new Hono();
    app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'scenes-http-test', allowTailscale: false }) }));
    app.use(gatewayScopes());
    registerAuthenticatedLazyRouteFallback(app, deps);
    await new Promise<void>((resolve) => { server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => resolve()); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    resetLazyRouteBundlesForTests();
  });

  it('shares scoped scene reads between original HTTP, generic capabilities and Agent', async () => {
    const activation = repository.createActivation({ ownerId: 'local-owner', workspaceId: 'workspace' }, input);
    const capabilityPath = `${origin}/api/capabilities/operations/xopc.scenes.get`;
    const headers = { authorization: 'Bearer scenes-http-test', 'content-type': 'application/json' };
    const descriptor = await (await fetch(capabilityPath, { headers })).json();
    const read = async (value: unknown) => fetch(`${capabilityPath}/invocations`, { method: 'POST', headers,
      body: JSON.stringify({ input: value, majorVersion: descriptor.majorVersion, descriptorDigest: descriptor.descriptorDigest }) });
    const response = await read({ id: activation.id });
    expect(response.status).toBe(200);
    const result = (await response.json()).data;
    expect(await (await request(`/activations/${activation.id}`)).json()).toEqual({ activation: result.activation });
    const tool = createXopcUseTool({ getSceneAccess: () => ({ services: deps.scenes!, principal: { ownerId: 'local-owner', workspaceId: 'workspace' } }) });
    expect((await tool.execute('read', { mode: 'scene', command: 'get', args: { id: activation.id } })).details.result).toEqual(result);
    expect((await read({ id: activation.id, ownerId: 'other' })).status).toBe(400);
    const other = repository.createActivation({ ownerId: 'other', workspaceId: 'workspace' }, input);
    expect((await read({ id: other.id })).status).toBe(404);
    const otherWorkspace = repository.createActivation({ ownerId: 'local-owner', workspaceId: 'other-workspace' }, input);
    expect((await read({ id: otherWorkspace.id })).status).toBe(404);
    const denied = createXopcUseTool({ getSceneAccess: () => ({ services: deps.scenes!, principal: { ownerId: 'local-owner', workspaceId: 'workspace' } }), authorizeCapability: () => false });
    await expect(denied.execute('denied', { mode: 'scene', command: 'get', args: { id: activation.id } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('controls checking independently of reminders and validates push subscriptions through auth', async () => {
    expect((await request('/preferences', 'GET', undefined, false)).status).toBe(401);
    expect((await request('/preferences', 'PATCH', { expectedRevision: 0, notificationsMuted: true })).status).toBe(200);
    expect(await (await request('/preferences')).json()).toMatchObject({ notificationsMuted: true, checksPaused: false, revision: 1 });
    expect((await request('/preferences', 'PATCH', { expectedRevision: 0, checksPaused: true })).status).toBe(409);
    expect((await request('/preferences', 'PATCH', { expectedRevision: 1, ownerId: 'other' })).status).toBe(400);
    expect((await request('/presence', 'POST', { clientId: 'tab', surface: 'web', presentationId: 'other', visible: true })).status).toBe(404);
    expect((await request('/browser/prepare', 'POST')).status).toBe(200);
    expect((await request('/browser/subscriptions', 'POST', { endpoint: 'https://localhost/private' })).status).toBe(400);
    expect((await request('/diagnostics')).status).toBe(200);
  });

  it('requires authentication before loading the scene bundle', async () => {
    expect((await request('/templates', 'GET', undefined, false)).status).toBe(401);
    expect(getLoadedLazyRouteBundleIdsForTests().authenticated).not.toContain('scenes');
    expect((await request('/templates')).status).toBe(200);
    expect(getLoadedLazyRouteBundleIdsForTests().authenticated).toContain('scenes');
    expect((await fetch(`${origin}/api/scenes-other`, { headers: { authorization: 'Bearer scenes-http-test' } })).status).toBe(404);
  });

  it('does not accept body identity, missing request keys or invalid pagination', async () => {
    expect((await request('/activations', 'POST', { ...input, ownerId: 'other' })).status).toBe(400);
    expect((await request('/activations', 'POST', input, true, '')).status).toBe(400);
    expect((await request('/activations?limit=0')).status).toBe(400);
    expect((await request('/activations?ownerId=other')).status).toBe(400);
    expect(repository.listActivations({ ownerId: 'local-owner', workspaceId: 'workspace' })).toEqual([]);
  });

  it('serves scoped metrics through authentication and rejects arbitrary scopes or windows', async () => {
    expect((await request('/metrics', 'GET', undefined, false)).status).toBe(401);
    const response = await request('/metrics');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ window: { days: 7 }, ratedOutcomes: 0, usefulOutcomes: 0, checks: 0 });
    for (const query of ['days=0', 'days=91', 'days=1.5', 'ownerId=another', 'workspaceId=another']) {
      expect((await request(`/metrics?${query}`)).status).toBe(400);
    }
  });

  it('supports setup, idempotent checks, notes, results, feedback and pause with revision conflicts', async () => {
    expect((await (await request('/preflight', 'POST', input)).json()).ready).toBe(true);
    const created = await request('/activations', 'POST', input);
    expect(created.status).toBe(201);
    const { activation } = await created.json();
    const path = `/activations/${activation.id}`;
    expect((await (await request('/activations', 'POST', input)).json()).activation.id).toBe(activation.id);
    expect((await request(`${path}/notes`, 'PATCH', { expectedRevision: 0, content: 'Keep Sunday unplanned.' })).status).toBe(200);
    const check = await (await request(`${path}/checks`, 'POST')).json();
    expect((await (await request(`${path}/checks`, 'POST')).json()).intentId).toBe(check.intentId);
    expect(await runtime.runNext('http-test')).toBe('completed');
    const { outcomes } = await (await request('/outcomes')).json();
    expect(outcomes).toHaveLength(1);
    expect((await request(`/presentations/${outcomes[0].id}/feedback`, 'POST', { expectedRevision: 0, rating: 'useful' })).status).toBe(200);
    expect((await (await request(`/presentations/${outcomes[0].id}/feedback`)).json()).feedback).toMatchObject({ rating: 'useful', revision: 1 });
    expect((await request(`/presentations/${outcomes[0].id}`, 'PATCH', { read: true })).status).toBe(200);
    expect((await (await request(`${path}/runs`)).json()).runs).toMatchObject([{ status: 'succeeded' }]);
    expect((await request(path, 'PATCH', { expectedRevision: activation.revision, status: 'paused' })).status).toBe(200);
    expect((await request(path, 'PATCH', { expectedRevision: activation.revision, status: 'active' })).status).toBe(409);
    expect((await request(`${path}/checks`, 'POST', undefined, true, 'new')).status).toBe(409);
  });

  it('isolates result filters and rejects cross-scene cursors', async () => {
    const first = (await (await request('/activations', 'POST', input)).json()).activation;
    const second = (await (await request('/activations', 'POST', { ...input, goal: 'Another arrangement' }, true, 'second')).json()).activation;
    for (const activation of [first, second]) {
      expect((await request(`/activations/${activation.id}/notes`, 'PATCH', { expectedRevision: 0, content: activation.goal })).status).toBe(200);
      expect((await request(`/activations/${activation.id}/checks`, 'POST')).status).toBe(202);
      await runtime.runNext('http-test');
    }
    const firstPage = await (await request(`/outcomes?activationId=${first.id}&limit=1`)).json();
    expect(firstPage.outcomes).toMatchObject([{ activationId: first.id }]);
    expect((await (await request(`/outcomes?activationId=${first.id}&afterId=${firstPage.nextCursor}`)).json()).outcomes).toEqual([]);
    expect((await request(`/outcomes?activationId=${second.id}&afterId=${firstPage.nextCursor}`)).status).toBe(404);
    expect((await request('/outcomes?activationId=missing')).status).toBe(404);
    await request(`/activations/${first.id}/notes`, 'PATCH', { expectedRevision: 1, content: '' });
    expect((await (await request(`/outcomes?activationId=${first.id}`)).json()).outcomes).toEqual([]);
    expect((await request(`/presentations/${firstPage.outcomes[0].id}/feedback`)).status).toBe(409);
  });

  it('validates scheduled checks and preserves revisions through HTTP', async () => {
    const { activation } = await (await request('/activations', 'POST', input)).json();
    const path = `/activations/${activation.id}/schedules`;
    const body = { expectedRevision: 0, schedule: { weekdays: [0], hour: 18, minute: 30, timeZone: 'Asia/Shanghai' } };
    expect((await (await request(path)).json()).schedules).toEqual([]);
    expect((await request(`${path}/unknown`, 'PATCH', body)).status).toBe(400);
    expect((await request(`${path}/weekly-review`, 'PATCH', { ...body, schedule: { ...body.schedule, timeZone: 'invalid' } })).status).toBe(400);
    expect((await request(`${path}/weekly-review`, 'PATCH', body)).status).toBe(200);
    expect((await request(`${path}/weekly-review`, 'PATCH', body)).status).toBe(409);
    expect((await (await request(path)).json()).schedules).toMatchObject([{ triggerKey: 'weekly-review', revision: 1, schedule: body.schedule }]);
    expect((await request(`/activations/${activation.id}/work-items`, 'POST', { subjectId: 'mail', accountId: 'account', dueAt: Date.now() + 60000 })).status).toBe(400);
  });

  it('manages explicitly scoped mail deadlines without granting additional objects', async () => {
    repository.installTemplate(mailFollowUpTemplate);
    const activation = repository.createActivation({ ownerId: 'local-owner', workspaceId: 'workspace' }, {
      templateKey: mailFollowUpTemplate.key, templateVersion: mailFollowUpTemplate.version, goal: 'Follow this mail',
      scope: { kind: 'objects', ids: ['source'] }, permissions: { accountIds: ['account'], contextProviders: ['mail'], effectHandlers: [] },
    });
    const path = `/activations/${activation.id}/work-items`;
    repository.transitionActivation({ ownerId: 'local-owner', workspaceId: 'workspace' }, activation.id, activation.revision, 'active');
    const body = { subjectId: 'source', accountId: 'account', dueAt: Date.now() + 60000 };
    expect((await request(path, 'POST', { ...body, subjectId: 'foreign' })).status).toBe(400);
    const response = await request(path, 'POST', body);
    expect(response.status).toBe(201);
    const { workItem } = await response.json();
    expect((await request(path, 'POST', body)).status).toBe(409);
    expect((await (await request(path)).json()).workItems).toMatchObject([{ id: workItem.id, subjectId: 'source' }]);
    expect((await request(`/work-items/${workItem.id}`, 'PATCH', { expectedRevision: 1, status: 'paused' })).status).toBe(200);
    expect((await request(`/work-items/${workItem.id}`, 'PATCH', { expectedRevision: 1, status: 'watching' })).status).toBe(409);
  });

  it('does not expose another principal or workspace through known resource IDs', async () => {
    for (const principal of [{ ownerId: 'other', workspaceId: 'workspace' }, { ownerId: 'local-owner', workspaceId: 'other' }]) {
      const activation = repository.createActivation(principal, input);
      expect((await request(`/activations/${activation.id}`)).status).toBe(404);
      expect((await request(`/activations/${activation.id}/runs`)).status).toBe(404);
      expect((await request(`/activations/${activation.id}/notes`, 'PATCH', { expectedRevision: 0, content: 'Injected' })).status).toBe(404);
    }
  });

  it('paginates checks newest first with stable ties and rejects a cursor from another activation', async () => {
    const principal = { ownerId: 'local-owner', workspaceId: 'workspace' };
    const activation = repository.createActivation(principal, input);
    const other = repository.createActivation(principal, input);
    for (const [id, createdAt, activationId] of [['z-old', 10, activation.id], ['a-new', 20, activation.id],
      ['b-new', 20, activation.id], ['other-run', 30, other.id]] as const) {
      db.prepare(`INSERT INTO scene_trigger_intents VALUES (?, ?, 1, 'check', ?, NULL, ?, 'resolved')`).run(id, activationId, id, createdAt);
      db.prepare(`INSERT INTO scene_runs(id, activation_id, intent_id, activation_revision, status, attempt, lease_epoch, created_at)
        VALUES (?, ?, ?, 1, 'succeeded', 1, 1, ?)`).run(id, activationId, id, createdAt);
    }
    const path = `/activations/${activation.id}/runs?limit=2`;
    expect(await (await request(path)).json()).toMatchObject({ nextCursor: 'a-new', runs: [{ id: 'b-new' }, { id: 'a-new' }] });
    expect(await (await request(`${path}&afterId=a-new`)).json()).toMatchObject({ nextCursor: null, runs: [{ id: 'z-old' }] });
    expect((await request(`${path}&afterId=other-run`)).status).toBe(404);
  });

  it('resolves a notification directly to an older result or scoped digest without reviving withdrawn content', async () => {
    const principal = { ownerId: 'local-owner', workspaceId: 'workspace' };
    const activation = repository.createActivation(principal, input);
    const other = repository.createActivation({ ...principal, ownerId: 'other' }, input);
    for (let index = 0; index < 26; index++) {
      const id = `card-${index}`;
      const activationId = index === 25 ? other.id : activation.id;
      db.prepare("INSERT INTO scene_trigger_intents VALUES (?, ?, 1, 'check', ?, NULL, ?, 'resolved')").run(id, activationId, id, index);
      db.prepare(`INSERT INTO scene_runs(id, activation_id, intent_id, activation_revision, status, attempt, lease_epoch, created_at)
        VALUES (?, ?, ?, 1, 'succeeded', 1, 1, ?)`).run(id, activationId, id, index);
      db.prepare("INSERT INTO scene_outcomes VALUES (?, ?, 'artifact', ?, ?)").run(id, id, JSON.stringify({ summary: `Result ${index}`, evidenceIds: ['note'] }), index);
      db.prepare("INSERT INTO scene_presentations(id, outcome_id, destination, status, created_at) VALUES (?, ?, 'inbox', 'unread', ?)").run(id, id, index);
    }
    expect((await (await request('/outcomes?limit=20')).json()).outcomes.some((row) => row.id === 'card-0')).toBe(false);
    expect(await (await request('/presentations/card-0')).json()).toMatchObject({ outcome: { id: 'card-0', readOnly: false, content: { summary: 'Result 0' } } });
    expect((await request('/presentations/card-25')).status).toBe(404);
    expect((await request('/presentations/card-0', 'GET', undefined, false)).status).toBe(401);
    db.exec("UPDATE scene_presentations SET status = 'resolved', expires_at = 0 WHERE id = 'card-0'");
    expect(await (await request('/presentations/card-0')).json()).toMatchObject({ outcome: { readOnly: true } });
    expect((await request('/presentations/card-0', 'PATCH', { read: false })).status).toBe(409);
    db.prepare('INSERT INTO notification_digests VALUES (?, ?, ?, ?, ?, NULL)').run('digest', principal.ownerId, principal.workspaceId, 'historical', 1);
    db.exec("INSERT INTO notification_digest_members VALUES ('digest', 'card-0', 1), ('digest', 'card-1', 1), ('digest', 'card-25', 1)");
    expect(await (await request('/digests/digest?limit=1')).json()).toMatchObject({ nextCursor: 'card-0', outcomes: [{ id: 'card-0' }] });
    expect(await (await request('/digests/digest?limit=1&afterId=card-0')).json()).toMatchObject({ nextCursor: null, outcomes: [{ id: 'card-1' }] });
    db.exec("UPDATE scene_presentations SET status = 'withdrawn' WHERE id = 'card-0'");
    expect((await request('/presentations/card-0')).status).toBe(404);
    expect((await (await request('/digests/digest')).json()).outcomes).toMatchObject([{ id: 'card-1' }]);
    db.exec("UPDATE notification_digests SET owner_id = 'other'");
    expect((await request('/digests/digest')).status).toBe(404);
  });

  it('fails closed when no scene domain is installed and does not fall back to the old engine', async () => {
    deps.scenes = undefined;
    expect((await request('/templates')).status).toBe(503);
    expect(db.prepare('SELECT count(*) AS n FROM scene_activations').get()?.n).toBe(0);
  });
});
