import { searchFiles } from './files';
import { fetchNotes } from './notes';

export type LibrarySearchHit = {
  id: string;
  kind: 'file' | 'note';
  title: string;
  subtitle?: string;
  updatedAt: number;
  route: string;
};

export async function searchMobileLibrary(query: string): Promise<LibrarySearchHit[]> {
  const value = query.trim();
  if (!value) return [];
  const [notes, files] = await Promise.all([
    fetchNotes({ search: value, limit: 50, sortBy: 'updatedAt', sortOrder: 'desc' }),
    searchFiles(value),
  ]);
  return [
    ...notes.items.map(note => ({
      id: `note:${note.id}`,
      kind: 'note' as const,
      title: note.title || note.snippet || '',
      subtitle: note.snippet,
      updatedAt: note.updatedAt,
      route: `/items/${encodeURIComponent(note.id)}`,
    })),
    ...files.filter(file => file.kind === 'file').map(file => ({
      id: `file:${file.id}`,
      kind: 'file' as const,
      title: file.name,
      subtitle: file.relativePath,
      updatedAt: file.modifiedAt,
      route: `/files/open/${encodeURIComponent(file.id)}`,
    })),
  ].sort((left, right) => right.updatedAt - left.updatedAt);
}
