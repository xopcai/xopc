import { memo, useRef, type MutableRefObject } from 'react';

import {
  getWireCaretOffset,
  handleComposerBackspace,
  normalizeOrphanComposerDom,
  serializeEditorToWire,
} from '@/features/chat/composer/composer-editor-wire';
import {
  dispatchPickerKey,
  type PickerKeyAdapter,
} from '@/features/chat/composer/picker-key-adapter';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { collectClipboardFiles, isComposerAcceptableFile } from '@/features/chat/composer/composer-clipboard';
import { classifyPastedText, type PastedTextAttachment } from '@/features/chat/composer/pasted-text';
import { syncComposerPlaceholderClass } from '@/features/chat/composer/use-composer-editor';
import { cn } from '@/lib/cn';

export interface ComposerKbdContext {
  /** Picker dispatcher list, in priority order. */
  adapters: readonly PickerKeyAdapter[];
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
  adjustHeight: () => void;
  editorRef: MutableRefObject<HTMLDivElement | null>;
  tryInputHistoryArrow?: (dir: 'up' | 'down') => boolean;
  acceptEmptySuggestion?: () => boolean;
}

export const ChatComposerInput = memo(function ChatComposerInput({
  editorRef,
  disabled,
  hidden,
  placeholder,
  ariaLabel,
  onWireInput,
  adjustHeight,
  processFiles,
  processPastedText,
  setIsComposing,
  kbdRef,
  chatMessages,
}: {
  editorRef: MutableRefObject<HTMLDivElement | null>;
  disabled: boolean;
  hidden?: boolean;
  placeholder: string;
  ariaLabel?: string;
  onWireInput: (wire: string, caret: number) => void;
  adjustHeight: () => void;
  processFiles: (files: File[]) => Promise<void>;
  processPastedText: (paste: PastedTextAttachment) => Promise<void>;
  setIsComposing: (v: boolean) => void;
  kbdRef: MutableRefObject<ComposerKbdContext>;
  chatMessages: { clipboardFileTypeUnsupported: string };
}) {
  const isComposingRef = useRef(false);
  return (
    <div
      ref={editorRef}
      hidden={hidden}
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel ?? placeholder}
      contentEditable={!disabled}
      suppressContentEditableWarning
      spellCheck
      className={cn(
        'composer-input box-border m-0 max-h-32 min-h-16 w-full overflow-y-auto border-0 bg-transparent px-0 py-2 text-[0.9375rem] leading-6 text-fg focus:outline-none focus:ring-0 disabled:opacity-50',
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
          const pastedText = classifyPastedText(text);
          if (pastedText) {
            await processPastedText(pastedText);
            return;
          }
          document.execCommand('insertText', false, text);
        }
      }}
      onKeyDown={(e) => {
        const k = kbdRef.current;

        // 1. Pill-aware Backspace (handles single-char deletes that should swallow whole tokens).
        if (e.key === 'Backspace' && !k.isComposing && editorRef.current) {
          if (handleComposerBackspace(editorRef.current)) {
            e.preventDefault();
            return;
          }
        }

        // 2. Picker dispatch (at-mention takes priority, then slash palette).
        if (dispatchPickerKey(k.adapters, e)) {
          return;
        }

        // 3. Accept the contextual empty-state suggestion without interfering with picker Tab handling.
        if (
          e.key === 'Tab' &&
          !e.shiftKey &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey &&
          !k.isComposing &&
          !k.valueRef.current.trim() &&
          k.acceptEmptySuggestion?.()
        ) {
          e.preventDefault();
          return;
        }

        // 4. Input history walk (only when no picker open — adapters above already returned).
        if (!k.isComposing && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          const dir = e.key === 'ArrowUp' ? 'up' : 'down';
          if (k.tryInputHistoryArrow?.(dir)) {
            e.preventDefault();
            k.adjustHeight();
            return;
          }
        }

        // 5. Cancel editing of a queued follow-up.
        if (e.key === 'Escape' && !k.isComposing && k.editingFollowUpId) {
          e.preventDefault();
          k.onCancelEditFollowUp?.();
          return;
        }

        // 6. Newline.
        if (e.key === 'Enter' && e.shiftKey && !k.isComposing) {
          e.preventDefault();
          document.execCommand('insertText', false, '\n');
          return;
        }

        // 7. Send / steer / interrupt.
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
