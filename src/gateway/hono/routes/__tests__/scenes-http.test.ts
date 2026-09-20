import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SceneExecutionService } from '../../../../scenes/execution.js';
import { SceneInboxService } from '../../../../scenes/inbox.js';
import { SceneMailContextProvider } from '../../../../scenes/mailContext.js';
import { SceneRepository } from '../../../../scenes/repository.js';
import { SceneApplicationService } from '../../../../scenes/service.js';
import { familyPlanTemplate, mailFollowUpTemplate } from '../../../../scenes/templates.js';
import { SceneUserNotesProvider } from '../../../../scenes/userNotes.js';
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
  const request = (path: string, method = 'GET', body?: unknown, authenticated = true, key = 'request') => fetch(`${origin}/api/scenes${path}`, {
    method, headers: { 'content-type': 'application/json', 'Idempotency-Key': key, ...(authenticated ? { authorization: 'Bearer scenes-http-test' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  beforeEach(async () => {
    resetLazyRouteBundlesForTests();
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(readFileSync(new URL('../../../../scenes/schema.sql', import.meta.url), 'utf8'));
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
      scenes: { repository, application, inbox: new SceneInboxService(db), mail: new SceneMailContextProvider(db) } };
    const app = new Hono();
    app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'scenes-http-test', allowTailscale: false }) }));
    app.use(gatewayScopes());
    registerAuthenticatedLazyRouteFallback(app, deps);
    await new Promise<void>((resolve) => { server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => resolve()); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
    resetLazyRouteBundlesForTests();
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
    expect(repository.listActivations({ ownerId: 'gateway-owner', workspaceId: 'workspace' })).toEqual([]);
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
      await request(`/activations/${activation.id}/notes`, 'PATCH', { expectedRevision: 0, content: activation.goal });
      await request(`/activations/${activation.id}/checks`, 'POST');
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
    const activation = repository.createActivation({ ownerId: 'gateway-owner', workspaceId: 'workspace' }, {
      templateKey: mailFollowUpTemplate.key, templateVersion: mailFollowUpTemplate.version, goal: 'Follow this mail',
      scope: { kind: 'objects', ids: ['source'] }, permissions: { accountIds: ['account'], contextProviders: ['mail'], effectHandlers: [] },
    });
    const path = `/activations/${activation.id}/work-items`;
    repository.transitionActivation({ ownerId: 'gateway-owner', workspaceId: 'workspace' }, activation.id, activation.revision, 'active');
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
    for (const principal of [{ ownerId: 'other', workspaceId: 'workspace' }, { ownerId: 'gateway-owner', workspaceId: 'other' }]) {
      const activation = repository.createActivation(principal, input);
      expect((await request(`/activations/${activation.id}`)).status).toBe(404);
      expect((await request(`/activations/${activation.id}/runs`)).status).toBe(404);
      expect((await request(`/activations/${activation.id}/notes`, 'PATCH', { expectedRevision: 0, content: 'Injected' })).status).toBe(404);
    }
  });

  it('fails closed when no scene domain is installed and does not fall back to the old engine', async () => {
    deps.scenes = undefined;
    expect((await request('/templates')).status).toBe(503);
    expect(db.prepare('SELECT count(*) AS n FROM scene_activations').get()?.n).toBe(0);
  });
});
