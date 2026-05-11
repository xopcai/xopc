import {
  defaultMaxTurns,
  mergeCustomDataPatch,
  readPersistentGoal,
  serializePersistentGoal,
  PERSISTENT_GOAL_CUSTOM_KEY,
  type PersistentGoalState,
} from './state.js';

export type PersistentGoalUserAction = 'pause' | 'resume' | 'clear' | 'restart';

export type PersistentGoalUserActionResult =
  | { kind: 'updated'; customData: Record<string, unknown>; kickoff?: string }
  | { kind: 'noop'; message: string }
  | { kind: 'error'; error: string };

export interface GoalsConfigSlice {
  maxTurns?: number;
  judgeModelRef?: string;
}

function baseCustomData(customData: Record<string, unknown> | undefined): Record<string, unknown> {
  return { ...(customData ?? {}) };
}

/**
 * Pure transition for `/goal` slash and `POST /api/goals/webchat` so behaviour stays aligned.
 */
export function applyPersistentGoalUserAction(
  customData: Record<string, unknown> | undefined,
  action: PersistentGoalUserAction,
  goalsCfg?: GoalsConfigSlice,
): PersistentGoalUserActionResult {
  const s = readPersistentGoal(customData);

  if (action === 'clear') {
    if (!s || s.status === 'cleared') {
      return { kind: 'noop', message: 'No active goal.' };
    }
    const b = baseCustomData(customData);
    delete b[PERSISTENT_GOAL_CUSTOM_KEY];
    return { kind: 'updated', customData: b };
  }

  if (!s || s.status === 'cleared') {
    if (action === 'pause') return { kind: 'noop', message: 'No goal set.' };
    if (action === 'resume') return { kind: 'noop', message: 'No goal to resume.' };
    if (action === 'restart') return { kind: 'error', error: 'No goal to restart.' };
    return { kind: 'error', error: 'No goal set.' };
  }

  if (action === 'pause') {
    if (s.status !== 'active') {
      return { kind: 'noop', message: statusLineForMessage(s) };
    }
    const next = { ...s, status: 'paused' as const, pausedReason: 'user-paused' as const };
    return {
      kind: 'updated',
      customData: mergeCustomDataPatch(baseCustomData(customData), {
        [PERSISTENT_GOAL_CUSTOM_KEY]: serializePersistentGoal(next),
      }),
    };
  }

  if (action === 'resume') {
    const next: PersistentGoalState = {
      ...s,
      status: 'active',
      pausedReason: undefined,
      turnsUsed: 0,
      consecutiveParseFailures: 0,
    };
    return {
      kind: 'updated',
      customData: mergeCustomDataPatch(baseCustomData(customData), {
        [PERSISTENT_GOAL_CUSTOM_KEY]: serializePersistentGoal(next),
      }),
    };
  }

  // restart
  const maxTurns =
    typeof s.maxTurns === 'number' && Number.isFinite(s.maxTurns)
      ? Math.max(1, Math.min(500, Math.floor(s.maxTurns)))
      : defaultMaxTurns(goalsCfg);
  const judgeFromCfg =
    typeof goalsCfg?.judgeModelRef === 'string' ? goalsCfg.judgeModelRef.trim() : undefined;
  const judgeModelRef = (s.judgeModelRef ?? judgeFromCfg)?.trim() || undefined;
  const next: PersistentGoalState = {
    goal: s.goal,
    status: 'active',
    turnsUsed: 0,
    maxTurns,
    createdAt: Date.now(),
    lastTurnAt: 0,
    consecutiveParseFailures: 0,
    ...(judgeModelRef ? { judgeModelRef } : {}),
    ...(s.uiLocale ? { uiLocale: s.uiLocale } : {}),
    ...(s.checklist?.length
      ? {
          checklist: s.checklist.map((it) => ({ ...it })),
          decomposed: true,
        }
      : {}),
  };
  return {
    kind: 'updated',
    customData: mergeCustomDataPatch(baseCustomData(customData), {
      [PERSISTENT_GOAL_CUSTOM_KEY]: serializePersistentGoal(next),
    }),
    kickoff: s.goal,
  };
}

function statusLineForMessage(state: PersistentGoalState): string {
  const turns = `${state.turnsUsed}/${state.maxTurns} turns`;
  if (state.status === 'active') {
    return `⊙ Goal (active, ${turns}): ${state.goal}`;
  }
  if (state.status === 'paused') {
    const extra = state.pausedReason ? ` — ${state.pausedReason}` : '';
    return `⏸ Goal (paused, ${turns}${extra}): ${state.goal}`;
  }
  if (state.status === 'done') {
    return `✓ Goal done (${turns}): ${state.goal}`;
  }
  return `Goal (${state.status}, ${turns}): ${state.goal}`;
}
