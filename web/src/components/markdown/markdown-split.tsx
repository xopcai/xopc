import { useCallback, useEffect, useState } from 'react';
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
  const [content, setContent] = useState(initialContent);

  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  const triggerSave = useDebouncedCallback((value: string) => {
    onSave?.(value);
  }, 500);

  const handleChange = useCallback(
    (value: string) => {
      setContent(value);
      triggerSave(value);
    },
    [triggerSave],
  );

  return (
    <div className="flex h-full divide-x divide-edge">
      <div className="min-w-0 flex-1 overflow-hidden">
        <MarkdownEditor initialContent={initialContent} onChange={handleChange} isDark={isDark} />
      </div>
      <div className="bg-surface min-w-0 flex-1 overflow-y-auto px-6 py-4">
        <MarkdownView content={content} />
      </div>
    </div>
  );
}
