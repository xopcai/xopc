import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';

import { queryKeys } from '../../query/keys';
import { noteToIndexEntry, upsertNoteInListCaches } from '../../query/note-list-cache';
import { invalidateNoteLists } from '../../query/workspace-sync';
import {
  fetchNote,
  recordNoteOpen,
  updateNote,
  type ApiError,
  type Note,
  type NoteAttachment,
} from '../../query/notes';

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
}: UseNoteEditSessionArgs) {
  const [markdown, setMarkdown] = useState('');
  const [editorMarkdown, setEditorMarkdown] = useState('');
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

  markdownRef.current = markdown;
  titleRef.current = title;
  tagsRef.current = tags;
  statusRef.current = noteStatus;

  const noteQuery = useQuery({
    queryKey: id ? queryKeys.note(id) : ['note', 'missing'],
    queryFn: () => fetchNote(id!),
    enabled: Boolean(id),
    retry: 1,
  });
  const note = noteQuery.data ?? undefined;

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
    const shouldHydrateFromServer = isNewNote || !dirtyRef.current || localStillMatchesPreviousServer;

    if (shouldHydrateFromServer) {
      seededNoteIdRef.current = note.id;
      dirtyRef.current = false;
      setMarkdown(nextMarkdown);
      setEditorMarkdown(nextMarkdown);
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

    setSaveState('saving');
    const savePromise = (async () => {
      try {
        const updated = await updateNote(id, {
          markdown: sentMarkdown,
          title: sentTitle ?? null,
          tags: sentTags,
          status: sentStatus,
        });
        queryClient.setQueryData(queryKeys.note(id), updated);
        upsertNoteInListCaches(queryClient, noteToIndexEntry(updated));
        void invalidateNoteLists(queryClient);

        serverMarkdownRef.current = updated.markdown ?? sentMarkdown;
        serverTitleRef.current = updated.title ?? undefined;
        serverTagsRef.current = updated.tags;
        serverStatusRef.current = updated.status;
        attachmentDisplayVersionRef.current += 1;
        setAttachmentDisplaySeed({
          version: attachmentDisplayVersionRef.current,
          noteId: updated.id,
          markdown: updated.markdown ?? sentMarkdown,
          attachments: updated.attachments,
        });

        const changedWhileSaving = markdownRef.current !== sentMarkdown
          || (titleRef.current.trim() || undefined) !== sentTitle
          || !tagsEqual(tagsRef.current, sentTags)
          || statusRef.current !== sentStatus;
        dirtyRef.current = changedWhileSaving;
        setSaveState(changedWhileSaving ? 'dirty' : 'saved');
        if (changedWhileSaving) saveAgainRef.current = true;
      } catch {
        setSaveState('failed');
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

  const updateMarkdown = useCallback((next: string) => {
    dirtyRef.current = true;
    markdownRef.current = next;
    setSaveState('dirty');
    setEditorMarkdown(next);
    setMarkdown(next);
    scheduleSave();
  }, [scheduleSave]);

  const updateTitle = useCallback((next: string) => {
    dirtyRef.current = true;
    titleRef.current = next;
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
    editorReady,
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
