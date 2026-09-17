export type PendingLibraryDraft = {
  id: string;
  kind: 'draft';
  title: string;
  subtitle?: string;
  updatedAt: number;
  route: '/inbox';
};

export function pendingLibraryDrafts(entries: Array<{
  id: string;
  kind: string;
  payload: unknown;
  createdAt: number;
}>, query: string): PendingLibraryDraft[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return entries.flatMap(entry => {
    if (entry.kind !== 'create_note' || !entry.payload || typeof entry.payload !== 'object') return [];
    const payload = entry.payload as { text?: unknown; markdown?: unknown };
    const text = typeof payload.text === 'string' ? payload.text : typeof payload.markdown === 'string' ? payload.markdown : '';
    if (!text.toLocaleLowerCase().includes(needle)) return [];
    return [{
      id: `draft:${entry.id}`,
      kind: 'draft' as const,
      title: text.split('\n')[0] || 'Untitled draft',
      subtitle: text,
      updatedAt: entry.createdAt,
      route: '/inbox' as const,
    }];
  });
}
