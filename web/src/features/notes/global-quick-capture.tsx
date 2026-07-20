import { Mic, StickyNote } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { appendTranscriptToDraft } from '@/features/chat/composer/append-transcript-to-draft';
import { ComposerVoiceInputBar } from '@/features/chat/composer/composer-voice-input-bar';
import { useComposerVoiceInput } from '@/features/chat/composer/use-composer-voice-input';
import {
  APP_SHORTCUT_RECORDING_EVENT,
  type VoiceInputShortcutTarget,
  VOICE_INPUT_CANCEL_EVENT,
  VOICE_INPUT_TOGGLE_EVENT,
} from '@/features/voice/voice-input-shortcut-events';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useGatewayStore } from '@/stores/gateway-store';
import {
  useQuickCaptureShortcutStore,
  matchesShortcut,
  shortcutDisplayKeys,
} from '@/stores/quick-capture-shortcut-store';
import { useVoiceInputShortcutStore } from '@/stores/voice-input-shortcut-store';

import { quickCapture } from './notes-api';

function GlobalQuickCaptureModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const language = useLocaleStore((s) => s.language);
  const n = messages(language).notes;
  const chat = messages(language).chat;
  const voiceShortcut = useVoiceInputShortcutStore((s) => s.shortcut);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voice = useComposerVoiceInput({
    disabled: saving,
    chat,
    onTranscript: (transcript) => {
      setText((current) => appendTranscriptToDraft(current, transcript));
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    },
  });
  const {
    phase: voicePhase,
    voiceActive,
    startVoiceInput,
    cancelVoiceInput: cancelVoiceCapture,
    confirmVoiceInput,
  } = voice;

  useEffect(() => {
    const id = window.setTimeout(() => textareaRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const toggleVoiceInput = (event: Event) => {
      const target = (event as CustomEvent<{ target?: VoiceInputShortcutTarget }>).detail?.target;
      if (target !== 'note') return;
      event.preventDefault();
      if (saving) return;
      if (voicePhase === 'recording') {
        confirmVoiceInput();
      } else if (voicePhase === 'idle' || voicePhase === 'error') {
        void startVoiceInput();
      }
    };
    const cancelVoiceInput = (event: Event) => {
      const target = (event as CustomEvent<{ target?: VoiceInputShortcutTarget }>).detail?.target;
      if (target !== 'note' || !voiceActive) return;
      event.preventDefault();
      cancelVoiceCapture();
      textareaRef.current?.focus();
    };
    window.addEventListener(VOICE_INPUT_TOGGLE_EVENT, toggleVoiceInput);
    window.addEventListener(VOICE_INPUT_CANCEL_EVENT, cancelVoiceInput);
    return () => {
      window.removeEventListener(VOICE_INPUT_TOGGLE_EVENT, toggleVoiceInput);
      window.removeEventListener(VOICE_INPUT_CANCEL_EVENT, cancelVoiceInput);
    };
  }, [cancelVoiceCapture, confirmVoiceInput, saving, startVoiceInput, voiceActive, voicePhase]);

  const handleSave = useCallback(
    async (shouldNavigate: boolean) => {
      const trimmed = text.trim();
      if (!trimmed || saving) return;
      setSaving(true);
      try {
        const note = await quickCapture(trimmed, 'web');
        onClose();
        if (shouldNavigate) {
          navigate(`/notes/${note.id}`);
        }
      } catch {
        setSaving(false);
      }
    },
    [text, saving, navigate, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSave(true);
        return;
      }
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        void handleSave(false);
      }
    },
    [handleSave, onClose],
  );

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-black/40 p-4 pt-[min(18vh,7rem)]"
      role="dialog"
      aria-modal="true"
      data-voice-input-scope="note"
      aria-label={n.quickCapturePlaceholder}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-elevated">
        <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
          <StickyNote className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium text-fg">{n.quickCapturePlaceholder}</span>
        </div>

        {voice.voiceActive ? (
          <div className="px-4 py-3">
            <ComposerVoiceInputBar
              phase={voice.phase}
              elapsedLabel={voice.elapsedLabel}
              audioLevel={voice.audioLevel}
              readiness={voice.readiness}
              hasRetainedRecording={voice.hasRetainedRecording}
              disabled={saving}
              chat={chat}
              onCancel={voice.cancelVoiceInput}
              onConfirm={voice.confirmVoiceInput}
              onRetry={voice.retryVoiceInput}
            />
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={n.quickCapturePlaceholder}
            disabled={saving}
            rows={4}
            className="resize-none border-none bg-transparent px-4 py-3 text-sm leading-relaxed text-fg placeholder:text-fg-muted focus:outline-none disabled:opacity-60"
            style={{ fieldSizing: 'content', minHeight: '6rem', maxHeight: '40vh' }}
          />
        )}

        <div className="flex items-center justify-between border-t border-edge-subtle px-4 py-2">
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-fg-muted">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-50"
              disabled={saving || voice.voiceActive}
              title={`${chat.voiceInput} (${shortcutDisplayKeys(voiceShortcut).join('+')})`}
              aria-label={`${chat.voiceInput} (${shortcutDisplayKeys(voiceShortcut).join('+')})`}
              onClick={() => void voice.startVoiceInput()}
            >
              <Mic className="size-3.5" aria-hidden />
              <span>{chat.voiceInput}</span>
            </button>
            <span>
              <kbd className="rounded bg-surface-hover px-1 py-0.5 font-mono text-[10px]">Enter</kbd>{' '}
              {n.quickCaptureHintEnter}
            </span>
            <span>
              <kbd className="rounded bg-surface-hover px-1 py-0.5 font-mono text-[10px]">Shift+Enter</kbd>{' '}
              {n.quickCaptureHintShift}
            </span>
            <span>
              <kbd className="rounded bg-surface-hover px-1 py-0.5 font-mono text-[10px]">Esc</kbd>{' '}
              {n.quickCaptureHintEsc}
            </span>
          </div>
          {saving && (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          )}
        </div>
      </div>
    </div>
  );
}

export function GlobalQuickCaptureHost() {
  const [open, setOpen] = useState(false);
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const token = useGatewayStore((s) => s.token);
  const shortcut = useQuickCaptureShortcutStore((s) => s.shortcut);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (recordingShortcut) return;
      if (matchesShortcut(event, shortcut)) {
        event.preventDefault();
        if (token) {
          setOpen((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recordingShortcut, shortcut, token]);

  useEffect(() => {
    const handler = (event: Event) => {
      setRecordingShortcut(Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active));
    };
    window.addEventListener('quick-capture-shortcut-recording', handler);
    window.addEventListener(APP_SHORTCUT_RECORDING_EVENT, handler);
    return () => {
      window.removeEventListener('quick-capture-shortcut-recording', handler);
      window.removeEventListener(APP_SHORTCUT_RECORDING_EVENT, handler);
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      if (token) setOpen(true);
    };
    window.addEventListener('open-quick-capture', handler);
    return () => window.removeEventListener('open-quick-capture', handler);
  }, [token]);

  if (!open) return null;

  return <GlobalQuickCaptureModal onClose={() => setOpen(false)} />;
}
