const listeners = new Map<string, Set<() => void>>();
export function notifyAutomationRun(runId: string): void {
  for (const listener of listeners.get(runId) ?? []) { try { listener(); } catch { /* Subscribers own their errors. */ } }
}
export function onAutomationRunChange(runId: string, listener: () => void): () => void {
  const group = listeners.get(runId) ?? new Set(); group.add(listener); listeners.set(runId, group);
  return () => { group.delete(listener); if (!group.size) listeners.delete(runId); };
}
