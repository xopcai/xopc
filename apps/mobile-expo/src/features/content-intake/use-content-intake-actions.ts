import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { takeNewChatSessionKey } from '@/features/chat/session-prefetch';
import { queueNote } from '@/features/notes/notes-sync';
import { useMessages } from '@/i18n/messages';
import { openChat } from '@/lib/navigation';
import { useEffectiveDefaultAgentId } from '@/query/agents';
import { captureNote } from '@/query/notes';
import { invalidateNoteLists } from '@/query/workspace-sync';

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
  | { status: 'queued' }
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
        const created = await captureNote({ markdown, kind: intent.noteKind, channel: source });
        invalidateNoteLists(queryClient);
        setToast(m.contentIntake.savedToNote);
        return { status: 'saved', noteId: created.note.id };
      } catch {
        queueNote(markdown, intent.noteKind, source);
        setToast(m.notesPage.savedOffline);
        return { status: 'queued' };
      } finally {
        setSaving(false);
      }
    },
    [m.contentIntake.savedToNote, m.notesPage.savedOffline, onHandled, queryClient, saving],
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
