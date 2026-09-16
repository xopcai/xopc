import { fetchFileChildren, fetchFileSpaceForContext, searchFiles } from './files';
import { fetchNotes } from './notes';
import { fetchTasks } from './tasks';

export type ReferenceKind = 'note' | 'task' | 'file';
export type ComposerReferenceItem = {
  kind: ReferenceKind;
  id: string;
  title: string;
  description: string;
  version: string;
  relativePath?: string;
  directory?: boolean;
  mimeType?: string;
  size?: number;
};

export async function fetchComposerReferences(kind: ReferenceKind, conversationId: string, search: string, path: string): Promise<ComposerReferenceItem[]> {
  if (kind === 'note') {
    const result = await fetchNotes({ search: search || undefined, limit: 50, sortBy: 'updatedAt', sortOrder: 'desc' });
    return result.items.filter(note => note.status !== 'trashed').map(note => ({
      kind, id: note.id, title: note.title || note.snippet || '', description: note.snippet || '', version: String(note.updatedAt),
    }));
  }
  if (kind === 'task') {
    return (await fetchTasks(search)).map(({ task }) => ({
      kind, id: task.id, title: task.title, description: task.body || '', version: String(task.version),
    }));
  }
  const space = await fetchFileSpaceForContext('session', conversationId);
  const files = search ? await searchFiles(search, space.id) : await fetchFileChildren(space.id, path);
  return files.map(file => ({
    kind, id: file.id, title: file.name, description: file.relativePath, version: file.revision,
    relativePath: file.relativePath, directory: file.kind === 'directory', mimeType: file.mimeType, size: file.size,
  }));
}
