import { memo, useRef, type MutableRefObject } from 'react';

import type { AtMentionItem } from '@/features/chat/at-mention-api';
import type { PaletteItem } from '@/features/chat/command-palette.types';
import {
  getWireCaretOffset,
  handleComposerBackspace,
  normalizeOrphanComposerDom,
  serializeEditorToWire,
} from '@/features/chat/composer-editor-wire';
import { showComposerNotification } from '@/features/chat/composer-notifications';
import { collectClipboardFiles, isComposerAcceptableFile } from '@/features/chat/composer-clipboard';
import { useAtMentionPicker } from '@/features/chat/use-at-mention-picker';
import { useCommandPalette } from '@/features/chat/use-command-palette';
import { syncComposerPlaceholderClass } from '@/features/chat/use-composer-editor';
import { cn } from '@/lib/cn';

export type ComposerKbdContext = {
  palette: ReturnType<typeof useCommandPalette>;
  atPicker: ReturnType<typeof useAtMentionPicker>;
  replaceRange: (text: string, start: number, end: number, insert: string) => string;
  applyPaletteItem: (item: PaletteItem) => void;
  applyAtMentionItem: (item: AtMentionItem, opts?: { stayOpen?: boolean }) => void;
  send: () => void;
  runBusy: boolean;
  /** Treat like runBusy for Enter: queue rows waiting to flush after the model went idle. */
  pendingFollowUpsCount: number;
  flushSteeringDraft?: () => void | Promise<void>;
  interruptDraft?: () => void;
  editingFollowUpId: string | null;
  onCancelEditFollowUp: () => void;
  attachmentsLen: number;
  isComposing: boolean;
  valueRef: MutableRefObject<string>;
  setValue: (v: string) => void;
  setCursor: (c: number) => void;
  adjustHeight: () => void;
  editorRef: MutableRefObject<HTMLDivElement | null>;
  resetEditor: (opts?: { nextText?: string; caretOffset?: number; focus?: boolean }) => void;
  tryInputHistoryArrow?: (dir: 'up' | 'down') => boolean;
};

export const ChatComposerInput = memo(function ChatComposerInput({
  editorRef,
  disabled,
  placeholder,
  onWireInput,
  adjustHeight,
  processFiles,
  setIsComposing,
  kbdRef,
  chatMessages,
}: {
  editorRef: MutableRefObject<HTMLDivElement | null>;
  disabled: boolean;
  placeholder: string;
  onWireInput: (wire: string, caret: number) => void;
  adjustHeight: () => void;
  processFiles: (files: File[]) => Promise<void>;
  setIsComposing: (v: boolean) => void;
  kbdRef: MutableRefObject<ComposerKbdContext>;
  chatMessages: { clipboardFileTypeUnsupported: string };
}) {
  const isComposingRef = useRef(false);
  return (
    <div
      ref={editorRef}
      role="textbox"
      aria-multiline="true"
      aria-label={placeholder}
      contentEditable={!disabled}
      suppressContentEditableWarning
      spellCheck
      className={cn(
        'composer-input box-border m-0 max-h-32 min-h-10 w-full overflow-y-auto border-0 bg-transparent px-0 py-2 text-[0.9375rem] leading-6 text-fg focus:outline-none focus:ring-0 disabled:opacity-50',
        'composer-input-empty',
      )}
      data-placeholder={placeholder}
      onInput={(e) => {
        const el = e.currentTarget;
        const wire = isComposingRef.current ? serializeEditorToWire(el) : normalizeOrphanComposerDom(el);
        syncComposerPlaceholderClass(el, wire);
        onWireInput(wire, getWireCaretOffset(el));
        adjustHeight();
      }}
      onCompositionStart={() => {
        isComposingRef.current = true;
        setIsComposing(true);
      }}
      onCompositionEnd={() => {
        isComposingRef.current = false;
        setIsComposing(false);
        queueMicrotask(() => {
          const el = editorRef.current;
          if (!el || isComposingRef.current) return;
          const wire = normalizeOrphanComposerDom(el);
          syncComposerPlaceholderClass(el, wire);
          onWireInput(wire, getWireCaretOffset(el));
          adjustHeight();
        });
      }}
      onPaste={async (e) => {
        const cd = e.clipboardData;
        const collected = collectClipboardFiles(cd ?? null);
        const accepted = collected.filter(isComposerAcceptableFile);
        if (accepted.length > 0) {
          e.preventDefault();
          await processFiles(accepted);
          return;
        }
        if (collected.length > 0) {
          e.preventDefault();
          showComposerNotification('warning', chatMessages.clipboardFileTypeUnsupported);
          return;
        }
        const text = cd?.getData('text/plain');
        if (text) {
          e.preventDefault();
          document.execCommand('insertText', false, text);
        }
      }}
      onKeyDown={(e) => {
        const k = kbdRef.current;
        if (e.key === 'Backspace' && !k.isComposing && editorRef.current) {
          if (handleComposerBackspace(editorRef.current)) {
            e.preventDefault();
            return;
          }
        }
        const { atPicker, palette } = k;
        if (atPicker.open && atPicker.atRange && !k.isComposing) {
          if (e.key === 'Escape') {
            e.preventDefault();
            const range = atPicker.atRange;
            const v = k.valueRef.current;
            const next = k.replaceRange(v, range.start, range.end, '');
            k.resetEditor({ nextText: next, caretOffset: range.start, focus: true });
            return;
          }
          if (atPicker.items.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              atPicker.onNavigate('down');
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              atPicker.onNavigate('up');
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              const item = atPicker.items[atPicker.selectedIndex];
              if (item) k.applyAtMentionItem(item, { stayOpen: e.shiftKey });
              return;
            }
          }
        }
        if (palette.open && !k.isComposing) {
          if (palette.items.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              palette.onNavigate('down');
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              palette.onNavigate('up');
              return;
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
              e.preventDefault();
              const item = palette.items[palette.selectedIndex];
              if (item) k.applyPaletteItem(item);
              return;
            }
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            const range = palette.slashRange;
            if (range) {
              const v = k.valueRef.current;
              const next = k.replaceRange(v, range.start, range.end, '');
              k.resetEditor({ nextText: next, caretOffset: range.start, focus: true });
            }
            return;
          }
        }
        if (!k.isComposing && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          const dir = e.key === 'ArrowUp' ? 'up' : 'down';
          if (k.tryInputHistoryArrow?.(dir)) {
            e.preventDefault();
            k.adjustHeight();
            return;
          }
        }
        if (e.key === 'Escape' && !k.isComposing && k.editingFollowUpId) {
          e.preventDefault();
          k.onCancelEditFollowUp?.();
          return;
        }
        if (e.key === 'Enter' && e.shiftKey && !k.isComposing) {
          e.preventDefault();
          document.execCommand('insertText', false, '\n');
          return;
        }
        const nativeComposing =
          typeof KeyboardEvent !== 'undefined' &&
          e.nativeEvent instanceof KeyboardEvent &&
          e.nativeEvent.isComposing;
        if (e.key === 'Enter' && !e.shiftKey && !k.isComposing && !nativeComposing) {
          e.preventDefault();
          const hasDraft = Boolean(k.valueRef.current.trim() || k.attachmentsLen > 0);
          const steerKbdBusy = k.runBusy || k.pendingFollowUpsCount > 0;
          if (steerKbdBusy) {
            if ((e.metaKey || e.ctrlKey) && hasDraft) {
              k.interruptDraft?.();
              return;
            }
            if (!e.metaKey && !e.ctrlKey && !e.altKey && hasDraft) {
              void k.flushSteeringDraft?.();
              return;
            }
            return;
          }
          if (hasDraft) k.send();
        }
      }}
    />
  );
});
