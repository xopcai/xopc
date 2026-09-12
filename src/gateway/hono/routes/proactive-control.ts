import type { Hono } from 'hono';
import { ZodError } from 'zod';

import { resolveProjectAgentId } from '../../../projects/index.js';
import { getDefaultAgentId } from '../../../routing/resolve-route.js';
import { prepareCardWorkflow, workflowForCard } from '../../../proactive/actions/workflow.js';
import { recordProactivePresence } from '../../../proactive/policy/presence.js';
import { digestCards } from '../../../proactive/inbox/digest.js';
import { proactiveMetrics } from '../../../proactive/metrics.js';
import { previewSubscription } from '../../../proactive/scenarios/preview.js';
import { ReadonlyProactiveAgentExecutor } from '../../../proactive/execution/agent-executor.js';
import { prepareBrowserPush, registerBrowserPush, unregisterBrowserPush, testBrowserPush, acknowledgeBrowserProbe, listBrowserProbes } from '../../../notifications/web-push.js';
import { cardChanges, getCard, listCards, performCardAction } from '../../../proactive/inbox/cards.js';
import { proactivePreferences, ProactiveConflict, updateProactivePreferences } from '../../../proactive/policy/service.js';
import { controlledSubscriptions, createControlledSubscription, requireSubscription, templateCatalog, updateControlledSubscription } from '../../../proactive/scenarios/control.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerProactiveControlRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  app.onError((error, c) => c.json({ ok: false, error: error instanceof ZodError ? 'Invalid request' : error.message }, error instanceof ProactiveConflict ? 409 : 400));
  const workspace = () => deps.service.currentWorkspacePath;
  for (const path of ['/api/proactive/*', '/api/inbox/judgments/*']) {
    app.use(path, async (c, next) => {
      try {
        const id = c.req.path.match(/^\/api\/inbox\/judgments\/([^/]+)/)?.[1];
        if (id && id !== 'changes') getCard(decodeURIComponent(id), workspace());
        await next();
      } catch (error) {
        return c.json({ ok: false, error: error instanceof ZodError ? 'Invalid request' : error instanceof Error ? error.message : 'Request failed' }, error instanceof ProactiveConflict ? 409 : 400);
      }
    });
  }
  app.get('/api/proactive/web-push/probes', (c) => c.json({ ok: true, probes: listBrowserProbes(workspace()) }));
  app.post('/api/proactive/web-push/subscriptions/:id/test', deps.strictRateLimitMiddleware, async (c) => c.json({ ok: true, ...await testBrowserPush(workspace(), c.req.param('id')) }));
  app.post('/api/proactive/web-push/probes/:id/opened', deps.strictRateLimitMiddleware, (c) => { acknowledgeBrowserProbe(workspace(), c.req.param('id')); return c.json({ ok: true }); });
  app.post('/api/proactive/web-push/prepare', deps.strictRateLimitMiddleware, (c) => c.json({ ok: true, ...prepareBrowserPush() }));
  app.post('/api/proactive/web-push/subscriptions', deps.strictRateLimitMiddleware, async (c) => c.json({ ok: true, ...registerBrowserPush(workspace(), await c.req.json()) }, 201));
  app.delete('/api/proactive/web-push/subscriptions/:id', deps.strictRateLimitMiddleware, (c) => { unregisterBrowserPush(workspace(), c.req.param('id')); return c.json({ ok: true }); });
  app.get('/api/inbox/judgments/:itemId/workflow', async (c) => c.json({ ok: true, workflow: await workflowForCard(c.req.param('itemId'), workspace(), deps.service.createWorkflowRunService()) }));
  app.post('/api/inbox/judgments/:itemId/prepare', deps.strictRateLimitMiddleware, async (c) => {
    const card = getCard(c.req.param('itemId'), workspace());
    const sub = requireSubscription(card.subscriptionId, workspace());
    const config = deps.service.currentConfig;
    const agentId = sub.scopeKind === 'project' ? resolveProjectAgentId({ config, projects: deps.service.projects, projectId: sub.scopeId }) : getDefaultAgentId(config);
    return c.json({ ok: true, workflow: await prepareCardWorkflow(workspace(), card.id, await c.req.json(), agentId, deps.service.createWorkflowRunService()) }, 202);
  });
  app.post('/api/proactive/presence', deps.strictRateLimitMiddleware, async (c) => { recordProactivePresence(workspace(), await c.req.json()); return c.json({ ok: true }); });
  app.get('/api/proactive/metrics', (c) => c.json({ ok: true, metrics: proactiveMetrics(workspace()) }));
  app.get('/api/proactive/digests/:id', (c) => c.json({ ok: true, cards: digestCards(c.req.param('id'), workspace()) }));
  app.post('/api/proactive/subscriptions/:id/preview', deps.strictRateLimitMiddleware, async (c) => c.json({ ok: true, ...await previewSubscription(workspace(), c.req.param('id'), new ReadonlyProactiveAgentExecutor(() => deps.service.getConfig()), c.req.raw.signal) }));
  app.get('/api/proactive/templates', (c) => c.json({ ok: true, templates: templateCatalog(workspace()) }));
  app.get('/api/proactive/preferences', (c) => c.json({ ok: true, preferences: proactivePreferences(workspace()) }));
  app.patch('/api/proactive/preferences', deps.strictRateLimitMiddleware, async (c) => c.json({ ok: true, preferences: updateProactivePreferences(workspace(), await c.req.json()) }));
  app.get('/api/proactive/subscriptions', (c) => c.json({ ok: true, subscriptions: controlledSubscriptions(workspace()) }));
  app.post('/api/proactive/subscriptions', deps.strictRateLimitMiddleware, async (c) => c.json({ ok: true, subscription: createControlledSubscription(workspace(), await c.req.json()) }, 201));
  app.patch('/api/proactive/subscriptions/:id', deps.strictRateLimitMiddleware, async (c) => c.json({ ok: true, subscription: updateControlledSubscription(workspace(), c.req.param('id'), await c.req.json()) }));
  app.get('/api/proactive/subscriptions/:id/runs', (c) => {
    requireSubscription(c.req.param('id'), workspace());
    return c.json({ ok: true, runs: getSqliteDatabase().prepare(`SELECT run_id AS id, status, outcome_reason AS reason,
      started_at AS startedAt, completed_at AS completedAt, error_message AS error FROM proactive_runs WHERE subscription_id = ? ORDER BY started_at DESC LIMIT 30`).all(c.req.param('id')) });
  });
  app.get('/api/proactive/cards', (c) => c.json({ ok: true, ...listCards(workspace(), { status: c.req.query('status'), before: c.req.query('before') }) }));
  app.get('/api/inbox/judgments/changes', (c) => {
    const cursor = Number(c.req.query('cursor') ?? 0);
    if (!Number.isSafeInteger(cursor) || cursor < 0) return c.json({ ok: false, error: 'Invalid cursor' }, 400);
    return c.json({ ok: true, ...cardChanges(workspace(), cursor) });
  });
  app.get('/api/inbox/judgments/:itemId', (c) => c.json({ ok: true, card: getCard(c.req.param('itemId'), workspace()) }));
  app.post('/api/inbox/judgments/:itemId/actions', deps.strictRateLimitMiddleware, async (c) => {
    const card = performCardAction(c.req.param('itemId'), workspace(), await c.req.json());
    deps.service.emit('proactive.card.changed', { cardId: card.id, revision: card.revision });
    return c.json({ ok: true, card });
  });
}
