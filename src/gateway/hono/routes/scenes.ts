import { Hono } from 'hono';
import { z } from 'zod';

import { SceneConflictError, SceneInputError, SceneNotFoundError } from '../../../scenes/repository.js';
import { SceneSetupError } from '../../../scenes/service.js';
import { createLogger } from '../../../utils/logger.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const log = createLogger('Hono:Scenes');
const requestIdentity = z.string().trim().min(1).max(200);
const pageSchema = z.strictObject({ limit: z.coerce.number().int().min(1).max(100).default(50), afterId: z.string().max(200).default('') });

export function registerSceneRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof SceneNotFoundError) return c.json({ error: 'scene_not_found' }, 404);
    if (error instanceof SceneConflictError) return c.json({ error: 'scene_changed', message: error.message }, 409);
    if (error instanceof SceneSetupError) return c.json({ error: 'scene_needs_setup', message: error.message, missing: error.missing }, 422);
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof SceneInputError) return c.json({ error: 'invalid_scene_input' }, 400);
    log.error({ err: error, phase: 'scene_request' }, 'Scene request failed');
    return c.json({ error: 'scene_request_failed' }, 500);
  });
  app.use('*', async (c, next) => {
    if (!deps.scenes) return c.json({ error: 'scene_runtime_not_installed' }, 503);
    await next();
  });
  const principal = (c: Parameters<typeof getGatewayPrincipal>[0]) => ({
    ownerId: getGatewayPrincipal(c).scopes.includes('gateway.admin') ? 'local-owner' : getGatewayPrincipal(c).principalId,
    workspaceId: deps.service.currentWorkspacePath,
  });
  app.post('/browser/prepare', deps.strictRateLimitMiddleware, (c) => c.json(deps.scenes!.browser.prepare()));
  app.post('/browser/subscriptions', deps.strictRateLimitMiddleware, async (c) =>
    c.json(deps.scenes!.browser.register(principal(c), await c.req.json()), 201));
  app.delete('/browser/subscriptions/:id', deps.strictRateLimitMiddleware, (c) => {
    deps.scenes!.browser.remove(principal(c), c.req.param('id'));
    return c.json({ ok: true });
  });
  app.get('/preferences', (c) => c.json(deps.scenes!.preferences.get(principal(c))));
  app.patch('/preferences', deps.strictRateLimitMiddleware, async (c) =>
    c.json(deps.scenes!.preferences.update(principal(c), await c.req.json())));
  app.post('/presence', deps.strictRateLimitMiddleware, async (c) => {
    deps.scenes!.preferences.recordPresence(principal(c), await c.req.json());
    return c.json({ ok: true });
  });
  app.get('/templates', (c) => c.json({ templates: deps.scenes!.repository.listTemplates() }));
  app.get('/diagnostics', (c) => c.json(deps.scenes!.metrics.diagnostics(principal(c))));
  app.get('/metrics', (c) => {
    const { days } = z.strictObject({ days: z.coerce.number().int().min(1).max(90).default(7) }).parse(c.req.query());
    return c.json(deps.scenes!.metrics.forUser(principal(c), days));
  });
  app.get('/sources/mail/accounts', (c) => c.json({ accounts: deps.scenes!.mailDiscovery?.listAccounts(principal(c)) ?? [] }));
  app.post('/sources/mail/search', deps.strictRateLimitMiddleware, async (c) => {
    if (!deps.scenes!.mailDiscovery) return c.json({ error: 'mail_search_unavailable' }, 503);
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(15_000)]);
    return c.json({ sources: await deps.scenes!.mailDiscovery.searchSources(principal(c), await c.req.json(), signal) });
  });
  app.get('/sources/mail', (c) => {
    const { limit, afterId } = pageSchema.parse(c.req.query());
    const sources = deps.scenes!.mail.listSources(principal(c), limit, afterId);
    return c.json({ sources, nextCursor: sources.length === limit ? sources.at(-1)!.id : null });
  });
  app.get('/templates/:key/versions/:version', (c) => c.json({ template: deps.scenes!.repository.getTemplate(c.req.param('key'), c.req.param('version')) }));
  app.post('/preflight', deps.strictRateLimitMiddleware, async (c) => c.json(await deps.scenes!.application.preflight(principal(c), await c.req.json())));
  app.get('/activations', (c) => {
    const { limit, afterId } = pageSchema.parse(c.req.query());
    const activations = deps.scenes!.repository.listActivations(principal(c), limit, afterId);
    return c.json({ activations, nextCursor: activations.length === limit ? activations.at(-1)!.id : null });
  });
  app.post('/activations', deps.strictRateLimitMiddleware, async (c) => {
    const requestId = requestIdentity.parse(c.req.header('Idempotency-Key'));
    return c.json({ activation: await deps.scenes!.application.start(principal(c), await c.req.json(), requestId) }, 201);
  });
  app.get('/activations/:id', (c) => c.json({ activation: deps.scenes!.repository.getActivation(principal(c), c.req.param('id')) }));
  app.patch('/activations/:id', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json();
    const stateOnly = typeof body === 'object' && body !== null && Object.hasOwn(body, 'status');
    const activation = stateOnly
      ? await deps.scenes!.application.transition(principal(c), c.req.param('id'), body)
      : deps.scenes!.application.configure(principal(c), c.req.param('id'), body);
    return c.json({ activation });
  });
  app.post('/activations/:id/checks', deps.strictRateLimitMiddleware, (c) => c.json({
    intentId: deps.scenes!.application.check(principal(c), c.req.param('id'), requestIdentity.parse(c.req.header('Idempotency-Key'))),
  }, 202));
  app.get('/activations/:id/runs', (c) => {
    const { limit, afterId } = pageSchema.parse(c.req.query());
    const runs = deps.scenes!.repository.listRuns(principal(c), c.req.param('id'), limit, afterId);
    return c.json({ runs, nextCursor: runs.length === limit ? runs.at(-1)!.id : null });
  });
  app.patch('/activations/:id/notes', deps.strictRateLimitMiddleware, async (c) => c.json({
    revision: deps.scenes!.application.writeNotes(principal(c), c.req.param('id'), await c.req.json()),
  }));
  app.get('/activations/:id/notes', (c) => c.json({ notes: deps.scenes!.repository.readNotes(principal(c), c.req.param('id')) }));
  app.get('/activations/:id/work-items', (c) => {
    const { limit, afterId } = pageSchema.parse(c.req.query());
    const workItems = deps.scenes!.repository.listWorkItems(principal(c), c.req.param('id'), limit, afterId);
    return c.json({ workItems, nextCursor: workItems.length === limit ? workItems.at(-1)!.id : null });
  });
  app.post('/activations/:id/work-items', deps.strictRateLimitMiddleware, async (c) => c.json({
    workItem: deps.scenes!.application.createWorkItem(principal(c), c.req.param('id'), await c.req.json()),
  }, 201));
  app.get('/activations/:id/schedules', (c) => c.json({ schedules: deps.scenes!.repository.listSchedules(principal(c), c.req.param('id')) }));
  app.patch('/activations/:id/schedules/:triggerKey', deps.strictRateLimitMiddleware, async (c) => c.json({
    revision: deps.scenes!.application.setSchedule(principal(c), c.req.param('id'), c.req.param('triggerKey'), await c.req.json()),
  }));
  app.patch('/work-items/:id', deps.strictRateLimitMiddleware, async (c) => c.json({
    workItem: deps.scenes!.application.updateWorkItem(principal(c), c.req.param('id'), await c.req.json()),
  }));
  app.get('/outcomes', (c) => {
    const { limit, afterId, activationId } = pageSchema.extend({ activationId: requestIdentity.optional() }).parse(c.req.query());
    const outcomes = deps.scenes!.repository.listInbox(principal(c), limit, afterId, activationId ?? null);
    return c.json({ outcomes, nextCursor: outcomes.length === limit ? outcomes.at(-1)!.id : null });
  });
  app.get('/digests/:id', (c) => {
    const { limit, afterId } = pageSchema.parse(c.req.query());
    return c.json(deps.scenes!.repository.listDigestResults(principal(c), c.req.param('id'), limit, afterId));
  });
  app.get('/presentations/:id/feedback', (c) => c.json({ feedback: deps.scenes!.inbox.getFeedback(principal(c), c.req.param('id')) }));
  app.get('/presentations/:id', (c) => c.json({ outcome: deps.scenes!.repository.getPresentation(principal(c), c.req.param('id')) }));
  app.post('/presentations/:id/feedback', deps.strictRateLimitMiddleware, async (c) => c.json({
    revision: deps.scenes!.inbox.feedback(principal(c), c.req.param('id'), await c.req.json()),
  }));
  app.patch('/presentations/:id', deps.strictRateLimitMiddleware, async (c) => {
    const { read } = z.strictObject({ read: z.boolean() }).parse(await c.req.json());
    deps.scenes!.inbox.setRead(principal(c), c.req.param('id'), read);
    return c.json({ ok: true });
  });
  authenticated.route('/api/scenes', app);
}
