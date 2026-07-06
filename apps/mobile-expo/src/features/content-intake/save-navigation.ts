import type { ContentIntakeSaveResult } from './use-content-intake-actions';

export function savedContentRoute(result: ContentIntakeSaveResult): string {
  if (result.status === 'saved' && result.noteId) return `/items/${encodeURIComponent(result.noteId)}`;
  return '/';
}
