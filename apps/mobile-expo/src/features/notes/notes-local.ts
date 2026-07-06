/** Notes local-first editing — Markdown is canonical. */
import { createOfflineQueue, type OfflineQueue, type QueuedOperation } from '../../sync';
import { storage } from '../../storage/mmkv';
import { createBlankNote, updateNote, type Note, type NoteStatus } from '../../query/notes';
import {
  commitLocalNoteAttachmentUploads,
  deleteLocalNoteAttachments,
  prepareLocalNoteAttachmentUploadsForMarkdown,
  type PreparedLocalNoteAttachmentUpload,
} from './notes-local-attachments';

const LOCAL_NOTE_PREFIX = 'notes:local:item:';
const DRAFT_PROMOTION_PREFIX = 'notes:draft:remote:';
const EDIT_SYNC_DEBOUNCE_MS = 400;
const DRAFT_ID_PREFIX = 'draft:';

export interface LocalNoteSnapshot extends Note {
  remoteId?: string;
  localVersion: number;
  syncState: 'creating' | 'create_failed' | 'created' | 'synced' | 'pending' | 'failed';
}

function parseJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function localNoteKey(noteId: string): string {
  return `${LOCAL_NOTE_PREFIX}${noteId}`;
}

function draftPromotionKey(draftId: string): string {
  return `${DRAFT_PROMOTION_PREFIX}${draftId}`;
}

function generateDraftId(): `draft:${string}` {
  return `${DRAFT_ID_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isDraftNoteId(noteId: string | undefined): noteId is `draft:${string}` {
  return Boolean(noteId?.startsWith(DRAFT_ID_PREFIX));
}

export function readLocalNote(noteId: string): LocalNoteSnapshot | null {
  return parseJson<LocalNoteSnapshot>(storage.getString(localNoteKey(noteId)));
}

export function writeLocalNote(note: LocalNoteSnapshot): void {
  storage.set(localNoteKey(note.id), JSON.stringify(note));
}

export function createLocalDraftNote(): LocalNoteSnapshot {
  const now = Date.now();
  const draft: LocalNoteSnapshot = {
    id: generateDraftId(),
    kind: 'thought',
    status: 'processed',
    markdown: '',
    text: '',
    createdAt: now,
    updatedAt: now,
    capturedVia: { channel: 'app' },
    localVersion: 0,
    syncState: 'creating',
  };
  writeLocalNote(draft);
  return draft;
}

export function readDraftPromotion(draftId: string): string | null {
  return storage.getString(draftPromotionKey(draftId)) ?? null;
}

function writeDraftPromotion(draftId: string, remoteId: string): void {
  storage.set(draftPromotionKey(draftId), remoteId);
}

export function markLocalDraftCreateFailed(draftId: string): void {
  const draft = readLocalNote(draftId);
  if (!draft || !isDraftNoteId(draft.id) || draft.remoteId) return;
  writeLocalNote({ ...draft, syncState: 'create_failed' });
}

export function retryLocalDraftCreate(draftId: string): LocalNoteSnapshot | null {
  const draft = readLocalNote(draftId);
  if (!draft || !isDraftNoteId(draft.id) || draft.remoteId) return null;
  const next = { ...draft, syncState: 'creating' as const };
  writeLocalNote(next);
  return next;
}

function deleteLocalNoteSnapshot(noteId: string): void {
  storage.delete(localNoteKey(noteId));
}

interface EditSyncPayload {
  noteId: string;
  markdown: string;
  localVersion: number;
  localAttachmentNoteId?: string;
  title?: string;
  clearTitle?: boolean;
  tags?: string[];
  status?: NoteStatus;
}

let editSyncTimer: ReturnType<typeof setTimeout> | null = null;
let editSyncFlushInFlight: Promise<number> | null = null;

export function scheduleNoteEditSync(): void {
  if (editSyncTimer) clearTimeout(editSyncTimer);
  editSyncTimer = setTimeout(() => {
    editSyncTimer = null;
    if (editSyncFlushInFlight) return;
    editSyncFlushInFlight = flushPendingNoteOperations()
      .catch((error) => {
        if (__DEV__) {
          console.warn('[notes-local] background sync failed', error);
        }
        return 0;
      })
      .finally(() => {
        editSyncFlushInFlight = null;
      });
  }, EDIT_SYNC_DEBOUNCE_MS);
}

function enqueueNoteEdit(payload: EditSyncPayload): void {
  for (const op of editQueue.pending()) {
    if (op.payload.noteId === payload.noteId) {
      editQueue.remove(op.id);
    }
  }
  editQueue.enqueue(payload);
  scheduleNoteEditSync();
}

const editQueue: OfflineQueue<EditSyncPayload> = createOfflineQueue<EditSyncPayload>({
  namespace: 'notes:edit',
  processor: async (operation: QueuedOperation<EditSyncPayload>) => {
    const { noteId, markdown, localVersion, localAttachmentNoteId, title, clearTitle, tags, status } = operation.payload;
    const metadataPatch = noteMetadataPatch({ title, clearTitle, tags, status });
    const preparedAttachments = await prepareLocalNoteAttachmentUploadsForMarkdown(noteId, markdown, {
      localNoteId: localAttachmentNoteId,
    });
    const syncMarkdown = preparedAttachments.markdown;
    let updatedNote: Note;
    try {
      updatedNote = await updateNote(noteId, { markdown: syncMarkdown, ...metadataPatch });
      assertUploadedAttachmentsCommitted(updatedNote, preparedAttachments.uploads);
    } catch (error) {
      if (isNoteNotFoundError(error)) {
        discardLocalNoteState(noteId);
        return;
      }
      throw error;
    }
    commitLocalNoteAttachmentUploads(preparedAttachments.uploads);
    const snapshot = readLocalNote(noteId);
    if (snapshot && snapshot.localVersion === localVersion) {
      writeLocalNote({
        ...snapshot,
        ...updatedNote,
        title: clearTitle ? undefined : title ?? updatedNote.title ?? snapshot.title,
        tags: tags ?? updatedNote.tags ?? snapshot.tags,
        status: status ?? updatedNote.status ?? snapshot.status,
        markdown: syncMarkdown,
        text: syncMarkdown,
        syncState: 'synced',
      });
    }
  },
  maxRetries: 8,
});

export function discardPendingNoteEdits(noteId: string): void {
  for (const op of editQueue.pending()) {
    if (op.payload.noteId === noteId) {
      editQueue.remove(op.id);
    }
  }
  for (const op of editQueue.deadLetters()) {
    if (op.payload.noteId === noteId) {
      editQueue.removeDeadLetter(op.id);
    }
  }
}

export function discardLocalNoteState(noteId: string): void {
  deleteLocalNoteSnapshot(noteId);
  deleteLocalNoteAttachments(noteId);
  discardPendingNoteEdits(noteId);
}

export const deleteLocalNote = discardLocalNoteState;

export function saveLocalMarkdownNoteEdit(
  note: Note,
  input: {
    markdown: string;
    title?: string;
    tags?: string[];
    status?: NoteStatus;
    localAttachmentNoteId?: string;
  },
): LocalNoteSnapshot {
  const previous = readLocalNote(note.id);
  const nextTitle = input.title?.trim() || undefined;
  const nextTags = input.tags ?? previous?.tags ?? note.tags;
  const nextStatus = input.status ?? previous?.status ?? note.status;
  const previousMarkdown = previous?.markdown ?? note.markdown ?? note.text ?? '';
  const previousTitle = previous?.title ?? note.title;
  const titleProvided = Object.prototype.hasOwnProperty.call(input, 'title');
  const clearTitle = titleProvided && nextTitle === undefined && previousTitle !== undefined;

  if (
    previous?.syncState === 'synced' &&
    input.markdown === previousMarkdown &&
    nextTitle === previousTitle &&
    tagsEqual(nextTags, previous.tags ?? note.tags) &&
    nextStatus === (previous.status ?? note.status)
  ) {
    return previous;
  }

  const localVersion = (previous?.localVersion ?? note.localVersion ?? 0) + 1;
  const snapshot: LocalNoteSnapshot = {
    ...note,
    ...previous,
    title: nextTitle,
    tags: nextTags,
    status: nextStatus,
    markdown: input.markdown,
    text: input.markdown,
    updatedAt: Date.now(),
    localVersion,
    remoteVersion: previous?.remoteVersion ?? note.remoteVersion,
    syncState: isDraftNoteId(note.id)
      ? previous?.syncState === 'create_failed'
        ? 'create_failed'
        : 'creating'
      : 'pending',
  };
  writeLocalNote(snapshot);

  if (isDraftNoteId(note.id)) {
    return snapshot;
  }

  enqueueNoteEdit({
    noteId: note.id,
    markdown: input.markdown,
    localAttachmentNoteId: input.localAttachmentNoteId,
    title: nextTitle,
    clearTitle,
    tags: input.tags,
    status: input.status,
    localVersion,
  });

  return snapshot;
}

export async function promoteLocalDraftNote(
  draftId: string,
  input: { markdown: string; title?: string; tags?: string[]; status?: NoteStatus },
): Promise<string> {
  const existingRemoteId = readDraftPromotion(draftId);
  if (existingRemoteId) return existingRemoteId;

  const draft = readLocalNote(draftId);
  if (!draft || !isDraftNoteId(draft.id)) {
    throw new Error('Draft note not found');
  }

  const result = await createBlankNote();
  const now = Date.now();
  const remoteNote: Note = {
    id: result.note.id,
    title: result.note.title,
    kind: result.note.kind ?? 'thought',
    status: result.note.status ?? 'processed',
    markdown: result.note.markdown,
    text: result.note.text,
    attachments: result.note.attachments,
    createdAt: result.note.createdAt ?? now,
    updatedAt: result.note.updatedAt ?? now,
    capturedVia: result.note.capturedVia ?? { channel: 'app' },
    tags: result.note.tags,
    pinned: result.note.pinned,
    localVersion: result.note.localVersion,
    remoteVersion: result.note.remoteVersion,
    groupId: result.note.groupId,
    lastOpenedAt: result.note.lastOpenedAt,
    taskMeta: result.note.taskMeta,
  };
  const markdown = input.markdown;
  const title = input.title?.trim() || undefined;
  const tags = input.tags ?? draft.tags;
  const status = input.status ?? draft.status;
  const hasLocalContent = Boolean(markdown.trim() || title || (tags?.length ?? 0) > 0 || status !== remoteNote.status);

  writeDraftPromotion(draftId, remoteNote.id);
  writeLocalNote({
    ...draft,
    remoteId: remoteNote.id,
    markdown,
    text: markdown,
    title,
    tags,
    status,
    updatedAt: Date.now(),
    syncState: 'created',
  });

  if (hasLocalContent) {
    saveLocalMarkdownNoteEdit(remoteNote, { markdown, title, tags, status, localAttachmentNoteId: draftId });
  } else {
    writeLocalNote({
      ...remoteNote,
      localVersion: remoteNote.localVersion ?? 0,
      syncState: 'synced',
    });
  }

  return remoteNote.id;
}

export async function flushPendingNoteOperations(): Promise<number> {
  const flushed = await editQueue.flush();

  const remaining = editQueue.pending();
  for (const op of remaining) {
    if (op.retryCount > 0) {
      const snapshot = readLocalNote(op.payload.noteId);
      if (snapshot && snapshot.syncState !== 'failed') {
        writeLocalNote({ ...snapshot, syncState: 'failed' });
      }
    }
  }

  return flushed;
}

export function getPendingEditCount(): number {
  return editQueue.pendingCount();
}

function noteMetadataPatch(input: { title?: string; clearTitle?: boolean; tags?: string[]; status?: NoteStatus }): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.clearTitle) patch.title = null;
  else if (input.title !== undefined) patch.title = input.title;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.status !== undefined) patch.status = input.status;
  return patch;
}

function tagsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every((tag, index) => tag === right[index]);
}

function isNoteNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const candidate = error as Error & { status?: number; code?: string };
  return candidate.status === 404 || candidate.code === 'note_not_found';
}

function assertUploadedAttachmentsCommitted(
  updatedNote: Note,
  uploads: PreparedLocalNoteAttachmentUpload[],
): void {
  if (!uploads.length) return;
  const remoteMarkdown = updatedNote.markdown ?? updatedNote.text ?? '';
  const attachmentIds = updatedNote.attachments
    ? new Set(updatedNote.attachments.map((attachment) => attachment.id))
    : null;
  const missing = uploads.filter((upload) => (
    !remoteMarkdown.includes(upload.canonicalRef)
    || (attachmentIds ? !attachmentIds.has(upload.attachment.id) : false)
  ));
  if (missing.length) {
    throw new Error('Note attachment sync incomplete');
  }
}
