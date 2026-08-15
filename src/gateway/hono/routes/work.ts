import type { Hono } from 'hono';
import { ProjectMonitoringUpdateSchema } from '@xopcai/gateway-contract';

import { ProjectMonitoringService } from '../../../work/project-monitoring-service.js';
import { ProjectOperatingViewService } from '../../../work/project-operating-view-service.js';
import { WorkIntakeService } from '../../../work/work-intake-service.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function registerWorkRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const intake = new WorkIntakeService(deps.service.projects, deps.service.workItems);
  const operatingViews = new ProjectOperatingViewService(deps.service.projects, deps.service.workItems);
  const monitoring = new ProjectMonitoringService();

  authenticated.post('/api/work/intakes', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const objective = optionalString(body.objective);
    if (!objective) return c.json({ ok: false, error: 'Objective is required' }, 400);
    if (objective.length > 12_000) return c.json({ ok: false, error: 'Objective is too long' }, 400);
    try {
      const proposal = intake.propose({
        objective,
        projectId: optionalString(body.projectId),
        sessionKey: optionalString(body.sessionKey),
        agentId: optionalString(body.agentId),
        monitoringMode: body.monitoringMode === 'observe'
          || body.monitoringMode === 'ask_before_action'
          || body.monitoringMode === 'auto_low_risk'
          ? body.monitoringMode
          : undefined,
      });
      return c.json({ ok: true, proposal }, 201);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.post('/api/work/intakes/:id/confirm', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    try {
      const work = intake.confirm({
        proposalId: c.req.param('id'),
        projectId: optionalString(body.projectId),
        projectName: optionalString(body.projectName),
        nextAction: optionalString(body.nextAction),
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
