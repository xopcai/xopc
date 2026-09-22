import { Hono, type Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { ProductReadContracts, type ProductReadId } from '@xopcai/gateway-contract';
import { createProductDispatcher } from '../../../capabilities/runtime/product.js';
import { capabilityHttpContext, capabilityHttpError } from '../../../capabilities/adapters/http.js';
import { CapabilityError } from '../../../capabilities/runtime/dispatcher.js';
import { z } from 'zod';

import { SceneConflictError, SceneInputError, SceneNotFoundError } from '../../../scenes/repository.js';
import { SceneSetupError } from '../../../scenes/service.js';
import { createLogger } from '../../../utils/logger.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const log = createLogger('Hono:Scenes');
const requestIdentity = z.string().trim().min(1).max(200);

export function registerSceneRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof CapabilityError && error.cause instanceof SceneSetupError) {
      return c.json({ error: 'scene_needs_setup', message: error.cause.message, missing: error.cause.missing }, 422);
    }
    if (error instanceof CapabilityError) return capabilityHttpError(c, error);
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
  const capabilities = createProductDispatcher(undefined, {
    getSceneAccess: () => deps.scenes ? { services: deps.scenes, principal: { ownerId: 'local-owner', workspaceId: deps.service.currentWorkspacePath } } : undefined,
  });
  const read = async (c: Context, operation: ProductReadId, input: unknown) =>
    ProductReadContracts[operation].output.parse(await capabilities.call(operation, input, capabilityHttpContext(c)));
  const write = (c: Context, operation: string, input: unknown) => {
    const context = capabilityHttpContext(c);
    return capabilities.call(operation, input, context, { ...capabilities.describe(operation, context),
      idempotencyKey: c.req.header('Idempotency-Key') ?? randomUUID() });
  };
  app.get('/source-providers', c => c.json({ providers: deps.scenes!.followUps?.sources.list() ?? [] }));
  app.get('/source-providers/:provider/accounts', c => c.json({
    accounts: deps.scenes!.followUps?.sources.get(c.req.param('provider')).listAccounts?.(principal(c)) ?? [],
  }));
  app.post('/source-providers/:provider/resolve-link', deps.strictRateLimitMiddleware, async c => {
    const input = z.strictObject({ accountId: z.string().min(1).max(200), url: z.string().url().max(2000) }).parse(await c.req.json());
    const source = deps.scenes!.followUps?.sources.get(c.req.param('provider'));
    if (!source?.resolveLink) return c.json({ error: 'source_resolution_unavailable' }, 422);
    const reference = await source.resolveLink(principal(c), input.accountId, input.url,
      AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(30_000)]));
    return c.json({ source: { provider: source.id, reference } });
  });
  app.get('/task-follow-ups', c => c.json({ items: deps.scenes!.followUps?.list(principal(c)) ?? [] }));
  app.get('/task-follow-ups/projects/:projectId/branches', async c => {
    if (!deps.scenes!.followUps) return c.json({ error: 'task_follow_up_unavailable' }, 503);
    return c.json(await deps.scenes!.followUps.branches.list(principal(c), c.req.param('projectId')));
  });
  app.post('/task-follow-ups/branch-links', deps.strictRateLimitMiddleware, async c => {
    const input = z.strictObject({ projectId: z.string().min(1).max(200), taskId: z.string().uuid(),
      branchRef: z.string().startsWith('refs/heads/').max(300), expectedSha: z.string().regex(/^[a-f0-9]{40,64}$/) }).parse(await c.req.json());
    if (!deps.scenes!.followUps) return c.json({ error: 'task_follow_up_unavailable' }, 503);
    return c.json(await deps.scenes!.followUps.branches.associate(principal(c), input));
  });
  app.post('/task-follow-ups/preflight', deps.strictRateLimitMiddleware, async c => {
    if (!deps.scenes!.followUps) return c.json({ error: 'task_follow_up_unavailable' }, 503);
    return c.json(await deps.scenes!.followUps.preflight(principal(c), await c.req.json()));
  });
  app.post('/task-follow-ups', deps.strictRateLimitMiddleware, async c => {
    if (!deps.scenes!.followUps) return c.json({ error: 'task_follow_up_unavailable' }, 503);
    return c.json(await deps.scenes!.followUps.create(principal(c), await c.req.json()), 201);
  });
  app.get('/task-follow-ups/:id', c => {
    if (!deps.scenes!.followUps) return c.json({ error: 'task_follow_up_unavailable' }, 503);
    return c.json(deps.scenes!.followUps.get(principal(c), c.req.param('id')));
  });
  app.patch('/task-follow-ups/:id', deps.strictRateLimitMiddleware, async c => {
    const input = z.union([
      z.strictObject({ expectedRevision: z.number().int().positive(), status: z.enum(['active', 'paused', 'archived']) }),
      z.strictObject({ expectedRevision: z.number().int().positive(), configuration: z.unknown() }),
    ]).parse(await c.req.json());
    if (!deps.scenes!.followUps) return c.json({ error: 'task_follow_up_unavailable' }, 503);
    if ('configuration' in input) return c.json(await deps.scenes!.followUps.configure(principal(c), c.req.param('id'), input.expectedRevision, input.configuration));
    return c.json(await deps.scenes!.followUps.transition(principal(c), c.req.param('id'), input.expectedRevision, input.status));
  });
  app.post('/browser/prepare', deps.strictRateLimitMiddleware, (c) => c.json(deps.scenes!.browser.prepare()));
  app.post('/browser/subscriptions', deps.strictRateLimitMiddleware, async (c) =>
    c.json(deps.scenes!.browser.register(principal(c), await c.req.json()), 201));
  app.delete('/browser/subscriptions/:id', deps.strictRateLimitMiddleware, (c) => {
    deps.scenes!.browser.remove(principal(c), c.req.param('id'));
    return c.json({ ok: true });
  });
  app.get('/preferences', async (c) => c.json(await read(c, 'xopc.scenes.get_preferences', {})));
  app.patch('/preferences', deps.strictRateLimitMiddleware, async (c) =>
    c.json(await write(c, 'xopc.scenes.set_preferences', await c.req.json())));
  app.post('/presence', deps.strictRateLimitMiddleware, async (c) => {
    deps.scenes!.preferences.recordPresence(principal(c), await c.req.json());
    return c.json({ ok: true });
  });
  app.get('/templates', async (c) => c.json(await read(c, 'xopc.scenes.templates', {})));
  app.get('/diagnostics', async (c) => c.json(await read(c, 'xopc.scenes.diagnostics', {})));
  app.get('/metrics', async (c) => {
    return c.json(await read(c, 'xopc.scenes.metrics', { ...c.req.query(), ...(c.req.query('days') === undefined ? {} : { days: Number(c.req.query('days')) }) }));
  });
  app.get('/sources/mail/accounts', async (c) => c.json(await read(c, 'xopc.scenes.mail_accounts', {})));
  app.post('/sources/mail/search', deps.strictRateLimitMiddleware, async (c) => {
    if (!deps.scenes!.mailDiscovery) return c.json({ error: 'mail_search_unavailable' }, 503);
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(15_000)]);
    return c.json({ sources: await deps.scenes!.mailDiscovery.searchSources(principal(c), await c.req.json(), signal) });
  });
  app.get('/sources/mail', async (c) => {
    return c.json(await read(c, 'xopc.scenes.mail_sources', { ...c.req.query(), ...(c.req.query('limit') === undefined ? {} : { limit: Number(c.req.query('limit')) }) }));
  });
  app.get('/templates/:key/versions/:version', async (c) => c.json(await read(c, 'xopc.scenes.get_template', { key: c.req.param('key'), version: c.req.param('version') })));
  app.post('/preflight', deps.strictRateLimitMiddleware, async (c) => c.json(await read(c, 'xopc.scenes.preflight', await c.req.json())));
  app.get('/activations', async (c) => {
    return c.json(await read(c, 'xopc.scenes.list', { ...c.req.query(), ...(c.req.query('limit') === undefined ? {} : { limit: Number(c.req.query('limit')) }) }));
  });
  app.post('/activations', deps.strictRateLimitMiddleware, async (c) => {
    requestIdentity.parse(c.req.header('Idempotency-Key'));
    return c.json(await write(c, 'xopc.scenes.start', await c.req.json()), 201);
  });
  app.get('/activations/:id', async (c) => {
    const { activation } = ProductReadContracts['xopc.scenes.get'].output.parse(await read(c, 'xopc.scenes.get', { id: c.req.param('id') }));
    return c.json({ activation });
  });
  app.patch('/activations/:id', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json();
    const stateOnly = typeof body === 'object' && body !== null && Object.hasOwn(body, 'status');
    if (!stateOnly) return c.json(await write(c, 'xopc.scenes.configure', { ...body, id: c.req.param('id') }));
    return c.json(await write(c, 'xopc.scenes.transition', { ...body, id: c.req.param('id') }));
  });
  app.post('/activations/:id/checks', deps.strictRateLimitMiddleware, async (c) => {
    requestIdentity.parse(c.req.header('Idempotency-Key'));
    return c.json(await write(c, 'xopc.scenes.check', { id: c.req.param('id') }), 202);
  });
  app.get('/activations/:id/runs', async (c) => {
    return c.json(await read(c, 'xopc.scenes.list_runs', { ...c.req.query(), id: c.req.param('id'), ...(c.req.query('limit') === undefined ? {} : { limit: Number(c.req.query('limit')) }) }));
  });
  app.patch('/activations/:id/notes', deps.strictRateLimitMiddleware, async (c) => c.json(
    await write(c, 'xopc.scenes.notes', { ...await c.req.json(), id: c.req.param('id') }),
  ));
  app.get('/activations/:id/notes', async (c) => c.json(await read(c, 'xopc.scenes.read_notes', { id: c.req.param('id') })));
  app.get('/activations/:id/work-items', async (c) => {
    return c.json(await read(c, 'xopc.scenes.list_work_items', { ...c.req.query(), id: c.req.param('id'), ...(c.req.query('limit') === undefined ? {} : { limit: Number(c.req.query('limit')) }) }));
  });
  app.post('/activations/:id/work-items', deps.strictRateLimitMiddleware, async (c) => c.json(
    await write(c, 'xopc.scenes.work_item', { ...await c.req.json(), id: c.req.param('id') }), 201,
  ));
  app.get('/activations/:id/schedules', async (c) => c.json(await read(c, 'xopc.scenes.list_schedules', { id: c.req.param('id') })));
  app.patch('/activations/:id/schedules/:triggerKey', deps.strictRateLimitMiddleware, async (c) => c.json(
    await write(c, 'xopc.scenes.schedule', { ...await c.req.json(), id: c.req.param('id'), triggerKey: c.req.param('triggerKey') }),
  ));
  app.patch('/work-items/:id', deps.strictRateLimitMiddleware, async (c) => c.json(
    await write(c, 'xopc.scenes.update_work_item', { ...await c.req.json(), id: c.req.param('id') }),
  ));
  app.get('/outcomes', async (c) => {
    return c.json(await read(c, 'xopc.scenes.results', { ...c.req.query(), ...(c.req.query('limit') === undefined ? {} : { limit: Number(c.req.query('limit')) }) }));
  });
  app.get('/digests/:id', async (c) => {
    return c.json(await read(c, 'xopc.scenes.digest_results', { ...c.req.query(), id: c.req.param('id'), ...(c.req.query('limit') === undefined ? {} : { limit: Number(c.req.query('limit')) }) }));
  });
  app.get('/presentations/:id/feedback', async (c) => c.json(await read(c, 'xopc.scenes.get_feedback', { id: c.req.param('id') })));
  app.get('/presentations/:id', async (c) => c.json(await read(c, 'xopc.scenes.get_presentation', { id: c.req.param('id') })));
  app.post('/presentations/:id/feedback', deps.strictRateLimitMiddleware, async (c) => c.json(
    await write(c, 'xopc.scenes.feedback', { ...await c.req.json(), id: c.req.param('id') }),
  ));
  app.patch('/presentations/:id', deps.strictRateLimitMiddleware, async (c) => {
    await write(c, 'xopc.scenes.mark_read', { ...await c.req.json(), id: c.req.param('id') });
    return c.json({ ok: true });
  });
  authenticated.route('/api/scenes', app);
}
