import type { Hono } from 'hono';
import {
  ProjectMonitoringUpdateSchema,
  OutcomeActionRequestSchema,
  OutcomeStartRequestSchema,
  OutcomeUserStatusSchema,
} from '@xopcai/gateway-contract';

import { ProjectMonitoringService } from '../../../work/project-monitoring-service.js';
import { getOutcomeContextManifest } from '../../../work/outcome-context-assembler.js';
import { OutcomeExecutionStateRepository } from '../../../work/outcome-execution-state.js';
import { OutcomeRepository } from '../../../work/outcome-repository.js';
import { OutcomeReceiptService } from '../../../work/outcome-receipt-service.js';
import { ProjectOperatingViewService } from '../../../work/project-operating-view-service.js';
import { WorkValueMetricsService } from '../../../work/work-value-metrics-service.js';
import { OutcomeStartService } from '../../service/outcome-start-service.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerWorkRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const starter = new OutcomeStartService({
    getConfig: () => deps.service.currentConfig,
    projects: deps.service.projects,
    sessions: deps.service.sessionIndexInstance,
    submit: (input) => deps.service.submitSessionInput(input),
  });
  const operatingViews = new ProjectOperatingViewService(deps.service.projects, deps.service.workItems);
  const monitoring = new ProjectMonitoringService();
  const metrics = new WorkValueMetricsService();
  const outcomes = new OutcomeRepository();
  const receipts = new OutcomeReceiptService();
  const executions = new OutcomeExecutionStateRepository();

  authenticated.get('/api/outcomes', (c) => {
    const status = OutcomeUserStatusSchema.safeParse(c.req.query('status'));
    const rawLimit = Number(c.req.query('limit') ?? 50);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 50;
    return c.json({
      ok: true,
      items: outcomes.list({ ...(status.success ? { status: status.data } : {}), limit }),
    });
  });

  authenticated.post('/api/outcomes', deps.strictRateLimitMiddleware, async (c) => {
    const parsed = OutcomeStartRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid outcome request' }, 400);
    try {
      return c.json(await starter.start(parsed.data), 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ ok: false, error: message }, message === 'Project not found' ? 404 : 409);
    }
  });

  authenticated.get('/api/outcomes/:id', (c) => {
    const outcome = outcomes.get(c.req.param('id'));
    if (!outcome) return c.json({ ok: false, error: 'Outcome not found' }, 404);
    const execution = executions.get(outcome.id);
    return c.json({
      ok: true,
      outcome,
      receipts: receipts.list({ outcomeId: outcome.id, limit: 100 }),
      ...(execution ? {
        execution: {
          ...(execution.activeSessionKey ? { sessionKey: execution.activeSessionKey } : {}),
          ...(execution.nextAction ? { nextAction: execution.nextAction } : {}),
          ...(execution.blockedReason ? { blockedReason: execution.blockedReason } : {}),
          approvedBoundaries: execution.approvedBoundaries,
          updatedAt: execution.updatedAt,
        },
      } : {}),
      contextManifest: getOutcomeContextManifest(outcome.id),
    });
  });

  authenticated.post('/api/outcomes/:id/actions', deps.strictRateLimitMiddleware, async (c) => {
    const outcome = outcomes.get(c.req.param('id'));
    if (!outcome) return c.json({ ok: false, error: 'Outcome not found' }, 404);
    const parsed = OutcomeActionRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid outcome action' }, 400);
    const execution = executions.get(outcome.id);
    if (parsed.data.action === 'pause') {
      executions.update(outcome.id, { blockedReason: 'Paused by the user' });
      return c.json({
        ok: true,
        outcome: outcomes.updateState({ id: outcome.id, userStatus: 'running', internalStatus: 'paused' }),
      });
    }
    if (parsed.data.action === 'cancel') {
      executions.update(outcome.id, { blockedReason: 'Cancelled by the user' });
      return c.json({
        ok: true,
        outcome: outcomes.updateState({ id: outcome.id, userStatus: 'completed', internalStatus: 'cancelled' }),
      });
    }
    if (!execution) return c.json({ ok: false, error: 'Outcome has no execution state' }, 409);
    const requestedBoundaries = new Set([
      ...execution.approvedBoundaries,
      ...(parsed.data.approvedBoundaries ?? []),
    ]);
    const requiredBoundaries = outcome.contract?.approvalRequired ?? [];
    const approvedBoundaries = requiredBoundaries
      .filter((boundary) => requestedBoundaries.has(boundary));
    const missingBoundaries = requiredBoundaries
      .filter((boundary) => !requestedBoundaries.has(boundary));
    if (missingBoundaries.length > 0) {
      return c.json({
        ok: false,
        error: 'Required execution boundaries must be approved',
        requiredBoundaries: missingBoundaries,
      }, 409);
    }
    executions.update(outcome.id, {
      approvedBoundaries,
      blockedReason: null,
    });
    const queued = deps.service.enqueueOutcome(outcome.id, {
      source: 'api',
      executionContext: {
        triggerKind: parsed.data.action === 'resume' ? 'retry' : 'user',
      },
    });
    return c.json({
      ok: true,
      outcome: outcomes.updateState({ id: outcome.id, userStatus: 'running', internalStatus: 'continuing' }),
      queued,
    });
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
