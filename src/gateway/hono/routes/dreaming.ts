import type { Hono } from 'hono';
import { type Config } from '../../../config/schema.js';
import { type DreamingPhaseId } from '../../../agent/memory/dreaming/constants.js';
import { readDreamingEvents } from '../../../agent/memory/dreaming/events.js';
import { previewDreamingDeepPromotion } from '../../../agent/memory/dreaming/preview.js';
import { runLightSweep } from '../../../agent/memory/dreaming/light-sweep.js';
import { runDreamingDeepPromotion } from '../../../agent/memory/dreaming/deep-promotion.js';
import { runRemPatterns } from '../../../agent/memory/dreaming/rem-patterns.js';
import { resolveDreamingAgentScope, type DreamingAgentScope } from '../../../agent/memory/dreaming/scope.js';
import { listMemorySignals, listMemoryTraceEvents } from '../../../storage/sqlite/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function resolveRouteScope(cfg: Config): DreamingAgentScope {
  return resolveDreamingAgentScope(cfg);
}

export function registerDreamingRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;

  authenticated.get('/api/dreaming', async (c) => {
    const cfg = service.currentConfig as Config;
    let scope: DreamingAgentScope;
    try {
      scope = resolveRouteScope(cfg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, 404);
    }
    const signals = listMemorySignals({ workspaceId: scope.workspaceDir, limit: 500 });
    const traces = listMemoryTraceEvents({ limit: 100 }).filter((trace) => trace.phase.startsWith('dreaming_'));

    return c.json({
      ok: true,
      payload: {
        agentId: scope.agentId,
        memory: scope.memory,
        workspaceDir: scope.workspaceDir,
        dreamingRoot: scope.dreamingRoot,
        config: scope.config,
        storePath: 'sqlite://memory_records',
        store: {
          signalCount: signals.length,
          dreamingSignalCount: signals.filter((signal) => signal.source === 'dreaming').length,
          lastSignalAt: signals[0]?.createdAt ?? null,
        },
        traces,
      },
    });
  });

  authenticated.get('/api/dreaming/preview', async (c) => {
    const cfg = service.currentConfig as Config;
    let scope: DreamingAgentScope;
    try {
      scope = resolveRouteScope(cfg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, 404);
    }

    const rawLimit = c.req.query('limit');
    const limit = rawLimit ? Number(rawLimit) : 20;

    const preview = await previewDreamingDeepPromotion({
      workspaceDir: scope.workspaceDir,
      config: scope.config.deep,
      limit: Number.isFinite(limit) ? limit : 20,
    });

    return c.json({ ok: true, payload: preview });
  });

  authenticated.post('/api/dreaming/run', async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { body = {}; }
    const requestedPhase: DreamingPhaseId =
      isRecord(body) && typeof body.phase === 'string' && ['light', 'deep', 'rem'].includes(body.phase)
        ? (body.phase as DreamingPhaseId)
        : 'deep';

    const cfg = service.currentConfig as Config;
    let scope: DreamingAgentScope;
    try {
      scope = resolveRouteScope(cfg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, 404);
    }
    const dreaming = scope.config;
    if (!dreaming.enabled || !dreaming.phases[requestedPhase].enabled) {
      return c.json({
        ok: false,
        error: { message: `Dreaming ${requestedPhase} phase is disabled in config. Enable it first.` },
      }, 400);
    }

    try {
      service.emit('dreaming.phase.start', {
        agentId: scope.agentId,
        phase: requestedPhase,
        timestamp: new Date().toISOString(),
      });

      const result =
        requestedPhase === 'light'
          ? await runLightSweep({
              workspaceDir: scope.workspaceDir,
              config: dreaming.phases.light,
            })
          : requestedPhase === 'rem'
            ? await runRemPatterns({
                agentId: scope.agentId,
                workspaceDir: scope.workspaceDir,
                config: dreaming.phases.rem,
                sensitiveWritePolicy: cfg.userContext.privacy.sensitiveWritePolicy,
                promotionWritePolicy: dreaming.promotionWritePolicy.decision,
              })
            : await runDreamingDeepPromotion({
                agentId: scope.agentId,
                workspaceDir: scope.workspaceDir,
                config: dreaming.phases.deep,
                sensitiveWritePolicy: cfg.userContext.privacy.sensitiveWritePolicy,
                promotionWritePolicy: dreaming.promotionWritePolicy.decision,
              });

      service.emit('dreaming.phase.end', {
        agentId: scope.agentId,
        phase: requestedPhase,
        ok: true,
        timestamp: new Date().toISOString(),
      });

      return c.json({ ok: true, payload: { agentId: scope.agentId, phase: requestedPhase, result } });
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      service.emit('dreaming.phase.end', {
        agentId: scope.agentId,
        phase: requestedPhase,
        ok: false,
        error: em,
        timestamp: new Date().toISOString(),
      });
      return c.json({ ok: false, error: { message: em || 'Failed to trigger job' } }, 400);
    }
  });

  authenticated.get('/api/dreaming/events', async (c) => {
    const cfg = service.currentConfig as Config;
    let scope: DreamingAgentScope;
    try {
      scope = resolveRouteScope(cfg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, 404);
    }

    const rawLimit = c.req.query('limit');
    const limit = rawLimit ? Math.min(Math.max(Number(rawLimit) || 50, 1), 200) : 50;

    const events = await readDreamingEvents(scope.dreamingRoot, limit);
    return c.json({ ok: true, payload: { agentId: scope.agentId, events } });
  });
}
