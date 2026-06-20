export { NotesStore } from './store.js';
export { NotesService } from './service.js';
export { buildNoteAgentContext, buildNoteAgentContextArtifact, getCachedNoteAgentContextArtifact } from './agent-context.js';
export type { NoteAgentContextArtifact, NoteAgentAttachmentContext } from './agent-context.js';
export { resolveNotesDir, resolveNotesIndexPath, resolveNoteItemPath, resolveNoteMediaDir, resolveNoteHistoryDir } from './paths.js';
export type {
  Note,
  NoteKind,
  NoteStatus,
  NoteAttachment,
  NoteAiMeta,
  NoteAiDeepMeta,
  NoteIndexEntry,
  NoteSnapshot,
  NoteSnapshotEntry,
  NotesIndexFile,
  NotesListQuery,
  CaptureSource,
  CaptureChannel,
  CreateNoteParams,
  SnapshotTrigger,
  NoteTaskMeta,
  NoteGroup,
} from './types.js';
