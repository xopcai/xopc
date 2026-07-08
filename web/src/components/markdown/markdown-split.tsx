import { useCallback, useMemo } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import type { KeyBinding } from '@codemirror/view';

import { MarkdownEditor } from './markdown-editor';

export interface MarkdownSplitProps {
  initialContent: string;
  /** Debounced (500ms) callback for persistence / file write. */
  onSave?: (content: string) => void;
  isDark?: boolean;
  wordWrap?: boolean;
  onToggleWordWrap?: () => void;
}

export function MarkdownSplit({
  initialContent,
  onSave,
  isDark = false,
  wordWrap = false,
  onToggleWordWrap,
}: MarkdownSplitProps) {
  const triggerSave = useDebouncedCallback((value: string) => {
    onSave?.(value);
  }, 500);

  const handleEditorChange = useCallback(
    (value: string) => {
      triggerSave(value);
    },
    [triggerSave],
  );
  const keyBindings = useMemo<readonly KeyBinding[]>(
    () => [
      {
        key: 'Alt-z',
        run: () => {
          onToggleWordWrap?.();
          return true;
        },
      },
    ],
    [onToggleWordWrap],
  );

  return (
    <div className="h-full min-w-0 overflow-hidden">
      <MarkdownEditor
        initialContent={initialContent}
        onChange={handleEditorChange}
        isDark={isDark}
        lineWrap={wordWrap}
        keyBindings={keyBindings}
      />
    </div>
  );
}
