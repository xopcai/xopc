import { useCallback, useState, type MutableRefObject } from 'react';
import { useRouter } from 'expo-router';
import { Keyboard, Platform, Share } from 'react-native';
import type { QueryClient } from '@tanstack/react-query';

import { t } from '../../i18n/messages';
import { openChat } from '../../lib/navigation';
import { queryKeys } from '../../query/keys';
import { noteToIndexEntry, upsertNoteInListCaches } from '../../query/note-list-cache';
import { invalidateNoteLists } from '../../query/workspace-sync';
import { updateNote, type Note } from '../../query/notes';
import { createSession } from '../../query/sessions';
import { setAppClipboardStringAsync } from '../clipboard-intake/write-app-clipboard';
import { writeNoteChatPrefill } from '../chat/note-chat-prefill-storage';
import { flushPendingNoteOperations } from '../notes/notes-local';
import {
  buildNoteChatContextText,
  collectNoteAttachmentsForChat,
  extractVoiceTranscripts,
} from '../notes/note-to-chat-payload';

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
    editorSendToChatPrefix: string;
    noteChatImagePlaceholder: string;
    noteChatTitleLabel: string;
    noteChatVoiceTranscript: string;
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

  const buildChatPrefill = useCallback((instruction: string): string => {
    const context = buildNoteChatContextText(
      markdownRef.current,
      {
        imagePlaceholder: (alt) => t(messages.noteChatImagePlaceholder, { alt }),
        voiceTranscript: (text) => t(messages.noteChatVoiceTranscript, { text }),
      },
      { voiceTranscripts: extractVoiceTranscripts(note?.attachments) },
    );
    const noteTitle = titleRef.current.trim();
    return [
      instruction.trim(),
      noteTitle ? `${messages.noteChatTitleLabel}: ${noteTitle}` : '',
      context,
    ].filter(Boolean).join('\n\n');
  }, [markdownRef, messages, note?.attachments, titleRef]);

  const handleOpenNoteChat = useCallback(async () => {
    if (!id || !note) return;
    setActionLoading('openChat');
    try {
      Keyboard.dismiss();
      await flushEditorToDraft();
      await flushSave();
      const prefill = buildChatPrefill(messages.editorSendToChatPrefix);
      const media = await collectNoteAttachmentsForChat(id, markdownRef.current, [], note.attachments);
      const key = await createSession();
      writeNoteChatPrefill(key, {
        text: prefill,
        attachments: media.attachments,
        droppedCount: media.droppedCount,
      });
      openChat(router, key, { msg: prefill });
    } catch (error) {
      setSnackMsg(error instanceof Error ? error.message : messages.actionFailed);
    } finally {
      setActionLoading(null);
    }
  }, [buildChatPrefill, flushEditorToDraft, flushSave, id, markdownRef, messages, note, router, setSnackMsg]);

  const handleShare = useCallback(async () => {
    dismissMore();
    try {
      await flushEditorToDraft();
      await flushSave();
      const message = markdownRef.current.trim() || titleRef.current.trim() || messages.untitledNote;
      if (Platform.OS === 'web') {
        await setAppClipboardStringAsync(message);
        setSnackMsg(messages.shareNotesCopied);
        return;
      }
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
      const flushed = await flushPendingNoteOperations();
      if (id) await queryClient.invalidateQueries({ queryKey: queryKeys.note(id) });
      await invalidateNoteLists(queryClient);
      setSnackMsg(flushed > 0 ? messages.updated : messages.saved);
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
