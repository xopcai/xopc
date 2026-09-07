import { join } from 'node:path';

import { resolveStateDir } from '../config/paths-state.js';

export function resolveNotesDir(): string {
  return join(resolveStateDir(), 'notes');
}

export function resolveNoteMediaDir(noteId: string): string {
  return join(resolveNotesDir(), 'media', noteId);
}
