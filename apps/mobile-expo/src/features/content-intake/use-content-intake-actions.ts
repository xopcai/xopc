import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { takeNewChatSessionKey } from '@/features/chat/session-prefetch';
import { useMessages } from '@/i18n/messages';
import { openChat } from '@/lib/navigation';
import { useEffectiveDefaultAgentId } from '@/query/agents';
import { invalidateNoteLists } from '@/query/workspace-sync';
import { captureWorkspaceText } from '@/sync/workspace-sync';

import { buildContentIntakeNoteMarkdown } from './content-note-markdown';
import { setContentChatIntake } from './content-chat-handoff';
import type { ContentIntakeIntent, ContentIntakeSource } from './content-intent';

export type ContentIntakeCandidate = {
  text: string;
  intent: ContentIntakeIntent;
  source: ContentIntakeSource;
};

export type ContentIntakeActionOptions = {
  chatNavigation?: 'push' | 'replace';
};

export type ContentIntakeSaveResult =
  | { status: 'saved'; noteId?: string }
  | { status: 'ignored' };

export function useContentIntakeActions(
  onHandled: () => void,
  options: ContentIntakeActionOptions = {},
): {
  saving: boolean;
  toast: string;
  setToast: (message: string) => void;
  saveToNote: (candidate: ContentIntakeCandidate | null) => Promise<ContentIntakeSaveResult>;
  exploreInChat: (candidate: ContentIntakeCandidate | null) => void;
} {
  const router = useRouter();
  const queryClient = useQueryClient();
  const defaultAgentId = useEffectiveDefaultAgentId();
  const m = useMessages();
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const saveToNote = useCallback(
    async (candidate: ContentIntakeCandidate | null): Promise<ContentIntakeSaveResult> => {
      if (!candidate || saving) return { status: 'ignored' };
      const { text, intent, source } = candidate;
      const markdown = buildContentIntakeNoteMarkdown(text, intent);
      setSaving(true);
      onHandled();
      try {
        const result = await captureWorkspaceText({ text: markdown, channel: source });
        invalidateNoteLists(queryClient);
        setToast(result.synced ? m.contentIntake.savedToNote : m.notesPage.savedOffline);
        return { status: 'saved', noteId: result.noteId };
      } catch (err) {
        setToast(err instanceof Error ? err.message : m.notesPage.actionFailed);
        return { status: 'ignored' };
      } finally {
        setSaving(false);
      }
    },
    [m.contentIntake.savedToNote, m.notesPage.actionFailed, onHandled, queryClient, saving],
  );

  const exploreInChat = useCallback(
    (candidate: ContentIntakeCandidate | null) => {
      if (!candidate || saving) return;
      void takeNewChatSessionKey(defaultAgentId)
        .then((sessionKey) => {
          setContentChatIntake({
            sessionKey,
            text: candidate.text,
            prompt: candidate.intent.chatPrompt,
            source: candidate.source,
          });
          onHandled();
          openChat(router, sessionKey, { replace: options.chatNavigation === 'replace' });
        })
        .catch((err) => {
          setToast(err instanceof Error ? err.message : m.sessions.bootstrapFailed);
        });
    },
    [defaultAgentId, m.sessions.bootstrapFailed, onHandled, options.chatNavigation, router, saving],
  );

  return { saving, toast, setToast, saveToNote, exploreInChat };
}
