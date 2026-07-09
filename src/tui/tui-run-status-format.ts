import type { TuiState } from './tui-types.js';

const STALE_UPDATE_HINT_MS = 30_000;

export function formatRunDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function activeRunLabel(state: TuiState): string {
  if (state.runStatus.phase === 'aborting' || state.activityStatus === 'aborting') {
    return 'Stopping';
  }
  if (state.runStatus.phase === 'recovering' || state.activityStatus === 'recovering') {
    return 'Reconnecting output';
  }
  if (state.runStatus.phase === 'stalled' || state.activityStatus === 'stalled') {
    return 'Output stale';
  }
  const message = state.progressMessage?.trim();
  if (message) return message;
  if (state.runStatus.phase === 'tool') return 'Running tool';
  if (state.activityStatus === 'sending') return 'Sending';
  return 'Working';
}

export function formatActiveRunStatus(state: TuiState, nowMs = Date.now()): string | null {
  if (!state.activeRunId) return null;

  const startedAt = state.runStatus.startedAt ?? state.runStatus.lastActivityAt;
  const details: string[] = [];
  if (startedAt != null) {
    details.push(formatRunDuration(nowMs - startedAt));
  }

  const lastActivityAt = state.runStatus.lastActivityAt;
  const isStalePhase =
    state.runStatus.phase === 'stalled' ||
    state.runStatus.phase === 'recovering' ||
    state.activityStatus === 'stalled' ||
    state.activityStatus === 'recovering';
  if (
    lastActivityAt != null &&
    (isStalePhase || nowMs - lastActivityAt >= STALE_UPDATE_HINT_MS)
  ) {
    details.push(`last update ${formatRunDuration(nowMs - lastActivityAt)} ago`);
  }

  if (state.runStatus.phase !== 'aborting' && state.activityStatus !== 'aborting') {
    details.push('esc to interrupt');
  }

  const label = activeRunLabel(state);
  return details.length > 0 ? `${label} (${details.join(' • ')})` : label;
}
