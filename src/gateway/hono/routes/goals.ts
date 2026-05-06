import type { Hono } from 'hono';

import {
  defaultMaxTurns,
  mergeCustomDataPatch,
  readPersistentGoal,
  serializePersistentGoal,
  PERSISTENT_GOAL_CUSTOM_KEY,
} from '../../../agent/goals/state.js';
import type { AuthenticatedRouteDeps } from './deps.js';

/** Webchat persistent `/goal` REST API. */
export function registerGoalsRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const sm = deps.service.sessionManagerInstance;
  const cfg = () => deps.service.currentConfig;

  authenticated.get('/api/goals/webchat', async (c) => {
    const sessionKey = c.req.query('sessionKey')?.trim();
    if (!sessionKey) {
      return c.json({ ok: false, error: 'Missing sessionKey' }, 400);
    }
    const m = await sm.getSessionMetadata(sessionKey);
    const goal = readPersistentGoal(m?.customData as Record<string, unknown> | undefined);
    return c.json({ ok: true, sessionKey, persistentGoal: goal });
  });

  authenticated.post('/api/goals/webchat', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : '';
    if (!sessionKey) {
      return c.json({ ok: false, error: 'Missing sessionKey' }, 400);
    }
    if (body.clear === true) {
      const meta = await sm.getSessionMetadata(sessionKey);
      if (!meta) {
        return c.json({ ok: false, error: 'Session not found' }, 404);
      }
      const base = { ...(meta.customData as Record<string, unknown> | undefined) };
      delete base[PERSISTENT_GOAL_CUSTOM_KEY];
      await sm.updateSessionMetadata(sessionKey, { customData: base });
      return c.json({ ok: true, sessionKey, cleared: true });
    }
    const goalText = typeof body.goalText === 'string' ? body.goalText.trim() : '';
    if (!goalText) {
      return c.json({ ok: false, error: 'Missing goalText (or set clear:true)' }, 400);
    }
    const meta = await sm.getSessionMetadata(sessionKey);
    if (!meta) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    const maxTurns =
      typeof body.maxTurns === 'number' && Number.isFinite(body.maxTurns)
        ? Math.max(1, Math.min(500, Math.floor(body.maxTurns)))
        : defaultMaxTurns(cfg().goals);
    const judgeModelRef =
      typeof body.judgeModelRef === 'string' && body.judgeModelRef.trim()
        ? body.judgeModelRef.trim()
        : typeof cfg().goals?.judgeModelRef === 'string'
          ? cfg().goals!.judgeModelRef!.trim()
          : undefined;

    const next = {
      goal: goalText,
      status: 'active' as const,
      turnsUsed: 0,
      maxTurns,
      createdAt: Date.now(),
      lastTurnAt: 0,
      ...(judgeModelRef ? { judgeModelRef } : {}),
    };

    const base = { ...(meta.customData as Record<string, unknown> | undefined) };
    const customData = mergeCustomDataPatch(base, {
      [PERSISTENT_GOAL_CUSTOM_KEY]: serializePersistentGoal(next),
    });
    await sm.updateSessionMetadata(sessionKey, { customData });
    const m2 = await sm.getSessionMetadata(sessionKey);
    const persistentGoal = readPersistentGoal(m2?.customData as Record<string, unknown> | undefined);
    deps.service.enqueueWebchatPersistentGoalKickoff(sessionKey, goalText);
    return c.json({ ok: true, sessionKey, persistentGoal });
  });
}
