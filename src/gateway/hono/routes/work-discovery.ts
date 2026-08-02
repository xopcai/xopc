import type { Hono } from 'hono';

import { getAgentDefaultModelRef } from '../../../config/schema.js';
import {
  FocusService,
  claimProactiveInsightApproval,
  getProactiveInsight,
  listFocusCalendarSignals,
  setProactiveInsightStatus,
  type FocusWatchKind,
  type ProactiveInsightStatus,
} from '../../../proactive/index.js';
import { isLocalModelBaseUrl } from '../../../providers/model-call.js';
import { resolveModel } from '../../../providers/index.js';
import { previewWorkDiscoveryRoot, WORK_DISCOVERY_SCAN_POLICY_VERSION } from '../../../work-discovery/probe.js';
import { WorkDiscoveryService } from '../../../work-discovery/service.js';
import type { WorkDiscoveryRecognitionDecision, WorkDiscoverySource } from '../../../work-discovery/types.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const services = new WeakMap<AuthenticatedRouteDeps['service'], WorkDiscoveryService>();

function workDiscoveryService(deps: AuthenticatedRouteDeps): WorkDiscoveryService {
  const existing = services.get(deps.service);
  if (existing) return existing;
  const service = new WorkDiscoveryService({
    projects: deps.service.projects,
    sessions: deps.service.sessionIndexInstance,
    getConfig: () => deps.service.currentConfig,
    emit: (type, payload) => deps.service.emit(type, payload),
  });
  services.set(deps.service, service);
  return service;
}

function stringField(body: unknown, field: string): string {
  if (!body || typeof body !== 'object') return '';
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' ? value.trim() : '';
}

export function registerWorkDiscoveryRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const service = workDiscoveryService(deps);
  const focuses = new FocusService(deps.service.automationServiceInstance);
  const limited = deps.strictRateLimitMiddleware;

  authenticated.get('/api/onboarding/work-discovery', (c) => c.json({
    enabled: service.isEnabled(),
    state: service.getOnboardingState(),
  }));

  authenticated.patch('/api/onboarding/work-discovery', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (stringField(body, 'status') !== 'dismissed') {
      return c.json({ ok: false, error: 'Only dismissed status is accepted' }, 400);
    }
    return c.json({ ok: true, state: service.dismissOnboarding() });
  });

  authenticated.post('/api/work-discovery/preview', limited, async (c) => {
    if (!service.isEnabled()) return c.json({ ok: false, error: 'Work discovery is disabled' }, 404);
    const body = await c.req.json().catch(() => null);
    const rootPath = stringField(body, 'rootPath');
    if (!rootPath) return c.json({ ok: false, error: 'Missing rootPath' }, 400);
    try {
      const preview = await previewWorkDiscoveryRoot(rootPath);
      const modelRef = getAgentDefaultModelRef(deps.service.currentConfig);
      if (!modelRef) return c.json({ ok: false, error: 'No default model configured' }, 409);
      const model = resolveModel(modelRef);
      return c.json({
        ok: true,
        preview: {
          ...preview,
          exists: true,
          readable: true,
          provider: model.provider,
          remoteModel: !isLocalModelBaseUrl(model.baseUrl),
          policyVersion: WORK_DISCOVERY_SCAN_POLICY_VERSION,
        },
      });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.post('/api/work-discovery/candidates', limited, async (c) => {
    if (!service.isEnabled()) return c.json({ ok: false, error: 'Work discovery is disabled' }, 404);
    try {
      const candidates = await service.discoverCandidates(c.req.raw.signal);
      return c.json({ ok: true, candidates });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  authenticated.get('/api/work-discovery/sources/directories', (c) => c.json({
    ok: true,
    sources: service.listDirectorySources(),
  }));

  authenticated.post('/api/work-discovery/sources/directories', limited, async (c) => {
    const body = await c.req.json().catch(() => null);
    const rootPath = stringField(body, 'rootPath');
    if (!rootPath) return c.json({ ok: false, error: 'Missing rootPath' }, 400);
    try {
      const source = await service.grantDirectorySource(rootPath);
      return c.json({ ok: true, source }, 201);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.delete('/api/work-discovery/sources/directories/:sourceId', limited, (c) => {
    const source = service.revokeDirectorySource(c.req.param('sourceId'));
    return source ? c.json({ ok: true, source }) : c.json({ ok: false, error: 'Source not found' }, 404);
  });

  authenticated.post('/api/work-discovery/sources/directories/:sourceId/runs', limited, async (c) => {
    const body = await c.req.json().catch(() => null);
    const idempotencyKey = stringField(body, 'idempotencyKey');
    if (!idempotencyKey) return c.json({ ok: false, error: 'Missing idempotencyKey' }, 400);
    try {
      const run = await service.rescanDirectorySource({ id: c.req.param('sourceId'), idempotencyKey });
      return c.json({ ok: true, run }, 202);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.post('/api/work-discovery/sources/directories/check', limited, async (c) => {
    return c.json({ ok: true, checks: await service.checkDirectorySources() });
  });

  authenticated.post('/api/work-discovery/sources/directories/:sourceId/refresh-if-changed', limited, async (c) => {
    const body = await c.req.json().catch(() => null);
    const idempotencyKey = stringField(body, 'idempotencyKey');
    if (!idempotencyKey) return c.json({ ok: false, error: 'Missing idempotencyKey' }, 400);
    try {
      const result = await service.refreshDirectorySourceIfChanged({ id: c.req.param('sourceId'), idempotencyKey });
      return c.json({ ok: true, ...result }, result.changed ? 202 : 200);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.post('/api/work-discovery/personal-context/import', limited, async (c) => {
    if (!service.isEnabled()) return c.json({ ok: false, error: 'Work discovery is disabled' }, 404);
    const body = await c.req.json().catch(() => null);
    const items = body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).items)
      ? (body as { items: unknown[] }).items.slice(0, 150)
      : [];
    const runId = stringField(body, 'runId');
    if (!items.length) return c.json({ ok: false, error: 'No personal context was provided' }, 400);
    try {
      const result = await service.importPersonalContext(items, c.req.raw.signal, runId || undefined);
      return c.json({ ok: true, ...result }, 201);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.post('/api/work-discovery/personal-context/profile', limited, async (c) => {
    const body = await c.req.json().catch(() => null);
    const rawDecisions = body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).decisions)
      ? (body as { decisions: unknown[] }).decisions
      : [];
    const decisions = rawDecisions.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Record<string, unknown>;
      const memoryRecordId = typeof item.memoryRecordId === 'string' ? item.memoryRecordId.trim() : '';
      const status: 'accepted' | 'edited' | 'rejected' | undefined = item.status === 'accepted' || item.status === 'edited' || item.status === 'rejected'
        ? item.status
        : undefined;
      if (!memoryRecordId || !status) return [];
      return [{
        memoryRecordId,
        status,
        ...(typeof item.statement === 'string' ? { statement: item.statement } : {}),
      }];
    }).slice(0, 10);
    if (!decisions.length) return c.json({ ok: false, error: 'At least one valid decision is required' }, 400);
    return c.json({ ok: true, decisions: service.updatePersonalContextProfile({ decisions }) });
  });

  authenticated.post('/api/work-discovery/quick-runs', limited, async (c) => {
    if (!service.isEnabled()) return c.json({ ok: false, error: 'Work discovery is disabled' }, 404);
    const body = await c.req.json().catch(() => null);
    const idempotencyKey = stringField(body, 'idempotencyKey');
    if (!idempotencyKey) return c.json({ ok: false, error: 'Missing idempotencyKey' }, 400);
    try {
      const run = await service.startQuickRun({ idempotencyKey });
      return c.json({ ok: true, run }, 202);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.post('/api/work-discovery/runs', limited, async (c) => {
    if (!service.isEnabled()) return c.json({ ok: false, error: 'Work discovery is disabled' }, 404);
    const body = await c.req.json().catch(() => null);
    const rootPath = stringField(body, 'rootPath');
    const idempotencyKey = stringField(body, 'idempotencyKey');
    const requestedSource = stringField(body, 'source');
    const source: WorkDiscoverySource = requestedSource === 'manual_selected_directory'
      ? 'manual_selected_directory'
      : 'onboarding_selected_directory';
    if (!rootPath || !idempotencyKey) {
      return c.json({ ok: false, error: 'Missing rootPath or idempotencyKey' }, 400);
    }
    try {
      const run = await service.startRun({ rootPath, source, idempotencyKey });
      return c.json({ ok: true, run }, 202);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.get('/api/work-discovery/runs/:runId', (c) => {
    const run = service.getRun(c.req.param('runId'));
    return run ? c.json({ ok: true, run }) : c.json({ ok: false, error: 'Run not found' }, 404);
  });

  authenticated.get('/api/work-discovery/runs/:runId/investigation', (c) => {
    const result = service.getInvestigation(c.req.param('runId'));
    return result ? c.json({ ok: true, ...result }) : c.json({ ok: false, error: 'Investigation not found' }, 404);
  });

  authenticated.get('/api/work-understanding/threads', (c) => {
    const projectId = c.req.query('projectId')?.trim();
    const limit = Number(c.req.query('limit'));
    return c.json({
      ok: true,
      threads: service.listWorkThreads({
        ...(projectId ? { projectId } : {}),
        ...(Number.isFinite(limit) ? { limit } : {}),
      }),
    });
  });

  authenticated.get('/api/work-understanding/metrics', (c) => c.json({
    ok: true,
    metrics: service.getUnderstandingMetrics(),
  }));

  authenticated.get('/api/work-understanding/sources/:sourceId/lineage', (c) => {
    const lineage = service.getSourceLineage(c.req.param('sourceId'));
    return lineage ? c.json({ ok: true, lineage }) : c.json({ ok: false, error: 'Source not found' }, 404);
  });

  authenticated.delete('/api/work-understanding/sources/:sourceId/derived-data', limited, (c) => {
    const deleted = service.deleteSourceDerivedData(c.req.param('sourceId'));
    return deleted ? c.json({ ok: true, deleted }) : c.json({ ok: false, error: 'Source not found' }, 404);
  });

  authenticated.get('/api/work-understanding/threads/:threadId', (c) => {
    const thread = service.getWorkThread(c.req.param('threadId'));
    return thread ? c.json({ ok: true, thread }) : c.json({ ok: false, error: 'Work thread not found' }, 404);
  });

  authenticated.patch('/api/work-understanding/threads/:threadId', limited, async (c) => {
    const body = await c.req.json().catch(() => null);
    const decision = stringField(body, 'decision');
    if (!['confirmed', 'corrected', 'rejected', 'paused', 'completed'].includes(decision)) {
      return c.json({ ok: false, error: 'Invalid work thread decision' }, 400);
    }
    const thread = service.updateWorkThread({
      id: c.req.param('threadId'),
      decision: decision as 'confirmed' | 'corrected' | 'rejected' | 'paused' | 'completed',
      ...(stringField(body, 'correctedTitle') ? { correctedTitle: stringField(body, 'correctedTitle') } : {}),
      ...(stringField(body, 'correctedSummary') ? { correctedSummary: stringField(body, 'correctedSummary') } : {}),
    });
    return thread ? c.json({ ok: true, thread }) : c.json({ ok: false, error: 'Work thread not found' }, 404);
  });

  authenticated.get('/api/focuses', (c) => {
    return c.json({
      ok: true,
      focuses: focuses.list({ includeUnreviewed: c.req.query('includeUnreviewed') === 'true' }),
    });
  });

  authenticated.post('/api/focuses/:focusId/confirm', limited, (c) => {
    const focus = focuses.confirm(c.req.param('focusId'));
    return focus ? c.json({ ok: true, focus }) : c.json({ ok: false, error: 'Focus not found' }, 404);
  });

  authenticated.post('/api/focuses/:focusId/watches/trial', limited, async (c) => {
    const body = await c.req.json().catch(() => null);
    const requestedKind = stringField(body, 'kind');
    const kind: FocusWatchKind | undefined = ['progress', 'staleness', 'deadline', 'intelligence'].includes(requestedKind)
      ? requestedKind as FocusWatchKind
      : undefined;
    try {
      const result = await focuses.activateTrial({ threadId: c.req.param('focusId'), ...(kind ? { kind } : {}) });
      return c.json({ ok: true, ...result }, 201);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.post('/api/focuses/:focusId/watches/:watchId/pause', limited, async (c) => {
    const focus = focuses.list({ includeUnreviewed: true }).find((item) => item.id === c.req.param('focusId'));
    const watch = focus?.watches.find((item) => item.id === c.req.param('watchId'));
    if (!watch) return c.json({ ok: false, error: 'Watch not found' }, 404);
    const paused = await focuses.pauseWatch(watch.id);
    return c.json({ ok: true, watch: paused });
  });

  authenticated.patch('/api/proactive/insights/:insightId', limited, async (c) => {
    const body = await c.req.json().catch(() => null);
    const requested = stringField(body, 'status');
    const status: ProactiveInsightStatus | undefined = requested === 'read' || requested === 'dismissed'
      ? requested
      : undefined;
    if (!status) return c.json({ ok: false, error: 'Status must be read or dismissed' }, 400);
    const insight = setProactiveInsightStatus(c.req.param('insightId'), status, Date.now(), 'unread');
    if (!insight) return c.json({ ok: false, error: 'Insight was already handled or not found' }, 409);
    if (status === 'dismissed') await focuses.recordInsightFeedback(insight.watchId, false);
    return c.json({ ok: true, insight });
  });

  authenticated.post('/api/proactive/insights/:insightId/approve', limited, async (c) => {
    const insight = getProactiveInsight(c.req.param('insightId'));
    if (!insight) return c.json({ ok: false, error: 'Insight not found' }, 404);
    if (insight.status !== 'unread') return c.json({ ok: false, error: `Insight is ${insight.status}` }, 409);
    const focus = focuses.list({ includeUnreviewed: true })
      .find((item) => item.watches.some((watch) => watch.id === insight.watchId));
    if (!focus) return c.json({ ok: false, error: 'Focus not found' }, 404);
    const claimed = claimProactiveInsightApproval(insight.id);
    if (!claimed) return c.json({ ok: false, error: 'Insight was already handled' }, 409);
    let automationId: string | undefined;
    try {
      const automation = await deps.service.automationServiceInstance.create({
        name: `Investigate: ${insight.title}`.slice(0, 200),
        description: `User-approved read-only proposal from proactive insight ${insight.id}.`,
        ...(focus.projectIds[0] ? { projectId: focus.projectIds[0] } : {}),
        trigger: { kind: 'manual' },
        action: {
          kind: 'agent',
          instruction: [
            'The user approved this evidence-backed proposal for read-only investigation and preparation.',
            `Focus: ${focus.title}`,
            `Observed change: ${insight.summary}`,
            `Why it matters: ${insight.whyItMatters}`,
            `Approved next step: ${insight.nextAction}`,
            `Evidence: ${JSON.stringify(insight.evidence)}`,
            'Investigate or prepare the requested material. Return a concise result with evidence. Do not modify files or external systems.',
          ].join('\n'),
          timeoutSeconds: 300,
        },
        safety: { mode: 'suggest_only' },
        afterRun: { kind: 'none' },
        reliability: { timeoutSeconds: 300, disableAfterConsecutiveFailures: 1 },
      });
      automationId = automation.id;
      const run = await deps.service.automationServiceInstance.runNow(automation.id);
      await focuses.recordInsightFeedback(insight.watchId, true);
      return c.json({ ok: true, automationId: automation.id, runId: run.id }, 202);
    } catch (error) {
      if (automationId) await deps.service.automationServiceInstance.remove(automationId);
      setProactiveInsightStatus(insight.id, 'unread', Date.now(), 'approved');
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  authenticated.post('/api/focuses/:focusId/calendar/:signalId/prepare', limited, async (c) => {
    const focus = focuses.list().find((item) => item.id === c.req.param('focusId'));
    if (!focus) return c.json({ ok: false, error: 'Focus not found' }, 404);
    const signal = listFocusCalendarSignals([focus]).find((item) => item.id === c.req.param('signalId'));
    if (!signal) return c.json({ ok: false, error: 'Calendar event not found' }, 404);
    const eventContext = `${signal.title} at ${new Date(signal.startsAt).toISOString()}`;
    try {
      const result = await focuses.activateTrial({ threadId: focus.id, kind: 'deadline', eventContext });
      return c.json({ ok: true, ...result });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  authenticated.post('/api/work-discovery/runs/:runId/cancel', (c) => {
    const run = service.cancelRun(c.req.param('runId'));
    return run ? c.json({ ok: true, run }) : c.json({ ok: false, error: 'Run not found' }, 404);
  });

  authenticated.post('/api/work-discovery/runs/:runId/retry', (c) => {
    const run = service.retryRun(c.req.param('runId'));
    return run ? c.json({ ok: true, run }) : c.json({ ok: false, error: 'Run not found' }, 404);
  });

  authenticated.post('/api/work-discovery/runs/:runId/recognition-feedback', async (c) => {
    const body = await c.req.json().catch(() => null);
    const decision = stringField(body, 'decision');
    if (!['confirmed', 'corrected', 'different_goal', 'dismissed'].includes(decision)) {
      return c.json({ ok: false, error: 'Invalid recognition decision' }, 400);
    }
    try {
      const run = await service.submitRecognitionFeedback({
        runId: c.req.param('runId'),
        decision: decision as WorkDiscoveryRecognitionDecision,
        ...(stringField(body, 'correctedIntent') ? { correctedIntent: stringField(body, 'correctedIntent') } : {}),
      });
      return run ? c.json({ ok: true, run }) : c.json({ ok: false, error: 'Completed run not found' }, 404);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.post('/api/work-discovery/runs/:runId/profile', limited, async (c) => {
    const body = await c.req.json().catch(() => null);
    const rawDecisions = body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).decisions)
      ? (body as { decisions: unknown[] }).decisions
      : [];
    const decisions = rawDecisions.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Record<string, unknown>;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      const status: 'accepted' | 'edited' | 'rejected' | undefined = item.status === 'accepted' || item.status === 'edited' || item.status === 'rejected'
        ? item.status
        : undefined;
      if (!id || !status) return [];
      return [{
        id,
        status,
        ...(typeof item.statement === 'string' ? { statement: item.statement } : {}),
      }];
    }).slice(0, 10);
    if (!decisions.length) return c.json({ ok: false, error: 'At least one valid decision is required' }, 400);
    const run = service.updateProfileCandidates({ runId: c.req.param('runId'), decisions });
    return run ? c.json({ ok: true, run }) : c.json({ ok: false, error: 'Profile candidates not found' }, 404);
  });

  authenticated.post('/api/work-discovery/runs/:runId/suggestions/:suggestionId/select', (c) => {
    const run = service.selectSuggestion(c.req.param('runId'), c.req.param('suggestionId'));
    return run ? c.json({ ok: true }) : c.json({ ok: false, error: 'Suggestion not found' }, 404);
  });
}
