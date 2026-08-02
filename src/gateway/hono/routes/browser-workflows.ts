import type { Hono } from 'hono';

import type { BrowserRecipe, BrowserRecipeRun } from '../../../browser/recipes/index.js';
import type { GatewayService } from '../../service.js';
import type { AuthenticatedRouteDeps } from './deps.js';

type BrowserWorkflowService = GatewayService['browserRecipes'];

function presentWorkflow(service: BrowserWorkflowService, recipe: BrowserRecipe) {
  const inputs = service.validate(recipe.yaml).document?.args ?? {};
  return {
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    enabled: recipe.status === 'published',
    risk: recipe.risk,
    domains: recipe.domains,
    inputs,
    createdAtMs: recipe.createdAtMs,
    updatedAtMs: recipe.updatedAtMs,
  };
}

function presentRun(run: BrowserRecipeRun) {
  return {
    id: run.id,
    workflowId: run.recipeId,
    status: run.status,
    inputs: run.args,
    result: run.result,
    error: run.error,
    createdAtMs: run.createdAtMs,
    startedAtMs: run.startedAtMs,
    endedAtMs: run.endedAtMs,
    durationMs: run.durationMs,
  };
}

export function registerBrowserWorkflowRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const service = deps.service.browserRecipes;

  authenticated.get('/api/browser/workflows', (c) => c.json({
    workflows: service.list().map((recipe) => presentWorkflow(service, recipe)),
  }));
  authenticated.get('/api/browser/workflows/:id', (c) => {
    const recipe = service.get(c.req.param('id'));
    return recipe
      ? c.json({ workflow: presentWorkflow(service, recipe) })
      : c.json({ error: 'Browser automation not found' }, 404);
  });
  authenticated.patch('/api/browser/workflows/:id', deps.strictRateLimitMiddleware, async (c) => {
    try {
      const current = service.get(c.req.param('id'));
      if (!current) return c.json({ error: 'Browser automation not found' }, 404);
      const body = await c.req.json().catch(() => null) as { enabled?: unknown } | null;
      if (typeof body?.enabled !== 'boolean') return c.json({ error: 'enabled must be a boolean' }, 400);
      const workflow = service.save({
        yaml: current.yaml,
        status: body.enabled ? 'published' : 'disabled',
        expectedId: current.id,
      });
      return c.json({ workflow: presentWorkflow(service, workflow) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  authenticated.delete('/api/browser/workflows/:id', deps.strictRateLimitMiddleware, (c) => {
    try {
      return c.json({ removed: service.remove(c.req.param('id')) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });
  authenticated.post('/api/browser/workflows/:id/run', deps.strictRateLimitMiddleware, async (c) => {
    try {
      const body = await c.req.json().catch(() => ({})) as { inputs?: unknown };
      if (body.inputs !== undefined && (!body.inputs || typeof body.inputs !== 'object' || Array.isArray(body.inputs))) {
        return c.json({ error: 'inputs must be an object' }, 400);
      }
      const run = service.startRun(c.req.param('id'), (body.inputs ?? {}) as Record<string, unknown>);
      return c.json({ run: presentRun(run) }, 202);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  authenticated.get('/api/browser/workflow-runs', (c) => c.json({
    runs: service.listRuns(c.req.query('workflowId')).map(presentRun),
  }));
  authenticated.get('/api/browser/workflow-runs/:id', (c) => {
    const run = service.getRun(c.req.param('id'));
    return run ? c.json({ run: presentRun(run) }) : c.json({ error: 'Run not found' }, 404);
  });
  authenticated.post('/api/browser/workflow-runs/:id/cancel', deps.strictRateLimitMiddleware, (c) => c.json({ cancelled: service.cancel(c.req.param('id')) }));
}
