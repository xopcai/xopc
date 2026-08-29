import type { Hono } from 'hono';

import { listGatewayAgents } from '../../agents-admin.js';
import {
  acknowledgeHomeAttention,
  decideConnectorApproval,
} from '../../../storage/sqlite/index.js';
import { HomeQueryService } from '../../../tasks/home-query-service.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export { buildHomeWorkbench, decisionFromTask } from '../../../tasks/home-query-service.js';

/** Register the unified work-home read model and its decision actions. */
export function registerHomeRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;
  const home = new HomeQueryService(service);

  authenticated.get('/api/home', async (c) => c.json(await home.getSnapshot(c.req.query('locale'))));

  authenticated.post('/api/home/decisions/respond', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const decision = body.decision === 'approve' ? 'approve' : body.decision === 'deny' ? 'deny' : undefined;
    if (!decision) return c.json({ ok: false, error: 'Decision must be approve or deny' }, 400);
    if (body.kind === 'connector_approval' && typeof body.approvalId === 'string') {
      const approval = decideConnectorApproval(body.approvalId, decision === 'approve' ? 'approved' : 'denied');
      if (!approval) return c.json({ ok: false, error: 'Approval not found' }, 404);
      if (approval.status !== (decision === 'approve' ? 'approved' : 'denied')) {
        return c.json({ ok: false, error: `Approval is ${approval.status}` }, 409);
      }
      return c.json({ ok: true, status: approval.status });
    }
    return c.json({ ok: false, error: 'Unsupported decision kind' }, 400);
  });

  authenticated.post('/api/home/attention/acknowledge', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const kind = body.kind === 'automation_run' || body.kind === 'workflow_run' ? body.kind : undefined;
    const runId = typeof body.runId === 'string' ? body.runId.trim() : '';
    if (!kind || !runId) return c.json({ ok: false, error: 'kind and runId are required' }, 400);
    acknowledgeHomeAttention(kind, runId);
    return c.json({ ok: true, status: 'acknowledged' });
  });

  authenticated.post('/api/home/attention/retry', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const kind = body.kind === 'automation_run' || body.kind === 'workflow_run' ? body.kind : undefined;
    const runId = typeof body.runId === 'string' ? body.runId.trim() : '';
    if (!kind || !runId) return c.json({ ok: false, error: 'kind and runId are required' }, 400);

    if (kind === 'automation_run') {
      try {
        const run = await service.automationServiceInstance.rerunFromRun(runId);
        acknowledgeHomeAttention(kind, runId);
        return c.json({ ok: true, runId: run.id }, 202);
      } catch (error) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : 'Failed to retry automation' }, 400);
      }
    }

    const agents = await listGatewayAgents(service.currentConfig);
    const result = await service.createWorkflowRunService().retryWorkflowRun({ agentId: agents.defaultId, runId });
    if (result.ok === false) return c.json({ ok: false, error: result.message, code: result.code }, result.httpStatus);
    acknowledgeHomeAttention(kind, runId);
    return c.json({ ok: true, runId: result.runId, sessionKey: result.sessionKey }, 202);
  });
}
