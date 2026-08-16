import type { Hono } from 'hono';
import {
  ProjectMonitoringUpdateSchema,
  OutcomeActionRequestSchema,
  OutcomeUserStatusSchema,
  WorkIntakeConfirmRequestSchema,
  WorkIntakeCreateRequestSchema,
} from '@xopcai/gateway-contract';

import { ProjectMonitoringService } from '../../../work/project-monitoring-service.js';
import { GoalService } from '../../../goals/index.js';
import { OutcomeRepository } from '../../../work/outcome-repository.js';
import { OutcomeReceiptService } from '../../../work/outcome-receipt-service.js';
import { ProjectOperatingViewService } from '../../../work/project-operating-view-service.js';
import { WorkIntakeService } from '../../../work/work-intake-service.js';
import { WorkValueMetricsService } from '../../../work/work-value-metrics-service.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerWorkRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const intake = new WorkIntakeService(
    deps.service.projects,
    { enqueue: (goalId, options) => deps.service.enqueueGoalRun(goalId, options) },
  );
  const operatingViews = new ProjectOperatingViewService(deps.service.projects, deps.service.workItems);
  const monitoring = new ProjectMonitoringService();
  const metrics = new WorkValueMetricsService();
  const outcomes = new OutcomeRepository();
  const receipts = new OutcomeReceiptService();
  const goals = new GoalService();

  authenticated.get('/api/outcomes', (c) => {
    const status = OutcomeUserStatusSchema.safeParse(c.req.query('status'));
    const rawLimit = Number(c.req.query('limit') ?? 50);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 50;
    return c.json({
      ok: true,
      items: outcomes.list({ ...(status.success ? { status: status.data } : {}), limit }),
    });
  });

  authenticated.get('/api/outcomes/:id', (c) => {
    const outcome = outcomes.get(c.req.param('id'));
    return outcome
      ? c.json({ ok: true, outcome, receipts: receipts.list({ outcomeId: outcome.id, limit: 100 }) })
      : c.json({ ok: false, error: 'Outcome not found' }, 404);
  });

  authenticated.post('/api/outcomes/:id/actions', deps.strictRateLimitMiddleware, async (c) => {
    const outcome = outcomes.get(c.req.param('id'));
    if (!outcome) return c.json({ ok: false, error: 'Outcome not found' }, 404);
    const parsed = OutcomeActionRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid outcome action' }, 400);
    const links = outcomes.listLinks(outcome.id);
    const goalId = links.find((link) => link.kind === 'goal')?.id;
    const goal = goalId ? goals.get(goalId) : undefined;
    if (parsed.data.action === 'pause') {
      if (goal && goal.status !== 'done' && goal.status !== 'archived' && goal.status !== 'paused') {
        goals.pause(goal.id, 'Paused by the user');
      }
      return c.json({
        ok: true,
        outcome: outcomes.updateState({ id: outcome.id, userStatus: 'running', internalStatus: 'paused' }),
      });
    }
    if (parsed.data.action === 'cancel') {
      if (goal && goal.status !== 'done' && goal.status !== 'archived') {
        goals.pause(goal.id, 'Cancelled by the user');
      }
      return c.json({
        ok: true,
        outcome: outcomes.updateState({ id: outcome.id, userStatus: 'completed', internalStatus: 'cancelled' }),
      });
    }
    if (!goal) return c.json({ ok: false, error: 'Outcome has no executable goal' }, 409);
    if (goal.status === 'done' || goal.status === 'archived') goals.reopen(goal.id);
    else if (goal.status !== 'active') goals.resume(goal.id);
    const queued = deps.service.enqueueGoalRun(goal.id, {
      source: 'api',
      executionContext: {
        outcomeId: outcome.id,
        triggerKind: parsed.data.action === 'resume' ? 'retry' : 'user',
      },
    });
    return c.json({
      ok: true,
      outcome: outcomes.updateState({ id: outcome.id, userStatus: 'running', internalStatus: 'continuing' }),
      queued,
    });
  });

  authenticated.post('/api/work/intakes', deps.strictRateLimitMiddleware, async (c) => {
    const parsed = WorkIntakeCreateRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid work intake request' }, 400);
    try {
      const proposal = intake.propose({
        ...parsed.data,
      });
      return c.json({ ok: true, proposal }, 201);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.post('/api/work/intakes/:id/confirm', deps.strictRateLimitMiddleware, async (c) => {
    const parsed = WorkIntakeConfirmRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid work intake confirmation' }, 400);
    try {
      const work = intake.confirm({
        proposalId: c.req.param('id'),
        ...parsed.data,
      });
      return work
        ? c.json({ ok: true, work }, 201)
        : c.json({ ok: false, error: 'Work intake expired or was not found' }, 404);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.get('/api/projects/:projectId/operating-view', (c) => {
    const view = operatingViews.get(c.req.param('projectId'));
    return view
      ? c.json({ ok: true, view })
      : c.json({ ok: false, error: 'Project not found' }, 404);
  });

  authenticated.get('/api/work/metrics', (c) => c.json({ ok: true, metrics: metrics.get() }));

  authenticated.get('/api/projects/:projectId/monitoring', (c) => {
    const projectId = c.req.param('projectId');
    if (!deps.service.projects.get(projectId)) return c.json({ ok: false, error: 'Project not found' }, 404);
    return c.json({ ok: true, policy: monitoring.get(projectId) });
  });

  authenticated.patch('/api/projects/:projectId/monitoring', deps.strictRateLimitMiddleware, async (c) => {
    const projectId = c.req.param('projectId');
    if (!deps.service.projects.get(projectId)) return c.json({ ok: false, error: 'Project not found' }, 404);
    const parsed = ProjectMonitoringUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid monitoring policy' }, 400);
    const current = monitoring.get(projectId);
    try {
      const policy = monitoring.configure({
        projectId,
        mode: parsed.data.mode ?? current.mode,
        quietHours: parsed.data.quietHours === null
          ? undefined
          : parsed.data.quietHours ?? current.quietHours,
        allowedActions: parsed.data.allowedActions ?? current.allowedActions,
        confidenceThreshold: parsed.data.confidenceThreshold ?? current.confidenceThreshold,
        scenarios: parsed.data.scenarios ?? (current.configured ? current.scenarios : undefined),
      });
      return c.json({ ok: true, policy });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
}
