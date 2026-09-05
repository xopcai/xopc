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
import { flushPendingWorkspaceOperations, getPendingWorkspaceOperations, getWorkspaceSyncDeadLetters, queueWorkspaceOperation } from '../../sync/workspace-sync';
import type { NoteEditorDraft } from '../notes/editor/editor-protocol';

const SAVE_DEBOUNCE_MS = 600;

export type SaveState = 'saved' | 'dirty' | 'saving' | 'pending' | 'failed';

export type AttachmentDisplaySeed = {
  version: number;
  noteId: string;
  markdown: string;
  attachments: NoteAttachment[] | undefined;
} | null;

type SaveSnapshot = {
  markdown: string;
  title: string | undefined;
  tags: string[] | undefined;
  status: Note['status'];
};

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

function tagsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every((tag, index) => tag === right[index]);
}

function saveSnapshotsEqual(a: SaveSnapshot | null, b: SaveSnapshot): boolean {
  if (!a) return false;
  return a.markdown === b.markdown
    && a.title === b.title
    && tagsEqual(a.tags, b.tags)
    && a.status === b.status;
}

function isRetryableSaveError(error: unknown): boolean {
  const status = typeof (error as Partial<ApiError> | null)?.status === 'number'
    ? (error as Partial<ApiError>).status
    : undefined;
  return status == null || status >= 500 || status === 408 || status === 429;
}

export function useNoteEditSession({
  id,
  queryClient,
  ensureNoteTags,
  setSnackMsg,
  messages,
  onMissingNote,
}: UseNoteEditSessionArgs) {
  const [markdown, setMarkdown] = useState('');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[] | undefined>(undefined);
  const [noteStatus, setNoteStatus] = useState<Note['status']>('processed');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [attachmentDisplaySeed, setAttachmentDisplaySeed] = useState<AttachmentDisplaySeed>(null);
  const [editorReady, setEditorReady] = useState(false);

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
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const saveAgainRef = useRef(false);
  const queuedSaveSnapshotRef = useRef<SaveSnapshot | null>(null);

  const noteQuery = useQuery({
    queryKey: id ? queryKeys.note(id) : ['note', 'missing'],
    queryFn: () => fetchNote(id!),
    enabled: Boolean(id),
    retry: 1,
  });
  const note = noteQuery.data?.id === id ? noteQuery.data : undefined;
  const editorReadyForCurrentNote = editorReady && seededNoteIdRef.current === id;

  useEffect(() => {
    setEditorReady(false);
  }, [id]);

  useEffect(() => {
    if (!id || !noteQuery.isError || handledMissingNoteIdRef.current === id) return;
    const error = noteQuery.error as Partial<ApiError>;
    if (error.status !== 404) return;
    handledMissingNoteIdRef.current = id;
    queryClient.removeQueries({ queryKey: queryKeys.note(id) });
    void invalidateNoteLists(queryClient);
    setSnackMsg(messages.missing);
    onMissingNote();
  }, [id, messages.missing, noteQuery.error, noteQuery.isError, onMissingNote, queryClient, setSnackMsg]);

  useEffect(() => {
    if (!note) return;
    const previousServerMarkdown = serverMarkdownRef.current;
    const previousServerTitle = serverTitleRef.current;
    const previousServerTags = serverTagsRef.current;
    const previousServerStatus = serverStatusRef.current;
    const nextMarkdown = note.markdown ?? '';
    const nextTitle = note.title;
    const nextTags = note.tags;
    const nextStatus = note.status;

    const isNewNote = seededNoteIdRef.current !== note.id;
    const localStillMatchesPreviousServer = markdownRef.current === previousServerMarkdown
      && (titleRef.current.trim() || undefined) === previousServerTitle
      && tagsEqual(tagsRef.current, previousServerTags)
      && statusRef.current === previousServerStatus;
    const localMatchesNextServer = markdownRef.current === nextMarkdown
      && (titleRef.current.trim() || undefined) === nextTitle
      && tagsEqual(tagsRef.current, nextTags)
      && statusRef.current === nextStatus;
    const shouldHydrateFromServer = isNewNote || !dirtyRef.current || localStillMatchesPreviousServer;

    if (shouldHydrateFromServer) {
      seededNoteIdRef.current = note.id;
      dirtyRef.current = false;
      markdownRef.current = nextMarkdown;
      titleRef.current = nextTitle ?? '';
      tagsRef.current = nextTags;
      statusRef.current = nextStatus;
      setMarkdown(nextMarkdown);
      setTitle(nextTitle ?? '');
      setTags(nextTags);
      ensureNoteTags(nextTags ?? []);
      setNoteStatus(nextStatus);
      setSaveState('saved');
      attachmentDisplayVersionRef.current += 1;
      setAttachmentDisplaySeed({
        version: attachmentDisplayVersionRef.current,
        noteId: note.id,
        markdown: nextMarkdown,
        attachments: note.attachments,
      });
      setEditorReady(true);
    } else if (localMatchesNextServer) {
      dirtyRef.current = false;
      if (!saveInFlightRef.current) queuedSaveSnapshotRef.current = null;
      setSaveState('saved');
      setEditorReady(true);
    } else {
      setEditorReady(true);
    }

    serverMarkdownRef.current = nextMarkdown;
    serverTitleRef.current = nextTitle;
    serverTagsRef.current = nextTags;
    serverStatusRef.current = nextStatus;

    upsertNoteInListCaches(queryClient, noteToIndexEntry(note));
  }, [
    ensureNoteTags,
    note,
    note?.id,
    note?.markdown,
    note?.status,
    note?.tags,
    note?.title,
    queryClient,
  ]);

  useEffect(() => {
    if (!id || openedNoteIdRef.current === id) return;
    openedNoteIdRef.current = id;
    void recordNoteOpen(id).catch(() => undefined);
  }, [id]);

  const flushSave = useCallback(async (): Promise<void> => {
    if (!id || !note) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (saveInFlightRef.current) {
      saveAgainRef.current = true;
      await saveInFlightRef.current.catch(() => undefined);
      if (saveAgainRef.current) {
        saveAgainRef.current = false;
        await flushSave();
      }
      return;
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
      setSaveState('saved');
      return;
    }

    const sentMarkdown = nextMarkdown;
    const sentTitle = nextTitle;
    const sentTags = nextTags;
    const sentStatus = nextStatus;
    const sentSnapshot: SaveSnapshot = {
      markdown: sentMarkdown,
      title: sentTitle,
      tags: sentTags,
      status: sentStatus,
    };

    if (!saveSnapshotsEqual(queuedSaveSnapshotRef.current, sentSnapshot)) {
      queueWorkspaceOperation({
        type: 'update_note', noteId: id,
        patch: { markdown: sentMarkdown, title: sentTitle ?? null, tags: sentTags, status: sentStatus },
      });
      queuedSaveSnapshotRef.current = sentSnapshot;
    }

    setSaveState('saving');
    const savePromise = (async () => {
      try {
        await flushPendingWorkspaceOperations();
        if (getPendingWorkspaceOperations().some((op) => op.payload.type === 'update_note' && op.payload.noteId === id)) {
          setSaveState('pending');
          return;
        }
        if (getWorkspaceSyncDeadLetters().some((op) => op.payload.type === 'update_note' && op.payload.noteId === id)) {
          setSaveState('failed');
          return;
        }
        const updated = await fetchNote(id);
        queryClient.setQueryData(queryKeys.note(id), updated);
        upsertNoteInListCaches(queryClient, noteToIndexEntry(updated));
        void invalidateNoteLists(queryClient);

        serverMarkdownRef.current = updated.markdown ?? sentMarkdown;
        serverTitleRef.current = updated.title ?? undefined;
        serverTagsRef.current = updated.tags;
        serverStatusRef.current = updated.status;
        if (saveSnapshotsEqual(queuedSaveSnapshotRef.current, sentSnapshot)) {
          queuedSaveSnapshotRef.current = null;
        }
        const changedWhileSaving = markdownRef.current !== sentMarkdown
          || (titleRef.current.trim() || undefined) !== sentTitle
          || !tagsEqual(tagsRef.current, sentTags)
          || statusRef.current !== sentStatus;
        dirtyRef.current = changedWhileSaving;
        setSaveState(changedWhileSaving ? 'dirty' : 'saved');
        if (changedWhileSaving) saveAgainRef.current = true;
      } catch (error) {
        if (!isRetryableSaveError(error)) {
          setSaveState('failed');
          setSnackMsg(error instanceof Error ? error.message : messages.savedOffline);
          return;
        }
        dirtyRef.current = true;
        setSaveState('pending');
        setSnackMsg(messages.savedOffline);
      }
    })();

    saveInFlightRef.current = savePromise;
    await savePromise;
    saveInFlightRef.current = null;

    if (saveAgainRef.current) {
      saveAgainRef.current = false;
      await flushSave();
    }
  }, [id, messages.savedOffline, note, queryClient, setSnackMsg]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void flushSave();
    }, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const applyDraft = useCallback((draft: NoteEditorDraft, schedule = true) => {
    const titleChanged = draft.title !== titleRef.current;
    const markdownChanged = draft.markdown !== markdownRef.current;
    if (titleChanged || markdownChanged) {
      dirtyRef.current = true;
      markdownRef.current = draft.markdown;
      titleRef.current = draft.title;
      setSaveState('dirty');
      if (schedule) scheduleSave();
    }
    setMarkdown(draft.markdown);
    setTitle(draft.title);
  }, [scheduleSave]);

  const updateMarkdownFromEditor = useCallback((next: string) => {
    if (next === markdownRef.current) return;
    markdownRef.current = next;
    dirtyRef.current = true;
    setSaveState('dirty');
    scheduleSave();
  }, [scheduleSave]);

  const updateTitleFromEditor = useCallback((next: string) => {
    if (next === titleRef.current) return;
    titleRef.current = next;
    dirtyRef.current = true;
    setSaveState('dirty');
    scheduleSave();
  }, [scheduleSave]);

  const replaceMarkdown = useCallback((next: string) => {
    applyDraft({ title: titleRef.current, markdown: next });
  }, [applyDraft]);

  const replaceTitle = useCallback((next: string) => {
    applyDraft({ title: next, markdown: markdownRef.current });
  }, [applyDraft]);

  const updateTags = useCallback((next: string[] | undefined) => {
    setTags(next);
    tagsRef.current = next;
    dirtyRef.current = true;
    setSaveState('dirty');
    scheduleSave();
  }, [scheduleSave]);

  const persistForSync = useCallback(() => {
    if (!id || !note) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const snapshot: SaveSnapshot = {
      markdown: markdownRef.current,
      title: titleRef.current.trim() || undefined,
      tags: tagsRef.current,
      status: statusRef.current,
    };
    if ((snapshot.markdown === serverMarkdownRef.current
      && snapshot.title === serverTitleRef.current
      && tagsEqual(snapshot.tags, serverTagsRef.current)
      && snapshot.status === serverStatusRef.current)
      || saveSnapshotsEqual(queuedSaveSnapshotRef.current, snapshot)) return;
    queueWorkspaceOperation({
      type: 'update_note',
      noteId: id,
      patch: {
        markdown: snapshot.markdown,
        title: snapshot.title ?? null,
        tags: snapshot.tags,
        status: snapshot.status,
      },
    });
    queuedSaveSnapshotRef.current = snapshot;
    setSaveState('pending');
  }, [id, note]);

  return {
    note,
    noteQuery,
    markdown,
    title,
    tags,
    noteStatus,
    saveState,
    editorReady: editorReadyForCurrentNote,
    markdownRef,
    titleRef,
    flushSave,
    scheduleSave,
    applyDraft,
    updateMarkdownFromEditor,
    updateTitleFromEditor,
    replaceMarkdown,
    replaceTitle,
    updateTags,
    persistForSync,
    attachmentDisplaySeed,
  };
}
