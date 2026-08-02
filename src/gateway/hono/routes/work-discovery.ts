import type { Hono } from 'hono';

import { getAgentDefaultModelRef } from '../../../config/schema.js';
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
