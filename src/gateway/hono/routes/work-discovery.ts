import type { Hono } from 'hono';

import { getAgentDefaultModelRef } from '../../../config/schema.js';
import { isLocalModelBaseUrl } from '../../../providers/model-call.js';
import { resolveModel } from '../../../providers/index.js';
import { previewWorkDiscoveryRoot, WORK_DISCOVERY_SCAN_POLICY_VERSION } from '../../../work-discovery/probe.js';
import { WorkDiscoveryService } from '../../../work-discovery/service.js';
import type { WorkDiscoverySource } from '../../../work-discovery/types.js';
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

  authenticated.post('/api/work-discovery/runs/:runId/cancel', (c) => {
    const run = service.cancelRun(c.req.param('runId'));
    return run ? c.json({ ok: true, run }) : c.json({ ok: false, error: 'Run not found' }, 404);
  });

  authenticated.post('/api/work-discovery/runs/:runId/retry', (c) => {
    const run = service.retryRun(c.req.param('runId'));
    return run ? c.json({ ok: true, run }) : c.json({ ok: false, error: 'Run not found' }, 404);
  });

  authenticated.post('/api/work-discovery/runs/:runId/suggestions/:suggestionId/select', (c) => {
    const run = service.selectSuggestion(c.req.param('runId'), c.req.param('suggestionId'));
    return run ? c.json({ ok: true }) : c.json({ ok: false, error: 'Suggestion not found' }, 404);
  });
}
