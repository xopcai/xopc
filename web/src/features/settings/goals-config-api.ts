import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type GoalsConfigState = {
  maxTurns: number;
  judgeModelRef: string;
  checklistMode: boolean;
  maxConsecutiveParseFailures: number;
  judgeTimeoutSec: number;
  checklistHistoryChars: number;
};

export const DEFAULT_GOALS_CONFIG: GoalsConfigState = {
  maxTurns: 20,
  judgeModelRef: '',
  checklistMode: true,
  maxConsecutiveParseFailures: 3,
  judgeTimeoutSec: 60,
  checklistHistoryChars: 24_000,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function normalizeGoalsConfigFromConfig(config: unknown): GoalsConfigState {
  const c = isRecord(config) ? config : {};
  const goals = isRecord(c.goals) ? c.goals : {};
  return {
    maxTurns:
      typeof goals.maxTurns === 'number' && Number.isFinite(goals.maxTurns)
        ? Math.max(1, Math.min(500, Math.floor(goals.maxTurns)))
        : DEFAULT_GOALS_CONFIG.maxTurns,
    judgeModelRef: typeof goals.judgeModelRef === 'string' ? goals.judgeModelRef : '',
    checklistMode: goals.checklistMode !== false,
    maxConsecutiveParseFailures:
      typeof goals.maxConsecutiveParseFailures === 'number' &&
      Number.isFinite(goals.maxConsecutiveParseFailures)
        ? Math.max(1, Math.min(20, Math.floor(goals.maxConsecutiveParseFailures)))
        : DEFAULT_GOALS_CONFIG.maxConsecutiveParseFailures,
    judgeTimeoutSec:
      typeof goals.judgeTimeoutMs === 'number' && Number.isFinite(goals.judgeTimeoutMs)
        ? Math.max(5, Math.min(120, Math.round(goals.judgeTimeoutMs / 1000)))
        : DEFAULT_GOALS_CONFIG.judgeTimeoutSec,
    checklistHistoryChars:
      typeof goals.checklistHistoryChars === 'number' && Number.isFinite(goals.checklistHistoryChars)
        ? Math.max(0, Math.min(100_000, Math.floor(goals.checklistHistoryChars)))
        : DEFAULT_GOALS_CONFIG.checklistHistoryChars,
  };
}

export async function patchGoalsConfig(state: GoalsConfigState): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      goals: {
        maxTurns: state.maxTurns,
        ...(state.judgeModelRef.trim() ? { judgeModelRef: state.judgeModelRef.trim() } : {}),
        checklistMode: state.checklistMode,
        maxConsecutiveParseFailures: state.maxConsecutiveParseFailures,
        judgeTimeoutMs: state.judgeTimeoutSec * 1000,
        checklistHistoryChars: state.checklistHistoryChars,
      },
    }),
  });
  void revalidateGatewayConfig();
}
