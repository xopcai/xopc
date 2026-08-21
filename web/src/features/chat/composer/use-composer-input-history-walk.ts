// Up/Down arrow recall of previously-sent messages for the current session,
// modeled after a shell history walk. State lives in a ref so unrelated
// re-renders don't disturb the walk; a wire-input event (real user typing)
// clears the walk so subsequent arrow presses start fresh.

import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';

import { getWireCaretOffset } from '@/features/chat/composer/composer-editor-wire';
import {
  applyComposerHistoryAppended,
  applyComposerHistoryCleared,
  getComposerInputHistory,
  loadComposerInputHistory,
  recordComposerInputHistory,
} from '@/features/chat/composer/composer-input-history';
import type { ResetEditorOptions } from '@/features/chat/composer/composer.types';

export function useComposerInputHistoryWalk(opts: {
  sessionKey: string | null;
  editorRef: MutableRefObject<HTMLDivElement | null>;
  valueRef: MutableRefObject<string>;
  resetEditor: (opts?: ResetEditorOptions) => void;
  onWireInput: (wire: string, caret: number) => void;
}): {
  onUserTextCommitted: (text: string) => void;
  onWireInputClearWalk: (wire: string, caret: number) => void;
  tryInputHistoryArrow: (dir: 'up' | 'down') => boolean;
} {
  const { sessionKey, editorRef, valueRef, resetEditor, onWireInput } = opts;

  const walkRef = useRef<{ index: number; stash: string } | null>(null);

  const clearWalk = useCallback(() => {
    walkRef.current = null;
  }, []);

  useEffect(() => {
    clearWalk();
  }, [sessionKey, clearWalk]);

  useEffect(() => {
    void loadComposerInputHistory();
    const onAppend = (event: Event) => {
      applyComposerHistoryAppended((event as CustomEvent).detail);
      clearWalk();
    };
    const onClear = () => {
      applyComposerHistoryCleared();
      clearWalk();
    };
    const onReconnect = () => void loadComposerInputHistory(true);
    window.addEventListener('composer-history-appended', onAppend);
    window.addEventListener('composer-history-cleared', onClear);
    window.addEventListener('gateway-realtime-connected', onReconnect);
    return () => {
      window.removeEventListener('composer-history-appended', onAppend);
      window.removeEventListener('composer-history-cleared', onClear);
      window.removeEventListener('gateway-realtime-connected', onReconnect);
    };
  }, [clearWalk]);

  const onUserTextCommitted = useCallback(
    (text: string) => {
      recordComposerInputHistory(text);
      clearWalk();
    },
    [clearWalk],
  );

  const onWireInputClearWalk = useCallback(
    (wire: string, caret: number) => {
      walkRef.current = null;
      onWireInput(wire, caret);
    },
    [onWireInput],
  );

  const tryInputHistoryArrow = useCallback(
    (dir: 'up' | 'down'): boolean => {
      const history = getComposerInputHistory();
      if (history.length === 0) return false;

      const walk = walkRef.current;
      const el = editorRef.current;
      const caret = el ? getWireCaretOffset(el) : 0;
      const value = valueRef.current;

      if (dir === 'up') {
        if (walk == null) {
          if (caret !== 0) return false;
          walkRef.current = { index: 0, stash: value };
          const line = history[0];
          if (!line) return false;
          resetEditor({ nextText: line, caretOffset: line.length, focus: true });
          return true;
        }
        if (walk.index >= history.length - 1) return true;
        walk.index += 1;
        const line = history[walk.index];
        if (!line) return false;
        resetEditor({ nextText: line, caretOffset: line.length, focus: true });
        return true;
      }

      if (walk == null) return false;
      walk.index -= 1;
      if (walk.index < 0) {
        const stash = walk.stash;
        walkRef.current = null;
        resetEditor({ nextText: stash, caretOffset: stash.length, focus: true });
        return true;
      }
      const line = history[walk.index];
      if (!line) return false;
      resetEditor({ nextText: line, caretOffset: line.length, focus: true });
      return true;
    },
    [editorRef, valueRef, resetEditor],
  );

  return { onUserTextCommitted, onWireInputClearWalk, tryInputHistoryArrow };
}
