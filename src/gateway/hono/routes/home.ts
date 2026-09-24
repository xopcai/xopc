import type { Hono } from 'hono';
import {
  HomeAdvisorRefreshRequestSchema,
  HomeAdviceMetricsSchema,
  HomeOpportunityFeedbackUndoRequestSchema,
  HomeOpportunityHistoryResponseSchema,
  HomeOpportunityActionRequestSchema,
  HomeOpportunityFeedbackRequestSchema,
} from '@xopcai/gateway-contract';
import { resumeApprovedConnectorAction } from '../../../connectors/approval-resume.js';

import { listGatewayAgents } from '../../agents-admin.js';
import {
  acknowledgeHomeAttention,
  decideConnectorApproval,
} from '../../../storage/sqlite/index.js';
import { HomeQueryService } from '../../../tasks/home-query-service.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import {
  HomeOpportunityActionError,
  HomeOpportunityNotFoundError,
} from '../../../home-intelligence/application-service.js';

export { buildHomeWorkbench, decisionFromTask } from '../../../tasks/home-query-service.js';

/** Register the unified work-home read model and its decision actions. */
export function registerHomeRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;
  const home = new HomeQueryService(service, () => service.homeIntelligence.getAdvisor());

  authenticated.get('/api/home', async (c) => {
    const locale = c.req.query('locale');
    service.homeIntelligence.requestRefresh('home_opened', undefined, locale);
    return c.json(await home.getSnapshot(locale));
  });

  authenticated.get('/api/home/advisor/metrics', (c) => {
    const rawSince = c.req.query('since');
    const since = rawSince === undefined ? undefined : Number(rawSince);
    if (since !== undefined && (!Number.isSafeInteger(since) || since < 0)) {
      return c.json({ ok: false, error: 'since must be a non-negative integer timestamp' }, 400);
    }
    return c.json(HomeAdviceMetricsSchema.parse(service.homeIntelligence.getMetrics(since)));
  });

  authenticated.get('/api/home/advisor/history', (c) => c.json(HomeOpportunityHistoryResponseSchema.parse({
    items: service.homeIntelligence.getHistory(),
  })));

  authenticated.post('/api/home/advisor/refresh', deps.strictRateLimitMiddleware, async (c) => {
    const parsed = HomeAdvisorRefreshRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid refresh request' }, 400);
    const generationId = service.homeIntelligence.requestRefresh(
      'manual_refresh', parsed.data.idempotencyKey, parsed.data.locale,
    );
    return c.json({ ok: true, generationId }, 202);
  });

  authenticated.post('/api/home/opportunities/:id/action', deps.strictRateLimitMiddleware, async (c) => {
    const parsed = HomeOpportunityActionRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid opportunity action' }, 400);
    try {
      return c.json(service.homeIntelligence.act(c.req.param('id'), parsed.data));
    } catch (error) {
      if (error instanceof HomeOpportunityNotFoundError) return c.json({ ok: false, error: error.message }, 404);
      if (error instanceof HomeOpportunityActionError || (error instanceof Error && error.message.includes('stale'))) {
        return c.json({ ok: false, error: error.message }, 409);
      }
      throw error;
    }
  });

  authenticated.post('/api/home/opportunities/:id/feedback', deps.strictRateLimitMiddleware, async (c) => {
    const parsed = HomeOpportunityFeedbackRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid opportunity feedback' }, 400);
    try {
      service.homeIntelligence.feedback(c.req.param('id'), parsed.data);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof HomeOpportunityNotFoundError) return c.json({ ok: false, error: error.message }, 404);
      if (error instanceof Error && (error.message.includes('stale') || error.message.includes('snoozedUntil'))) {
        return c.json({ ok: false, error: error.message }, 409);
      }
      throw error;
    }
  });

  authenticated.post('/api/home/opportunities/:id/feedback/undo', deps.strictRateLimitMiddleware, async (c) => {
    const parsed = HomeOpportunityFeedbackUndoRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid feedback undo request' }, 400);
    try {
      service.homeIntelligence.undoFeedback(c.req.param('id'), parsed.data.idempotencyKey);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof Error) return c.json({ ok: false, error: error.message }, 409);
      throw error;
    }
  });

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
      const resumed = await resumeApprovedConnectorAction(approval, service.connectionRecovery);
      return c.json({ ok: true, status: approval.status, resumed });
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

    const agents = await listGatewayAgents();
    const result = await service.createWorkflowRunService().retryWorkflowRun({ agentId: agents.defaultId, runId });
    if (result.ok === false) return c.json({ ok: false, error: result.message, code: result.code }, result.httpStatus);
    acknowledgeHomeAttention(kind, runId);
    return c.json({ ok: true, runId: result.runId, conversationId: result.conversationId }, 202);
  });
}
