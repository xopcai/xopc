import type { TaskResultDelivery } from './task-result-delivery.js';

/** Stable selection wire; authorization is always checked by the receiving conversation. */
export function resultReferenceId(resultId: string, sourceId = 'body'): string {
  return `result:${encodeURIComponent(resultId)}:${encodeURIComponent(sourceId)}`;
}
export function parseResultReferenceId(value: string): { resultId: string; sourceId: string } | null {
  const match = /^result:([^:]+):([^:]+)$/.exec(value);
  if (!match) return null;
  try { return { resultId: decodeURIComponent(match[1]!), sourceId: decodeURIComponent(match[2]!) }; } catch { return null; }
}
export function resultReferenceVersion(delivery: TaskResultDelivery): string {
  return `${delivery.taskRunId}:${delivery.assignmentEpoch}:${delivery.outcome.outcomeId}`;
}
