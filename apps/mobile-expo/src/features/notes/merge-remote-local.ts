import type { Note } from '../../query/notes';
import type { LocalNoteSnapshot } from './notes-local';

/** Prefer local snapshot when it has unsynced or newer edits. */
export function mergeRemoteWithLocal(
  remoteNote?: Note,
  localNote?: LocalNoteSnapshot | null,
): Note | LocalNoteSnapshot | undefined {
  if (!remoteNote) return localNote ?? undefined;
  if (!localNote) return remoteNote;

  if (localNote.syncState === 'pending' || localNote.syncState === 'failed') {
    return localNote;
  }

  if ((localNote.localVersion ?? 0) > (remoteNote.localVersion ?? 0)) {
    return localNote;
  }

  if (localNote.updatedAt >= remoteNote.updatedAt) {
    return localNote;
  }

  return remoteNote;
}
