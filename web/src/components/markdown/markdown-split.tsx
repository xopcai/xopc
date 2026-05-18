import { useCallback, useState } from 'react';
import { useDebouncedCallback } from 'use-debounce';

import { MarkdownEditor } from './markdown-editor';
import { MarkdownView } from './markdown-view';

export interface MarkdownSplitProps {
  initialContent: string;
  /** Debounced (500ms) callback for persistence / file write. */
  onSave?: (content: string) => void;
  isDark?: boolean;
}

export function MarkdownSplit({ initialContent, onSave, isDark = false }: MarkdownSplitProps) {
  // Parent (file-preview-body) passes `key={fileKey}` which remounts on file switch,
  // so we don't need an effect to sync `initialContent` into local state.
  const [content, setContent] = useState(() => initialContent);

  const triggerSave = useDebouncedCallback((value: string) => {
    onSave?.(value);
  }, 500);

  const handleEditorChange = useCallback(
    (value: string) => {
      setContent(value);
      triggerSave(value);
    },
    [triggerSave],
  );

  return (
    <div className="flex h-full divide-x divide-edge">
      <div className="min-w-0 flex-1 overflow-hidden">
        <MarkdownEditor initialContent={initialContent} onChange={handleEditorChange} isDark={isDark} />
      </div>
      <div className="bg-surface min-w-0 flex-1 overflow-y-auto px-6 py-4">
        <MarkdownView content={content} />
      </div>
    </div>
  );
}
