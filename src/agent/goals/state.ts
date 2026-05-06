/** Persisted under `SessionMetadata.customData.persistentGoal`. */
export const PERSISTENT_GOAL_CUSTOM_KEY = 'persistentGoal';

export type PersistentGoalStatus = 'active' | 'paused' | 'done' | 'cleared';

export interface PersistentGoalState {
  goal: string;
  status: PersistentGoalStatus;
  turnsUsed: number;
  maxTurns: number;
  createdAt: number;
  lastTurnAt: number;
  lastVerdict?: 'done' | 'continue' | 'skipped';
  lastReason?: string;
  pausedReason?: string;
  judgeModelRef?: string;
}

export function defaultMaxTurns(cfg: { maxTurns?: number } | undefined): number {
  const n = cfg?.maxTurns;
  if (typeof n === 'number' && Number.isFinite(n)) {
    return Math.max(1, Math.min(500, Math.floor(n)));
  }
  return 20;
}

function coerceStatus(s: unknown): PersistentGoalStatus | undefined {
  if (s === 'active' || s === 'paused' || s === 'done' || s === 'cleared') return s;
  return undefined;
}

export function readPersistentGoal(customData: Record<string, unknown> | undefined): PersistentGoalState | null {
  if (!customData || typeof customData !== 'object') return null;

  const raw = customData[PERSISTENT_GOAL_CUSTOM_KEY];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const goal = typeof o.goal === 'string' ? o.goal.trim() : '';
    if (!goal) return null;
    const status = coerceStatus(o.status) ?? 'active';
    const maxTurns =
      typeof o.maxTurns === 'number' && Number.isFinite(o.maxTurns)
        ? Math.max(1, Math.min(500, Math.floor(o.maxTurns)))
        : 20;
    const turnsUsed =
      typeof o.turnsUsed === 'number' && Number.isFinite(o.turnsUsed)
        ? Math.max(0, Math.floor(o.turnsUsed))
        : 0;
    const createdAt =
      typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : Date.now();
    const lastTurnAt =
      typeof o.lastTurnAt === 'number' && Number.isFinite(o.lastTurnAt) ? o.lastTurnAt : 0;
    const lastVerdict =
      o.lastVerdict === 'done' || o.lastVerdict === 'continue' || o.lastVerdict === 'skipped'
        ? o.lastVerdict
        : undefined;
    const lastReason = typeof o.lastReason === 'string' ? o.lastReason : undefined;
    const pausedReason = typeof o.pausedReason === 'string' ? o.pausedReason : undefined;
    const judgeModelRef = typeof o.judgeModelRef === 'string' ? o.judgeModelRef.trim() : undefined;
    return {
      goal,
      status,
      turnsUsed,
      maxTurns,
      createdAt,
      lastTurnAt,
      lastVerdict,
      lastReason,
      pausedReason,
      judgeModelRef: judgeModelRef || undefined,
    };
  }

  return null;
}

export function serializePersistentGoal(s: PersistentGoalState): Record<string, unknown> {
  return {
    goal: s.goal,
    status: s.status,
    turnsUsed: s.turnsUsed,
    maxTurns: s.maxTurns,
    createdAt: s.createdAt,
    lastTurnAt: s.lastTurnAt,
    ...(s.lastVerdict ? { lastVerdict: s.lastVerdict } : {}),
    ...(s.lastReason ? { lastReason: s.lastReason } : {}),
    ...(s.pausedReason ? { pausedReason: s.pausedReason } : {}),
    ...(s.judgeModelRef ? { judgeModelRef: s.judgeModelRef } : {}),
  };
}

export function mergeCustomDataPatch(
  existingCustom: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(existingCustom ?? {}), ...patch };
}
