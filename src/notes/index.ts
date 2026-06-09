export { NotesStore } from './store.js';
export { NotesService } from './service.js';
export { resolveNotesDir, resolveNotesIndexPath, resolveNoteItemPath, resolveNoteMediaDir } from './paths.js';
export type {
  Note,
  NoteKind,
  NoteStatus,
  NoteAttachment,
  NoteAiMeta,
  NoteAiDeepMeta,
  NoteIndexEntry,
  NotesIndexFile,
  NotesListQuery,
  CaptureSource,
  CaptureChannel,
  CreateNoteParams,
} from './types.js';
