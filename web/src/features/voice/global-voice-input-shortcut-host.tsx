import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  APP_SHORTCUT_RECORDING_EVENT,
  clearPendingVoiceInputToggle,
  dispatchVoiceInputEvent,
  queuePendingVoiceInputToggle,
  VOICE_INPUT_CANCEL_EVENT,
  VOICE_INPUT_TOGGLE_EVENT,
} from '@/features/voice/voice-input-shortcut-events';
import { matchesShortcut } from '@/stores/quick-capture-shortcut-store';
import { useGatewayStore } from '@/stores/gateway-store';
import { useVoiceInputShortcutStore } from '@/stores/voice-input-shortcut-store';

export function GlobalVoiceInputShortcutHost() {
  const navigate = useNavigate();
  const token = useGatewayStore((s) => s.token);
  const shortcut = useVoiceInputShortcutStore((s) => s.shortcut);
  const recordingShortcutRef = useRef(false);
  const systemHotkeyActiveRef = useRef(false);

  useEffect(() => {
    const onRecordingChange = (event: Event) => {
      recordingShortcutRef.current = Boolean(
        (event as CustomEvent<{ active?: boolean }>).detail?.active,
      );
    };
    window.addEventListener(APP_SHORTCUT_RECORDING_EVENT, onRecordingChange);
    return () => window.removeEventListener(APP_SHORTCUT_RECORDING_EVENT, onRecordingChange);
  }, []);

  useEffect(() => {
    const hotkeyApi = window.electronAPI?.voiceInputHotkey;
    if (typeof hotkeyApi?.onEvent !== 'function') return;

    const unsubscribe = hotkeyApi.onEvent((action) => {
      if (action === 'press') {
        if (recordingShortcutRef.current || !token) return;
        systemHotkeyActiveRef.current = true;
      } else {
        if (!systemHotkeyActiveRef.current) return;
        systemHotkeyActiveRef.current = false;
      }

      const target = document.querySelector('[data-voice-input-scope="note"]') ? 'note' : 'chat';
      if (dispatchVoiceInputEvent(VOICE_INPUT_TOGGLE_EVENT, target)) return;

      if (action === 'press') {
        queuePendingVoiceInputToggle();
        navigate('/chat');
      } else {
        clearPendingVoiceInputToggle();
      }
    });
    return () => {
      systemHotkeyActiveRef.current = false;
      unsubscribe();
    };
  }, [navigate, token]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (recordingShortcutRef.current || event.repeat || event.isComposing) return;
      const target = document.querySelector('[data-voice-input-scope="note"]') ? 'note' : 'chat';

      if (event.key === 'Escape') {
        if (dispatchVoiceInputEvent(VOICE_INPUT_CANCEL_EVENT, target)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (!matchesShortcut(event, shortcut)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!token) return;

      if (!dispatchVoiceInputEvent(VOICE_INPUT_TOGGLE_EVENT, target)) {
        queuePendingVoiceInputToggle();
        navigate('/chat');
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [navigate, shortcut, token]);

  return null;
}
