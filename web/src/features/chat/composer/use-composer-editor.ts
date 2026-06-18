import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';

import { applyWireToEditor, getWireCaretOffset } from '@/features/chat/composer/composer-editor-wire';
import type { ResetEditorOptions } from '@/features/chat/composer/composer.types';
import { FILL_CHAT_COMPOSER_EVENT, type FillChatComposerDetail } from '@/features/chat/composer/fill-composer-dispatch';

const TEXTAREA_MAX_HEIGHT_PX = 128;

export function syncComposerPlaceholderClass(el: HTMLElement, wire: string): void {
  el.classList.toggle('composer-input-empty', wire.length === 0);
}

export interface UseComposerEditorOptions {
  disabled: boolean;
  /** Route/session identity that should focus the editor when it changes. */
  autoFocusKey?: string | null;
  /** Fills the editor when user picks a welcome scenario. */
  welcomeDraftSeed?: { id: number; text: string } | null;
  /** Run before full text replacement (welcome, fill) — e.g. clear attachments. */
  onExternalTextReplace?: () => void;
  /**
   * Parent sets each render: `palette.open || atPicker.open || atRange != null`
   * so selection-driven cursor state stays in sync when pickers are open.
   */
  shouldSyncSelectionRef: MutableRefObject<boolean>;
}

export interface UseComposerEditorReturn {
  value: string;
  cursor: number;
  isComposing: boolean;
  setIsComposing: (v: boolean) => void;

  editorRef: MutableRefObject<HTMLDivElement | null>;
  valueRef: MutableRefObject<string>;

  setValue: (v: string) => void;
  setCursor: (c: number) => void;
  adjustHeight: () => void;
  resetEditor: (opts?: ResetEditorOptions) => void;
  onWireInput: (wire: string, caret: number) => void;
}

export function useComposerEditor(options: UseComposerEditorOptions): UseComposerEditorReturn {
  const { disabled, autoFocusKey, welcomeDraftSeed, onExternalTextReplace, shouldSyncSelectionRef } = options;

  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const valueRef = useRef(value);
  const cursorRef = useRef(cursor);
  const lastWelcomeDraftIdRef = useRef(0);

  const pendingFocusAfterEnableRef = useRef(true);
  const lastAutoFocusKeyRef = useRef<string | null>(null);

  valueRef.current = value;
  cursorRef.current = cursor;

  const adjustHeight = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`;
  }, []);

  const resetEditor = useCallback(
    (opts?: ResetEditorOptions) => {
      const nextText = opts?.nextText ?? '';
      const caretOffset = opts?.caretOffset ?? nextText.length;

      setValue(nextText);
      valueRef.current = nextText;
      setCursor(caretOffset);

      requestAnimationFrame(() => {
        const el = editorRef.current;
        if (el) {
          applyWireToEditor(el, nextText, caretOffset);
          syncComposerPlaceholderClass(el, nextText);
          if (opts?.focus) el.focus({ preventScroll: true });
        }
        adjustHeight();
      });
    },
    [adjustHeight],
  );

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const trackedWelcomeRef = useRef(welcomeDraftSeed?.id ?? 0);
  if (welcomeDraftSeed && welcomeDraftSeed.id !== trackedWelcomeRef.current) {
    trackedWelcomeRef.current = welcomeDraftSeed.id;
    lastWelcomeDraftIdRef.current = welcomeDraftSeed.id;
    onExternalTextReplace?.();
    resetEditor({ nextText: welcomeDraftSeed.text, focus: true });
  }

  useLayoutEffect(() => {
    if (disabled) {
      pendingFocusAfterEnableRef.current = true;
      return;
    }

    const focusKey = autoFocusKey ?? null;
    const shouldFocusAfterEnable = pendingFocusAfterEnableRef.current;
    const shouldFocusForRoute = focusKey != null && focusKey !== lastAutoFocusKeyRef.current;
    if (!shouldFocusAfterEnable && !shouldFocusForRoute) return;

    pendingFocusAfterEnableRef.current = false;
    if (focusKey != null) lastAutoFocusKeyRef.current = focusKey;

    const id = requestAnimationFrame(() => {
      const allowAutoFocus =
        typeof globalThis.matchMedia === 'function' &&
        globalThis.matchMedia('(hover: hover) and (pointer: fine)').matches;
      if (!allowAutoFocus) return;
      editorRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [disabled, autoFocusKey]);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    let listening = false;
    let rafId: number | null = null;
    let queued = false;
    let lastOffset = -1;

    const flush = () => {
      rafId = null;
      queued = false;
      if (document.activeElement !== el) return;
      const next = getWireCaretOffset(el);
      cursorRef.current = next;
      if (next === lastOffset) return;
      lastOffset = next;
      if (!shouldSyncSelectionRef.current) return;
      setCursor(next);
    };

    const onSelectionChange = () => {
      if (!listening) return;
      if (queued) return;
      queued = true;
      rafId = requestAnimationFrame(flush);
    };

    const attach = () => {
      if (listening) return;
      listening = true;
      document.addEventListener('selectionchange', onSelectionChange);
      onSelectionChange();
    };

    const detach = () => {
      if (!listening) return;
      listening = false;
      document.removeEventListener('selectionchange', onSelectionChange);
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = null;
      queued = false;
    };

    const onFocus = () => attach();
    const onBlur = () => detach();

    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);

    if (document.activeElement === el) attach();

    return () => {
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', onBlur);
      detach();
    };
  }, [shouldSyncSelectionRef]);

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<FillChatComposerDetail>).detail;
      if (typeof d?.text !== 'string' || d.text.length === 0) return;
      onExternalTextReplace?.();
      resetEditor({ nextText: d.text, focus: true });
    };
    window.addEventListener(FILL_CHAT_COMPOSER_EVENT, handler);
    return () => window.removeEventListener(FILL_CHAT_COMPOSER_EVENT, handler);
  }, [onExternalTextReplace, resetEditor]);

  const onWireInput = useCallback((wire: string, caret: number) => {
    valueRef.current = wire;
    setValue(wire);
    setCursor(caret);
  }, []);

  return {
    value,
    cursor,
    isComposing,
    setIsComposing,
    editorRef,
    valueRef,
    setValue,
    setCursor,
    adjustHeight,
    resetEditor,
    onWireInput,
  };
}

export { TEXTAREA_MAX_HEIGHT_PX };
