import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import { useRouter } from 'expo-router';
import { Keyboard } from 'react-native';
import type { QueryClient } from '@tanstack/react-query';

import { openChat } from '../../lib/navigation';
import { queryKeys } from '../../query/keys';
import { noteToIndexEntry, upsertNoteInListCaches } from '../../query/note-list-cache';
import { invalidateNoteLists } from '../../query/workspace-sync';
import { fetchNote, openNoteConversation, updateNote, type Note } from '../../query/notes';
import { flushWorkspaceSyncNow } from '../../sync/use-workspace-sync-flush';
import { getPendingWorkspaceOperations, getWorkspaceSyncDeadLetters } from '../../sync/workspace-sync';

type UseNotePageActionsArgs = {
  id: string | undefined;
  note: Note | undefined;
  queryClient: QueryClient;
  markdownRef: MutableRefObject<string>;
  titleRef: MutableRefObject<string>;
  flushEditorToDraft: () => Promise<void>;
  flushSave: () => Promise<void>;
  setSnackMsg: (message: string) => void;
  dismissMore: () => void;
  messages: {
    actionFailed: string;
    syncBeforeAction: string;
    pin: string;
    saved: string;
    unpin: string;
  };
};

export function useNotePageActions({
  id,
  note,
  queryClient,
  markdownRef,
  titleRef,
  flushEditorToDraft,
  flushSave,
  setSnackMsg,
  dismissMore,
  messages,
}: UseNotePageActionsArgs) {
  const router = useRouter();
  const [actionLoading, setActionLoading] = useState<'pin' | 'openChat' | 'share' | null>(null);
  const busyRef = useRef(false);
  const [shareNote, setShareNote] = useState<Note | null>(null);

  const prepareSavedNote = useCallback(async () => {
    await flushEditorToDraft();
    await flushSave();
    const unsynced = [...getPendingWorkspaceOperations(), ...getWorkspaceSyncDeadLetters()]
      .some((op) => op.payload.type === 'update_note' && op.payload.noteId === id);
    if (!id || unsynced) throw new Error(messages.syncBeforeAction);
    const saved = await fetchNote(id);
    if ((saved.markdown ?? '') !== markdownRef.current || (saved.title ?? '') !== titleRef.current.trim()) {
      throw new Error(messages.syncBeforeAction);
    }
    return saved;
  }, [flushEditorToDraft, flushSave, id, markdownRef, messages.syncBeforeAction, titleRef]);

  const handleOpenNoteChat = useCallback(async () => {
    if (!id || !note || busyRef.current) return;
    busyRef.current = true;
    setActionLoading('openChat');
    try {
      Keyboard.dismiss();
      await prepareSavedNote();
      const { sessionKey } = await openNoteConversation(id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessionContext(sessionKey) });
      openChat(router, sessionKey);
    } catch (error) {
      setSnackMsg(error instanceof Error ? error.message : messages.actionFailed);
    } finally {
      busyRef.current = false;
      setActionLoading(null);
    }
  }, [prepareSavedNote, id, messages.actionFailed, note, queryClient, router, setSnackMsg]);

  const handleShare = useCallback(async () => {
    if (!id || !note || busyRef.current) return;
    busyRef.current = true;
    setActionLoading('share');
    dismissMore();
    Keyboard.dismiss();
    try {
      setShareNote(await prepareSavedNote());
    } catch (error) {
      setSnackMsg(error instanceof Error ? error.message : messages.actionFailed);
    } finally {
      busyRef.current = false;
      setActionLoading(null);
    }
  }, [dismissMore, id, note, prepareSavedNote, messages.actionFailed, setSnackMsg]);

  const handleSyncNow = useCallback(async () => {
    dismissMore();
    try {
      await flushEditorToDraft();
      await flushSave();
      await flushWorkspaceSyncNow();
      if (id) await queryClient.invalidateQueries({ queryKey: queryKeys.note(id) });
      await invalidateNoteLists(queryClient);
      setSnackMsg(messages.saved);
    } catch (error) {
      setSnackMsg(error instanceof Error ? error.message : messages.actionFailed);
    }
  }, [dismissMore, flushEditorToDraft, flushSave, id, messages, queryClient, setSnackMsg]);

  const handleTogglePinned = useCallback(async () => {
    if (!id || !note || busyRef.current) return;
    busyRef.current = true;
    setActionLoading('pin');
    try {
      await flushSave();
      const updated = await updateNote(id, { pinned: !note.pinned });
      queryClient.setQueryData(queryKeys.note(id), updated);
      upsertNoteInListCaches(queryClient, noteToIndexEntry(updated));
      void invalidateNoteLists(queryClient);
      setSnackMsg(updated.pinned ? messages.pin : messages.unpin);
    } catch (error) {
      setSnackMsg(error instanceof Error ? error.message : messages.actionFailed);
    } finally {
      busyRef.current = false;
      setActionLoading(null);
    }
  }, [flushSave, id, messages, note, queryClient, setSnackMsg]);

  return {
    actionLoading,
    prepareSavedNote,
    shareNote,
    dismissShare: () => setShareNote(null),
    handleOpenNoteChat,
    handleShare,
    handleSyncNow,
    handleTogglePinned,
  };
}
