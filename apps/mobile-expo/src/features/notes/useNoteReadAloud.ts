import { useCallback, useMemo } from 'react';

import { useMessages } from '../../i18n/messages';
import { usePreferencesStore } from '../../stores/preferences-store';
import { useReadAloudStore } from '../voice/read-aloud-store';
import { detectSpeechLanguage } from '../voice/read-aloud-text';
import { useVoiceCall } from '../voice/voice-call';
import { buildNoteReadAloudText } from './note-read-aloud';
import type { NoteViewActionBarItem } from './NoteViewActionBar';

export function useNoteReadAloud(id: string | undefined, title: string, markdown: string) {
  const m = useMessages();
  const language = usePreferencesStore((state) => state.language);
  const call = useVoiceCall();
  const text = useMemo(() => buildNoteReadAloudText(title, markdown), [title, markdown]);
  const status = useReadAloudStore((state) => state.source?.noteId === id && id ? state.status : 'idle');
  const stopNoteReadAloud = useCallback(() => {
    const player = useReadAloudStore.getState();
    if (id && player.source?.noteId === id) player.stop();
  }, [id]);
  const item: NoteViewActionBarItem = {
    key: 'readAloud',
    icon: status === 'playing' ? 'pause' : status === 'preparing' ? 'stop' : status === 'error' ? 'refresh' : 'volume-high',
    label: status === 'playing' ? m.chat.messageReadAloudPause
      : status === 'paused' ? m.chat.messageReadAloudResume
        : status === 'preparing' ? m.chat.messageReadAloudStop
          : status === 'error' ? m.chat.messageReadAloudRetry : m.notesPage.readAloud,
    active: status !== 'idle',
    disabled: !id || !text || call.phase !== 'idle',
    onPress: () => {
      if (!id || !text || call.phase !== 'idle') return;
      const player = useReadAloudStore.getState();
      // A pending chat reply must not replace an explicitly requested note reading.
      player.disableContinuous();
      player.requestStart({
        source: { id: `note:${id}`, noteId: id, title: title.trim() || m.notesPage.untitledNote, preview: text.slice(0, 240) },
        text,
        language: detectSpeechLanguage(text, language),
      });
    },
  };
  return { readAloudItem: item, stopNoteReadAloud };
}
