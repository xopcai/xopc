import type { Hono } from 'hono';
import fs from 'node:fs/promises';
import path from 'node:path';

import { type Config } from '../../../config/schema.js';
import { normalizeAgentId, resolveDefaultAgentId } from '../../../agent/agent-scope.js';
import {
  DREAMING_DIR_RELATIVE,
  DREAMING_LAST_RUN_RELATIVE,
  SHORT_TERM_PROMOTION_LOCK_RELATIVE,
  SHORT_TERM_RECALL_STORE_RELATIVE,
  type DreamingPhaseId,
} from '../../../agent/memory/dreaming/constants.js';
import { readDreamingEvents } from '../../../agent/memory/dreaming/events.js';
import { previewDreamingDeepPromotion } from '../../../agent/memory/dreaming/preview.js';
import { runLightSweep } from '../../../agent/memory/dreaming/light-sweep.js';
import { runDreamingDeepPromotion } from '../../../agent/memory/dreaming/deep-promotion.js';
import { runRemPatterns } from '../../../agent/memory/dreaming/rem-patterns.js';
import { parseDreamingLastRunFile, type DreamingDeepLastRun } from '../../../agent/memory/dreaming/last-run.js';
import { resolveDreamingAgentScope, type DreamingAgentScope } from '../../../agent/memory/dreaming/scope.js';
import {
  clearStaleDreamingLock,
  loadDreamingStore,
  resetDreamingStore,
  type DreamingStore,
} from '../../../agent/memory/dreaming/short-term-store.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function requestedAgentIdFrom(c: { req: { query(name: string): string | undefined } }, body?: unknown): string | undefined {
  const fromBody = isRecord(body) && typeof body.agentId === 'string' ? body.agentId : undefined;
  return fromBody ?? c.req.query('agentId');
}

function hasEnabledAgent(cfg: Config, agentId: string): boolean {
  const normalized = normalizeAgentId(agentId);
  return cfg.agents.list.some((agent) => agent.enabled !== false && normalizeAgentId(agent.id) === normalized);
}

function resolveRouteScope(cfg: Config, requestedAgentId?: string): DreamingAgentScope {
  const agentId = normalizeAgentId(requestedAgentId || resolveDefaultAgentId(cfg));
  if (!hasEnabledAgent(cfg, agentId)) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  return resolveDreamingAgentScope(cfg, agentId);
}

async function readLockInfo(dreamingRoot: string): Promise<
  | { locked: false }
  | { locked: true; path: string; content: string; mtimeMs?: number }
> {
  const lockPath = path.join(dreamingRoot, SHORT_TERM_PROMOTION_LOCK_RELATIVE);
  try {
    const [content, st] = await Promise.all([fs.readFile(lockPath, 'utf-8'), fs.stat(lockPath)]);
    return {
      locked: true,
      path: SHORT_TERM_PROMOTION_LOCK_RELATIVE,
      content: content.trim(),
      mtimeMs: st.mtimeMs,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') return { locked: false };
    return { locked: true, path: SHORT_TERM_PROMOTION_LOCK_RELATIVE, content: 'unknown', mtimeMs: undefined };
  }
}

async function readLastRun(
  dreamingRoot: string,
): Promise<
  | { exists: false }
  | {
      exists: true;
      path: string;
      raw: unknown;
      record: DreamingDeepLastRun | null;
      parseError: string | null;
    }
> {
  const fullPath = path.join(dreamingRoot, DREAMING_LAST_RUN_RELATIVE);
  try {
    const text = await fs.readFile(fullPath, 'utf-8');
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch (parseErr) {
      return {
        exists: true,
        path: DREAMING_LAST_RUN_RELATIVE,
        raw: null,
        record: null,
        parseError: parseErr instanceof Error ? parseErr.message : String(parseErr),
      };
    }
    const record = parseDreamingLastRunFile(raw);
    return {
      exists: true,
      path: DREAMING_LAST_RUN_RELATIVE,
      raw,
      record,
      parseError: record ? null : 'Invalid or unsupported last-run.json (expected v2 deep record).',
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') return { exists: false };
    return {
      exists: true,
      path: DREAMING_LAST_RUN_RELATIVE,
      raw: null,
      record: null,
      parseError: err instanceof Error ? err.message : String(err),
    };
  }
}

async function readPhaseLastRun(
  dreamingRoot: string,
  filename: string,
): Promise<{ exists: false } | { exists: true; path: string; raw: unknown }> {
  const relPath = path.join(DREAMING_DIR_RELATIVE, filename);
  const fullPath = path.join(dreamingRoot, relPath);
  try {
    const text = await fs.readFile(fullPath, 'utf-8');
    const raw = JSON.parse(text) as unknown;
    return { exists: true, path: relPath, raw };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') return { exists: false };
    return { exists: false };
  }
}

function storeStats(store: DreamingStore): {
  version: number;
  updatedAt: string;
  entryCount: number;
  promotedCount: number;
  lastPromotedAt: string | null;
} {
  const entries = Object.values(store.entries ?? {});
  const promoted = entries.filter((e) => typeof e.promotedAt === 'string' && e.promotedAt.trim());
  const lastPromotedAt = promoted
    .map((e) => e.promotedAt!)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))[0];
  return {
    version: store.version,
    updatedAt: store.updatedAt,
    entryCount: entries.length,
    promotedCount: promoted.length,
    lastPromotedAt: lastPromotedAt ?? null,
  };
}

export function registerDreamingRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;

  authenticated.get('/api/dreaming', async (c) => {
    const cfg = service.currentConfig as Config;
    let scope: DreamingAgentScope;
    try {
      scope = resolveRouteScope(cfg, c.req.query('agentId'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, 404);
    }
    const { store } = await loadDreamingStore({ dreamingRoot: scope.memoriesDir });
    const lock = await readLockInfo(scope.memoriesDir);

    // Read all three phase last-run files in parallel.
    const [lastRun, lightLastRun, remLastRun] = await Promise.all([
      readLastRun(scope.memoriesDir),
      readPhaseLastRun(scope.memoriesDir, 'last-run-light.json'),
      readPhaseLastRun(scope.memoriesDir, 'last-run-rem.json'),
    ]);

    return c.json({
      ok: true,
      payload: {
        agentId: scope.agentId,
        memory: scope.memory,
        workspaceDir: scope.workspaceDir,
        memoriesDir: scope.memoriesDir,
        config: scope.config,
        storePath: path.join(scope.memoriesDir, SHORT_TERM_RECALL_STORE_RELATIVE),
        store: storeStats(store),
        lock,
        lastRun,
        lightLastRun,
        remLastRun,
      },
    });
  });

  authenticated.get('/api/dreaming/preview', async (c) => {
    const cfg = service.currentConfig as Config;
    let scope: DreamingAgentScope;
    try {
      scope = resolveRouteScope(cfg, c.req.query('agentId'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, 404);
    }

    const rawLimit = c.req.query('limit');
    const limit = rawLimit ? Number(rawLimit) : 20;

    const preview = await previewDreamingDeepPromotion({
      workspaceDir: scope.workspaceDir,
      dreamingRoot: scope.memoriesDir,
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
      scope = resolveRouteScope(cfg, requestedAgentIdFrom(c, body));
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
              dreamingRoot: scope.memoriesDir,
              config: dreaming.phases.light,
            })
          : requestedPhase === 'rem'
            ? await runRemPatterns({
                agentId: scope.agentId,
                workspaceDir: scope.workspaceDir,
                dreamingRoot: scope.memoriesDir,
                config: dreaming.phases.rem,
                sensitiveWritePolicy: scope.memory.privacy?.sensitiveWritePolicy,
                promotionWritePolicy: dreaming.promotionWritePolicy.decision,
              })
            : await runDreamingDeepPromotion({
                agentId: scope.agentId,
                workspaceDir: scope.workspaceDir,
                dreamingRoot: scope.memoriesDir,
                config: dreaming.phases.deep,
                sensitiveWritePolicy: scope.memory.privacy?.sensitiveWritePolicy,
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

  authenticated.post('/api/dreaming/action', async (c) => {
    const cfg = service.currentConfig as Config;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const action = isRecord(body) && typeof body.action === 'string' ? body.action.trim() : '';
    let scope: DreamingAgentScope;
    try {
      scope = resolveRouteScope(cfg, requestedAgentIdFrom(c, body));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, 404);
    }

    if (action !== 'reset_store' && action !== 'clear_lock') {
      return c.json({ ok: false, error: { message: 'Invalid action' } }, 400);
    }

    if (action === 'reset_store') {
      await resetDreamingStore({ dreamingRoot: scope.memoriesDir });
      return c.json({
        ok: true,
        payload: { agentId: scope.agentId, reset: true, storePath: path.join(scope.memoriesDir, SHORT_TERM_RECALL_STORE_RELATIVE) },
      });
    }

    const lockPath = path.join(scope.memoriesDir, SHORT_TERM_PROMOTION_LOCK_RELATIVE);
    try {
      const cleared = await clearStaleDreamingLock(scope.memoriesDir);
      return c.json({
        ok: true,
        payload: { agentId: scope.agentId, cleared, lockPath },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, 409);
    }
  });

  authenticated.get('/api/dreaming/events', async (c) => {
    const cfg = service.currentConfig as Config;
    let scope: DreamingAgentScope;
    try {
      scope = resolveRouteScope(cfg, c.req.query('agentId'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { message } }, 404);
    }

    const rawLimit = c.req.query('limit');
    const limit = rawLimit ? Math.min(Math.max(Number(rawLimit) || 50, 1), 200) : 50;

    const events = await readDreamingEvents(scope.memoriesDir, limit);
    return c.json({ ok: true, payload: { agentId: scope.agentId, events } });
  });
}
