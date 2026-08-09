import type { Hono } from 'hono';

import {
  acceptFocusCandidate,
  createFocusActivity,
  FocusService,
  getFocusInsight,
  listFocusActivities,
  listFocusCandidates,
  listFocusInsights,
  setFocusCandidateStatus,
  setFocusInsightStatus,
  type FocusMonitorKind,
  type FocusStatus,
} from '../../../focuses/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const FOCUS_STATUSES: FocusStatus[] = ['active', 'paused', 'completed'];
const MONITOR_KINDS: FocusMonitorKind[] = ['progress', 'external_changes'];

function stringField(body: unknown, field: string): string {
  if (!body || typeof body !== 'object') return '';
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' ? value.trim() : '';
}

function stringArrayField(body: unknown, field: string): string[] | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = (body as Record<string, unknown>)[field];
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
}

export function registerFocusRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const focuses = new FocusService(deps.service.automationServiceInstance);
  const limited = deps.strictRateLimitMiddleware;

  authenticated.get('/api/focuses', (c) => {
    const requested = c.req.query('status')?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
    const statuses = requested.length > 0
      ? requested.filter((item): item is FocusStatus => FOCUS_STATUSES.includes(item as FocusStatus))
      : undefined;
    if (requested.length > 0 && statuses?.length !== requested.length) {
      return c.json({ ok: false, error: 'Invalid focus status' }, 400);
    }
    return c.json({ ok: true, focuses: focuses.list(statuses) });
  });

  authenticated.post('/api/focuses', limited, async (c) => {
    const body = await c.req.json().catch(() => null);
    const title = stringField(body, 'title');
    if (!title) return c.json({ ok: false, error: 'Focus title is required' }, 400);
    const focus = focuses.create({
      title,
      summary: stringField(body, 'summary'),
      ...(stringArrayField(body, 'projectIds') ? { projectIds: stringArrayField(body, 'projectIds') } : {}),
      ...(stringField(body, 'goalId') ? { goalId: stringField(body, 'goalId') } : {}),
    });
    deps.service.emit('focus.created', { focus });
    return c.json({ ok: true, focus }, 201);
  });

  authenticated.get('/api/focuses/:focusId', (c) => {
    const focus = focuses.get(c.req.param('focusId'));
    return focus ? c.json({ ok: true, focus }) : c.json({ ok: false, error: 'Focus not found' }, 404);
  });

  authenticated.patch('/api/focuses/:focusId', limited, async (c) => {
    const body = await c.req.json().catch(() => null);
    const requestedStatus = stringField(body, 'status');
    if (requestedStatus && !FOCUS_STATUSES.includes(requestedStatus as FocusStatus)) {
      return c.json({ ok: false, error: 'Invalid focus status' }, 400);
    }
    try {
      const title = stringField(body, 'title');
      const hasSummary = typeof (body as Record<string, unknown> | null)?.summary === 'string';
      const projectIds = stringArrayField(body, 'projectIds');
      const hasContentUpdate = Boolean(title || hasSummary || projectIds);
      let focus = hasContentUpdate
        ? focuses.update(c.req.param('focusId'), {
            ...(title ? { title } : {}),
            ...(hasSummary ? { summary: stringField(body, 'summary') } : {}),
            ...(projectIds ? { projectIds } : {}),
          })
        : focuses.get(c.req.param('focusId'));
      if (focus && requestedStatus) {
        focus = await focuses.setStatus(c.req.param('focusId'), requestedStatus as FocusStatus);
      }
      if (!focus) return c.json({ ok: false, error: 'Focus not found' }, 404);
      deps.service.emit('focus.updated', { focus });
      return c.json({ ok: true, focus });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.delete('/api/focuses/:focusId', limited, async (c) => {
    try {
      const deleted = await focuses.remove(c.req.param('focusId'));
      if (!deleted) return c.json({ ok: false, error: 'Focus not found' }, 404);
      deps.service.emit('focus.deleted', { focusId: c.req.param('focusId') });
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  authenticated.put('/api/focuses/:focusId/monitors/:kind', limited, async (c) => {
    const kind = c.req.param('kind') as FocusMonitorKind;
    if (!MONITOR_KINDS.includes(kind)) return c.json({ ok: false, error: 'Invalid monitor kind' }, 400);
    const body = await c.req.json().catch(() => null);
    const enabled = body && typeof body === 'object' ? (body as Record<string, unknown>).enabled : undefined;
    if (typeof enabled !== 'boolean') return c.json({ ok: false, error: 'enabled must be a boolean' }, 400);
    const everyMs = body && typeof body === 'object'
      && (body as Record<string, unknown>).cadence
      && typeof (body as Record<string, unknown>).cadence === 'object'
      ? Number(((body as { cadence: Record<string, unknown> }).cadence).everyMs)
      : undefined;
    try {
      const result = await focuses.configureMonitor({
        focusId: c.req.param('focusId'),
        kind,
        enabled,
        ...(Number.isFinite(everyMs) ? { cadence: { kind: 'interval', everyMs: everyMs! } } : {}),
      });
      deps.service.emit('focus.monitor.updated', { focusId: c.req.param('focusId'), monitor: result.monitor });
      return c.json({ ok: true, ...result }, result.initialRunId ? 202 : 200);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.post('/api/focuses/:focusId/monitors/:kind/run', limited, async (c) => {
    const kind = c.req.param('kind') as FocusMonitorKind;
    if (!MONITOR_KINDS.includes(kind)) return c.json({ ok: false, error: 'Invalid monitor kind' }, 400);
    try {
      const run = await focuses.runMonitorNow(c.req.param('focusId'), kind);
      deps.service.emit('focus.run.updated', { focusId: c.req.param('focusId'), kind, run });
      return c.json({ ok: true, run }, 202);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.get('/api/focuses/:focusId/activities', (c) => c.json({
    ok: true,
    activities: listFocusActivities({
      focusId: c.req.param('focusId'),
      ...(Number.isFinite(Number(c.req.query('before'))) ? { before: Number(c.req.query('before')) } : {}),
      ...(Number.isFinite(Number(c.req.query('limit'))) ? { limit: Number(c.req.query('limit')) } : {}),
    }),
  }));

  authenticated.get('/api/focuses/:focusId/insights', (c) => c.json({
    ok: true,
    insights: listFocusInsights({ focusId: c.req.param('focusId'), limit: Number(c.req.query('limit')) || 20 }),
  }));

  authenticated.post('/api/focuses/:focusId/insights/:insightId/dismiss', limited, (c) => {
    const insight = getFocusInsight(c.req.param('insightId'));
    if (!insight || insight.focusId !== c.req.param('focusId')) {
      return c.json({ ok: false, error: 'Insight not found' }, 404);
    }
    const updated = setFocusInsightStatus(insight.id, 'dismissed', 'unread');
    if (!updated) return c.json({ ok: false, error: 'Insight was already handled' }, 409);
    createFocusActivity({
      focusId: insight.focusId,
      monitorId: insight.monitorId,
      type: 'insight_dismissed',
      summary: insight.title,
      details: { insightId: insight.id },
    });
    deps.service.emit('focus.insight.updated', { insight: updated });
    return c.json({ ok: true, insight: updated });
  });

  authenticated.post('/api/focuses/:focusId/insights/:insightId/investigate', limited, async (c) => {
    const insight = getFocusInsight(c.req.param('insightId'));
    const focus = focuses.get(c.req.param('focusId'));
    if (!insight || !focus || insight.focusId !== focus.id) {
      return c.json({ ok: false, error: 'Insight not found' }, 404);
    }
    const claimed = setFocusInsightStatus(insight.id, 'approved', 'unread');
    if (!claimed) return c.json({ ok: false, error: 'Insight was already handled' }, 409);
    let automationId: string | undefined;
    try {
      const automation = await deps.service.automationServiceInstance.create({
        name: `Investigate: ${insight.title}`.slice(0, 200),
        description: `User-approved investigation for focus insight ${insight.id}.`,
        ...(focus.projectIds[0] ? { projectId: focus.projectIds[0] } : {}),
        trigger: { kind: 'manual' },
        action: {
          kind: 'agent',
          instruction: [
            'Investigate this user-approved focus insight in read-only mode.',
            `Focus: ${focus.title}`,
            `Observed change: ${insight.summary}`,
            `Why it matters: ${insight.whyItMatters}`,
            `Next step: ${insight.nextAction}`,
            `Evidence: ${JSON.stringify(insight.evidence)}`,
            'Return a concise result with evidence. Do not modify files or external systems.',
          ].join('\n'),
          timeoutSeconds: 300,
        },
        safety: { mode: 'suggest_only' },
        afterRun: { kind: 'none' },
        reliability: { timeoutSeconds: 300, disableAfterConsecutiveFailures: 1 },
      });
      automationId = automation.id;
      const run = await deps.service.automationServiceInstance.runNow(automation.id);
      createFocusActivity({
        focusId: focus.id,
        monitorId: insight.monitorId,
        type: 'insight_approved',
        summary: insight.title,
        details: { insightId: insight.id, automationId, runId: run.id },
      });
      deps.service.emit('focus.insight.updated', { insight: claimed, investigationRunId: run.id });
      return c.json({ ok: true, insight: claimed, automationId, runId: run.id }, 202);
    } catch (error) {
      if (automationId) await deps.service.automationServiceInstance.remove(automationId);
      setFocusInsightStatus(insight.id, 'unread', 'approved');
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  authenticated.get('/api/focus-candidates', (c) => c.json({
    ok: true,
    candidates: listFocusCandidates(),
  }));

  authenticated.post('/api/focus-candidates/:candidateId/accept', limited, (c) => {
    const focus = acceptFocusCandidate(c.req.param('candidateId'));
    if (!focus) return c.json({ ok: false, error: 'Focus candidate not found' }, 404);
    const detail = focuses.get(focus.id)!;
    deps.service.emit('focus.created', { focus: detail });
    return c.json({ ok: true, focus: detail }, 201);
  });

  authenticated.post('/api/focus-candidates/:candidateId/dismiss', limited, (c) => {
    const candidate = setFocusCandidateStatus(c.req.param('candidateId'), 'dismissed');
    if (!candidate) return c.json({ ok: false, error: 'Focus candidate not found' }, 404);
    deps.service.emit('focus.candidate.updated', { candidate });
    return c.json({ ok: true, candidate });
  });
}
