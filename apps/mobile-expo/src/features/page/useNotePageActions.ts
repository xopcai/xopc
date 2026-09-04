import { useCallback, useState, type MutableRefObject } from 'react';
import { useRouter } from 'expo-router';
import { Keyboard, Share } from 'react-native';
import type { QueryClient } from '@tanstack/react-query';

import { openChat } from '../../lib/navigation';
import { queryKeys } from '../../query/keys';
import { noteToIndexEntry, upsertNoteInListCaches } from '../../query/note-list-cache';
import { invalidateNoteLists } from '../../query/workspace-sync';
import { openNoteConversation, updateNote, type Note } from '../../query/notes';
import { flushWorkspaceSyncNow } from '../../sync/use-workspace-sync-flush';
import { setAppClipboardStringAsync } from '../clipboard-intake/write-app-clipboard';

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
    pin: string;
    saved: string;
    shareNotesCopied: string;
    shareNotesTitle: string;
    unpin: string;
    untitledNote: string;
    updated: string;
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
  const [actionLoading, setActionLoading] = useState<'pin' | 'openChat' | null>(null);

  const handleOpenNoteChat = useCallback(async () => {
    if (!id || !note) return;
    setActionLoading('openChat');
    try {
      Keyboard.dismiss();
      await flushEditorToDraft();
      await flushSave();
      const { sessionKey } = await openNoteConversation(id);
      openChat(router, sessionKey);
    } catch (error) {
      setSnackMsg(error instanceof Error ? error.message : messages.actionFailed);
    } finally {
      setActionLoading(null);
    }
  }, [flushEditorToDraft, flushSave, id, messages.actionFailed, note, router, setSnackMsg]);

  const handleShare = useCallback(async () => {
    dismissMore();
    try {
      await flushEditorToDraft();
      await flushSave();
      const message = markdownRef.current.trim() || titleRef.current.trim() || messages.untitledNote;
      await Share.share({
        message,
        title: titleRef.current.trim() || messages.shareNotesTitle,
      });
    } catch {
      await setAppClipboardStringAsync(markdownRef.current.trim() || titleRef.current.trim() || messages.untitledNote);
      setSnackMsg(messages.shareNotesCopied);
    }
  }, [dismissMore, flushEditorToDraft, flushSave, markdownRef, messages, setSnackMsg, titleRef]);

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
    if (!id || !note) return;
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
      setActionLoading(null);
    }
  }, [flushSave, id, messages, note, queryClient, setSnackMsg]);

  return {
    actionLoading,
    handleOpenNoteChat,
    handleShare,
    handleSyncNow,
    handleTogglePinned,
  };
}
