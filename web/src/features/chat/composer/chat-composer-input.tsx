import { memo, useEffect, useRef, type MutableRefObject } from 'react';

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
import { applyComposerPaste, resolveComposerPaste } from '@/features/chat/composer/composer-paste';
import type { PastedTextAttachment } from '@xopcai/composer-core/pasted-text';
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
  contextRefsLen: number;
  isComposing: boolean;
  valueRef: MutableRefObject<string>;
  adjustHeight: () => void;
  editorRef: MutableRefObject<HTMLDivElement | null>;
  tryInputHistoryArrow?: (dir: 'up' | 'down') => boolean;
  acceptEmptySuggestion?: () => boolean;
  dismissEmptySuggestion?: () => void;
}

export const ChatComposerInput = memo(function ChatComposerInput({
  editorRef,
  disabled,
  hidden,
  compact = false,
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
  compact?: boolean;
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
  useEffect(() => {
    const el = editorRef.current;
    if (!el || disabled) return;
    const beforeInput = (event: InputEvent) => {
      if (event.inputType !== 'deleteContentBackward' || !event.cancelable
        || event.isComposing || isComposingRef.current) return;
      if (handleComposerBackspace(el)) event.preventDefault();
    };
    el.addEventListener('beforeinput', beforeInput);
    return () => el.removeEventListener('beforeinput', beforeInput);
  }, [disabled, editorRef]);
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
        'composer-input box-border m-0 w-full overflow-y-auto border-0 bg-transparent px-0 text-[0.9375rem] leading-6 text-fg focus:outline-none focus:ring-0 disabled:opacity-50',
        compact ? 'max-h-32 min-h-10 py-2' : 'max-h-24 min-h-12 py-1.5 sm:max-h-32 sm:min-h-16 sm:py-2',
        'composer-input-empty',
      )}
      data-placeholder={placeholder}
      onInput={(e) => {
        const el = e.currentTarget;
        let wire = isComposingRef.current ? serializeEditorToWire(el) : normalizeOrphanComposerDom(el);
        // Deleting the last character leaves a browser caret BR, not a draft newline.
        const inputType = e.nativeEvent.inputType;
        if (!isComposingRef.current && inputType?.startsWith('delete') && wire === '\n'
          && el.children.length === 1 && el.firstElementChild?.tagName === 'BR'
          && Array.from(el.childNodes).every(node => node === el.firstElementChild || (node.nodeType === Node.TEXT_NODE && !node.textContent))) {
          el.replaceChildren();
          wire = '';
        }
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
        const action = resolveComposerPaste(e.clipboardData);
        if (!action) return;

        e.preventDefault();
        await applyComposerPaste(action, {
          processFiles,
          processPastedText,
          insertText: (text) => document.execCommand('insertText', false, text),
          onUnsupportedFiles: () =>
            showComposerNotification('warning', chatMessages.clipboardFileTypeUnsupported),
        });
      }}
      onKeyDown={(e) => {
        const k = kbdRef.current;

        // 1. Pill-aware Backspace (handles single-char deletes that should swallow whole tokens).
        if (e.key === 'Backspace' && !k.isComposing && !isComposingRef.current && !e.nativeEvent.isComposing && editorRef.current) {
          if (handleComposerBackspace(editorRef.current)) {
            e.preventDefault();
            return;
          }
        }

        // 2. Picker dispatch (at-mention takes priority, then slash palette).
        if (dispatchPickerKey(k.adapters, e)) {
          return;
        }

        // 3. Accept the contextual empty-state suggestion after picker key handling.
        if (
          (e.key === 'Tab' || e.key === 'Enter') &&
          !e.shiftKey &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey &&
          !k.isComposing &&
          !isComposingRef.current && !e.nativeEvent.isComposing &&
          !disabled && !hidden && !k.runBusy && !k.pendingFollowUpsCount && !k.editingFollowUpId &&
          !k.attachmentsLen && !k.contextRefsLen && k.valueRef.current.length === 0 &&
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
        if (e.key === 'Escape' && !k.isComposing && !isComposingRef.current && k.valueRef.current.length === 0) {
          k.dismissEmptySuggestion?.();
        }
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
          const hasDraft = Boolean(
            k.valueRef.current.trim() || k.attachmentsLen > 0 || k.contextRefsLen > 0,
          );
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
