import type { ActivityStatus, TuiEventSource, TuiRunPhase, TuiState } from './tui-types.js';

const STALE_WATCH_ACTIVITY = new Set<ActivityStatus>(['sending', 'waiting', 'streaming', 'running']);

export function markRunEvent(
  state: TuiState,
  phase: TuiRunPhase,
  runId: string | null,
  event: string,
  source: TuiEventSource,
  nowMs = Date.now(),
): void {
  const directStreamRunId =
    (source === 'agent-response' || source === 'agent-resume') && runId
      ? runId
      : state.runStatus.directStreamRunId;
  state.runStatus = {
    ...state.runStatus,
    phase,
    runId,
    directStreamRunId,
    source,
    lastEvent: event,
    lastActivityAt: nowMs,
    stalledAt: null,
  };
}

export function markRunSending(state: TuiState, nowMs = Date.now()): void {
  state.runStatus = {
    ...state.runStatus,
    phase: 'sending',
    runId: null,
    directStreamRunId: null,
    lastCompletedRunId: null,
    source: 'unknown',
    lastEvent: 'send',
    lastActivityAt: nowMs,
    stalledAt: null,
  };
}

export function markRunAborting(state: TuiState, runId: string, nowMs = Date.now()): void {
  state.runStatus = {
    ...state.runStatus,
    phase: 'aborting',
    runId,
    lastEvent: 'abort',
    lastActivityAt: nowMs,
  };
}

export function markRunIdleAfterAbort(state: TuiState, nowMs = Date.now()): void {
  state.runStatus = {
    ...state.runStatus,
    phase: 'idle',
    runId: null,
    lastEvent: 'abort',
    lastActivityAt: nowMs,
    stalledAt: null,
  };
}

export function markRunIdleAfterCompletion(
  state: TuiState,
  completedRunId: string,
  event: string,
  source: TuiEventSource,
  nowMs = Date.now(),
): void {
  markRunEvent(state, 'idle', null, event, source, nowMs);
  state.runStatus.lastCompletedRunId = completedRunId;
}

export function resetRunStatus(state: TuiState): void {
  state.runStatus = {
    ...state.runStatus,
    phase: 'idle',
    runId: null,
    directStreamRunId: null,
    lastCompletedRunId: null,
    lastEvent: null,
    stalledAt: null,
  };
}

export function isActiveRunStreamStale(
  state: TuiState,
  nowMs: number,
  staleAfterMs: number,
): boolean {
  if (!state.activeRunId) return false;
  if (!STALE_WATCH_ACTIVITY.has(state.activityStatus)) return false;
  if (state.runStatus.phase === 'stalled' || state.runStatus.phase === 'recovering') return false;
  if (state.runStatus.phase === 'aborting') return false;
  const lastActivityAt = state.runStatus.lastActivityAt ?? nowMs;
  return nowMs - lastActivityAt >= staleAfterMs;
}

export function markActiveRunStalled(state: TuiState, nowMs: number): boolean {
  if (!state.activeRunId) return false;
  if (state.runStatus.phase === 'stalled' || state.runStatus.phase === 'recovering') {
    return false;
  }
  state.runStatus = {
    ...state.runStatus,
    phase: 'stalled',
    runId: state.activeRunId,
    stalledAt: nowMs,
  };
  return true;
}

export function markRunRecovering(state: TuiState, nowMs: number): void {
  state.runStatus = {
    ...state.runStatus,
    phase: 'recovering',
    runId: state.activeRunId,
    recoveredAt: nowMs,
  };
}

export function markRunRecoveryComplete(state: TuiState, nowMs: number): void {
  if (state.activeRunId) {
    state.runStatus = {
      ...state.runStatus,
      phase: 'stalled',
      runId: state.activeRunId,
      recoveredAt: nowMs,
    };
    return;
  }
  state.runStatus = {
    ...state.runStatus,
    phase: 'idle',
    runId: null,
    recoveredAt: nowMs,
  };
}
