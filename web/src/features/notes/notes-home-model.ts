import type { NoteIndexEntry, NotesListQuery } from './notes-api';

export const NOTES_HOME_PAGE_SIZE = 12;

export function notesHomeQuery(params: URLSearchParams, search: string): NotesListQuery {
  const rawPage = Number(params.get('page') ?? 0);
  const page = Number.isSafeInteger(rawPage) && rawPage >= 0 ? rawPage : 0;
  const view = params.get('view');
  return {
    projectId: params.get('projectId') || undefined,
    unassigned: params.get('unassigned') === 'true' || view === 'unassigned' || undefined,
    pinned: view === 'favorites' ? true : undefined,
    agentEdited: view === 'agent' || undefined,
    status: view === 'archived' ? 'archived' : undefined,
    search: search.trim() || undefined,
    sortBy: 'updatedAt', sortOrder: 'desc',
    limit: NOTES_HOME_PAGE_SIZE, offset: page * NOTES_HOME_PAGE_SIZE,
  };
}

/** Index snippets often start with the title; don't repeat it as the preview. */
export function noteHomePreview(note: NoteIndexEntry): string {
  const snippet = note.snippet?.trim() ?? '';
  const title = note.title?.trim();
  return title && snippet.startsWith(title)
    ? snippet.slice(title.length).replace(/^[\s:：·—-]+/, '')
    : snippet;
}
