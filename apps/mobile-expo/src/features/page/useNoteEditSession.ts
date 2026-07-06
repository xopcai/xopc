import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';

import { queryKeys } from '../../query/keys';
import { noteToIndexEntry, upsertNoteInListCaches } from '../../query/note-list-cache';
import { invalidateNoteLists } from '../../query/workspace-sync';
import {
  fetchNote,
  recordNoteOpen,
  type ApiError,
  type Note,
  type NoteAttachment,
} from '../../query/notes';
import {
  discardLocalNoteState,
  flushPendingNoteOperations,
  isDraftNoteId,
  markLocalDraftCreateFailed,
  promoteLocalDraftNote,
  readLocalNote,
  retryLocalDraftCreate,
  saveLocalMarkdownNoteEdit,
} from '../notes/notes-local';

const SAVE_DEBOUNCE_MS = 600;

export type SaveState = 'saved' | 'dirty' | 'saving' | 'pending' | 'failed';

export type AttachmentDisplaySeed = {
  version: number;
  noteId: string;
  markdown: string;
  attachments: NoteAttachment[] | undefined;
} | null;

type UseNoteEditSessionArgs = {
  id: string | undefined;
  queryClient: QueryClient;
  ensureNoteTags: (tags: string[]) => void;
  setSnackMsg: Dispatch<SetStateAction<string>>;
  messages: {
    missing: string;
    savedOffline: string;
    untitledNote: string;
  };
  onMissingNote: () => void;
  onDraftPromoted?: (remoteId: string) => void;
};

function deriveTitle(note: Note | undefined, fallback: string): string {
  const explicit = note?.title?.trim();
  if (explicit) return explicit;
  const plain = note?.markdown?.replace(/[#*_`>\-[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  return plain ? Array.from(plain).slice(0, 18).join('') : fallback;
}

function tagsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every((tag, index) => tag === right[index]);
}

export function useNoteEditSession({
  id,
  queryClient,
  ensureNoteTags,
  setSnackMsg,
  messages,
  onMissingNote,
  onDraftPromoted,
}: UseNoteEditSessionArgs) {
  const [markdown, setMarkdown] = useState('');
  const [editorMarkdown, setEditorMarkdown] = useState('');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[] | undefined>(undefined);
  const [noteStatus, setNoteStatus] = useState<Note['status']>('processed');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [attachmentDisplaySeed, setAttachmentDisplaySeed] = useState<AttachmentDisplaySeed>(null);

  const markdownRef = useRef(markdown);
  const titleRef = useRef(title);
  const tagsRef = useRef(tags);
  const statusRef = useRef(noteStatus);
  const serverMarkdownRef = useRef('');
  const serverTitleRef = useRef<string | undefined>(undefined);
  const serverTagsRef = useRef<string[] | undefined>(undefined);
  const serverStatusRef = useRef<Note['status'] | undefined>(undefined);
  const dirtyRef = useRef(false);
  const seededNoteIdRef = useRef<string | null>(null);
  const openedNoteIdRef = useRef<string | null>(null);
  const handledMissingNoteIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachmentDisplayVersionRef = useRef(0);
  const draftPromotionRef = useRef<string | null>(null);
  const isDraft = isDraftNoteId(id);

  markdownRef.current = markdown;
  titleRef.current = title;
  tagsRef.current = tags;
  statusRef.current = noteStatus;

  const noteQuery = useQuery({
    queryKey: id ? queryKeys.note(id) : ['note', 'missing'],
    queryFn: () => fetchNote(id!),
    enabled: Boolean(id && !isDraft),
    retry: 1,
  });
  const [draftNote, setDraftNote] = useState(() => (isDraft && id ? readLocalNote(id) : null));
  const note = (isDraft ? draftNote : noteQuery.data) ?? undefined;

  useEffect(() => {
    draftPromotionRef.current = null;
    if (!id || !isDraftNoteId(id)) {
      setDraftNote(null);
      return;
    }
    const draft = readLocalNote(id);
    setDraftNote(draft);
    if (!draft) {
      setSnackMsg(messages.missing);
      onMissingNote();
    }
  }, [id, messages.missing, onMissingNote, setSnackMsg]);

  useEffect(() => {
    if (!id || isDraft || !noteQuery.isError || handledMissingNoteIdRef.current === id) return;
    const error = noteQuery.error as Partial<ApiError>;
    if (error.status !== 404) return;
    handledMissingNoteIdRef.current = id;
    discardLocalNoteState(id);
    queryClient.removeQueries({ queryKey: queryKeys.note(id) });
    void invalidateNoteLists(queryClient);
    setSnackMsg(messages.missing);
    onMissingNote();
  }, [id, isDraft, messages.missing, noteQuery.error, noteQuery.isError, onMissingNote, queryClient, setSnackMsg]);

  useEffect(() => {
    if (!note) return;
    const localNote = readLocalNote(note.id);
    const shouldUseLocal = localNote?.syncState === 'pending'
      || localNote?.syncState === 'failed'
      || (localNote?.localVersion ?? 0) > (note.localVersion ?? 0);
    const displayNote = shouldUseLocal && localNote ? localNote : note;
    const nextMarkdown = displayNote.markdown ?? '';
    const nextTitle = displayNote.title;
    const nextTags = displayNote.tags;
    const nextStatus = displayNote.status;

    serverMarkdownRef.current = nextMarkdown;
    serverTitleRef.current = nextTitle;
    serverTagsRef.current = nextTags;
    serverStatusRef.current = nextStatus;

    const isNewNote = seededNoteIdRef.current !== note.id;
    if (isNewNote || !dirtyRef.current) {
      seededNoteIdRef.current = note.id;
      dirtyRef.current = false;
      setMarkdown(nextMarkdown);
      setEditorMarkdown(nextMarkdown);
      setTitle(nextTitle ?? deriveTitle(note, messages.untitledNote));
      setTags(nextTags);
      ensureNoteTags(nextTags ?? []);
      setNoteStatus(nextStatus);
      setSaveState(shouldUseLocal && localNote?.syncState === 'failed' ? 'failed' : shouldUseLocal && localNote?.syncState === 'pending' ? 'pending' : 'saved');
      attachmentDisplayVersionRef.current += 1;
      setAttachmentDisplaySeed({
        version: attachmentDisplayVersionRef.current,
        noteId: note.id,
        markdown: nextMarkdown,
        attachments: displayNote.attachments,
      });
    }

    if (!isDraft) {
      upsertNoteInListCaches(queryClient, noteToIndexEntry(note));
    }
  }, [
    ensureNoteTags,
    isDraft,
    messages.untitledNote,
    note,
    note?.id,
    note?.localVersion,
    note?.markdown,
    note?.status,
    note?.tags,
    note?.title,
    queryClient,
  ]);

  useEffect(() => {
    if (!id || isDraft || openedNoteIdRef.current === id) return;
    openedNoteIdRef.current = id;
    void recordNoteOpen(id).catch(() => undefined);
  }, [id, isDraft]);

  useEffect(() => {
    if (
      !id
      || !isDraft
      || !draftNote
      || draftNote.remoteId
      || draftNote.syncState !== 'creating'
      || draftPromotionRef.current === id
    ) return;
    draftPromotionRef.current = id;
    void (async () => {
      try {
        const remoteId = await promoteLocalDraftNote(id, {
          markdown: markdownRef.current,
          title: titleRef.current.trim() || undefined,
          tags: tagsRef.current,
          status: statusRef.current,
        });
        onDraftPromoted?.(remoteId);
      } catch {
        markLocalDraftCreateFailed(id);
        setDraftNote(readLocalNote(id));
        setSaveState('failed');
        setSnackMsg(messages.savedOffline);
        draftPromotionRef.current = null;
      }
    })();
  }, [draftNote, id, isDraft, messages.savedOffline, onDraftPromoted, setSnackMsg]);

  const applySyncedLocalSnapshot = useCallback((snapshot: ReturnType<typeof readLocalNote>) => {
    if (!id || !snapshot || snapshot.syncState !== 'synced') return;
    serverMarkdownRef.current = snapshot.markdown ?? '';
    serverTitleRef.current = snapshot.title;
    serverTagsRef.current = snapshot.tags;
    serverStatusRef.current = snapshot.status;
    queryClient.setQueryData(queryKeys.note(id), snapshot);
    upsertNoteInListCaches(queryClient, noteToIndexEntry(snapshot));
    if (!dirtyRef.current) {
      setMarkdown(snapshot.markdown ?? '');
      setEditorMarkdown(snapshot.markdown ?? '');
      setTitle(snapshot.title ?? deriveTitle(snapshot, messages.untitledNote));
      setTags(snapshot.tags);
      setNoteStatus(snapshot.status);
      attachmentDisplayVersionRef.current += 1;
      setAttachmentDisplaySeed({
        version: attachmentDisplayVersionRef.current,
        noteId: snapshot.id,
        markdown: snapshot.markdown ?? '',
        attachments: snapshot.attachments,
      });
    }
  }, [id, messages.untitledNote, queryClient]);

  const flushQueuedNoteOperations = useCallback(async () => {
    const flushed = await flushPendingNoteOperations();
    if (id) applySyncedLocalSnapshot(readLocalNote(id));
    return flushed;
  }, [applySyncedLocalSnapshot, id]);

  const saveStateAfterFlush = useCallback((): SaveState => {
    if (!id) return 'saved';
    const localSnapshot = readLocalNote(id);
    if (localSnapshot?.syncState === 'failed') return 'failed';
    if (localSnapshot?.syncState === 'pending') return 'pending';
    return 'saved';
  }, [id]);

  const flushSave = useCallback(async () => {
    if (!id || !note) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const nextMarkdown = markdownRef.current;
    const nextTitle = titleRef.current.trim() || undefined;
    const nextTags = tagsRef.current;
    const nextStatus = statusRef.current;

    if (
      nextMarkdown === serverMarkdownRef.current
      && nextTitle === serverTitleRef.current
      && tagsEqual(nextTags, serverTagsRef.current)
      && nextStatus === serverStatusRef.current
    ) {
      dirtyRef.current = false;
      const localSnapshot = readLocalNote(id);
      if (isDraft && localSnapshot?.syncState === 'create_failed') {
        const retrySnapshot = retryLocalDraftCreate(id);
        if (retrySnapshot) {
          setDraftNote(retrySnapshot);
          setSaveState('pending');
        }
        return;
      }
      if (isDraft && localSnapshot?.syncState === 'creating') {
        setSaveState('pending');
        return;
      }
      if (localSnapshot?.syncState === 'failed') {
        setSaveState('pending');
        try {
          await flushQueuedNoteOperations();
          setSaveState(saveStateAfterFlush());
        } catch {
          setSaveState('failed');
          setSnackMsg(messages.savedOffline);
        }
        return;
      }
      if (localSnapshot?.syncState === 'pending') {
        setSaveState('pending');
        try {
          await flushQueuedNoteOperations();
          setSaveState(saveStateAfterFlush());
        } catch {
          setSaveState('failed');
          setSnackMsg(messages.savedOffline);
        }
        return;
      }
      setSaveState('saved');
      return;
    }

    setSaveState('saving');
    const snapshot = saveLocalMarkdownNoteEdit(note, {
      markdown: nextMarkdown,
      title: nextTitle,
      tags: nextTags,
      status: nextStatus,
    });
    serverMarkdownRef.current = nextMarkdown;
    serverTitleRef.current = snapshot.title;
    serverTagsRef.current = snapshot.tags;
    serverStatusRef.current = snapshot.status;
    dirtyRef.current = false;
    const nextSaveState = isDraft && snapshot.syncState === 'create_failed' ? 'failed' : 'pending';
    setSaveState(nextSaveState);
    if (isDraft) {
      setDraftNote(snapshot);
    } else {
      queryClient.setQueryData(queryKeys.note(id), snapshot);
      upsertNoteInListCaches(queryClient, noteToIndexEntry(snapshot));
      void invalidateNoteLists(queryClient);
    }
    if (isDraft) return;
    try {
      await flushQueuedNoteOperations();
      setSaveState(saveStateAfterFlush());
    } catch {
      setSaveState('failed');
      setSnackMsg(messages.savedOffline);
    }
  }, [flushQueuedNoteOperations, id, isDraft, messages.savedOffline, note, queryClient, saveStateAfterFlush, setSnackMsg]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void flushSave();
    }, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const updateMarkdown = useCallback((next: string) => {
    dirtyRef.current = true;
    setSaveState('dirty');
    setEditorMarkdown(next);
    setMarkdown(next);
    scheduleSave();
  }, [scheduleSave]);

  const updateTitle = useCallback((next: string) => {
    dirtyRef.current = true;
    setSaveState('dirty');
    setTitle(next);
    scheduleSave();
  }, [scheduleSave]);

  const updateTags = useCallback((next: string[] | undefined) => {
    setTags(next);
    tagsRef.current = next;
    dirtyRef.current = true;
    setSaveState('dirty');
    scheduleSave();
  }, [scheduleSave]);

  return {
    note,
    noteQuery,
    markdown,
    editorMarkdown,
    title,
    tags,
    noteStatus,
    saveState,
    markdownRef,
    titleRef,
    flushSave,
    scheduleSave,
    updateMarkdown,
    updateTitle,
    updateTags,
    attachmentDisplaySeed,
  };
}
