export type WorkspaceSearchResult = {
  id: string;
  type: 'note' | 'session' | 'project' | 'task' | 'workflow_run' | 'file' | 'automation' | 'draft';
  title: string;
  snippet?: string;
  updatedAt?: number;
  score: number;
  state?: 'synced' | 'pending_sync' | 'failed_sync';
};

export function aggregateWorkspaceSearchResults(groups: WorkspaceSearchResult[][]): WorkspaceSearchResult[] {
  const byId = new Map<string, WorkspaceSearchResult>();
  for (const result of groups.flat()) {
    const current = byId.get(result.id);
    if (!current || result.score > current.score) byId.set(result.id, result);
  }
  return [...byId.values()].sort((a, b) =>
    b.score - a.score || (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
  );
}

export function pendingDraftSearchResults(entries: Array<{ id: string; kind: string; payload: unknown; createdAt: number }>, query: string): WorkspaceSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return entries.flatMap((entry) => {
    if (entry.kind !== 'create_note' || !entry.payload || typeof entry.payload !== 'object') return [];
    const payload = entry.payload as { text?: unknown; markdown?: unknown };
    const text = typeof payload.text === 'string' ? payload.text : typeof payload.markdown === 'string' ? payload.markdown : '';
    if (!text.toLowerCase().includes(needle)) return [];
    return [{ id: `draft:${entry.id}`, type: 'draft' as const, title: text.split('\n')[0] || 'Untitled draft', snippet: text, updatedAt: entry.createdAt, score: 2, state: 'pending_sync' as const }];
  });
}
