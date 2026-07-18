import { StickyNote } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useGatewayStore } from '@/stores/gateway-store';
import {
  useQuickCaptureShortcutStore,
  matchesShortcut,
} from '@/stores/quick-capture-shortcut-store';

import { quickCapture } from './notes-api';

function GlobalQuickCaptureModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const language = useLocaleStore((s) => s.language);
  const n = messages(language).notes;
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const id = window.setTimeout(() => textareaRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, []);

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

        <div className="flex items-center justify-between border-t border-edge-subtle px-4 py-2">
          <div className="flex flex-wrap gap-3 text-[11px] text-fg-muted">
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
    return () => window.removeEventListener('quick-capture-shortcut-recording', handler);
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
