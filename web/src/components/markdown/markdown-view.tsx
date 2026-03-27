import DOMPurify from 'dompurify';
import { memo, useMemo } from 'react';

import { parseMarkdown } from './parse-markdown';
import './markdown.css';

export interface MarkdownViewProps {
  content: string;
  /** Tighter heading/paragraph spacing for chat bubbles */
  compact?: boolean;
  className?: string;
}

function MarkdownViewImpl({ content, compact = false, className }: MarkdownViewProps) {
  const safeHtml = useMemo(() => {
    if (!content.trim()) return '';
    const raw = parseMarkdown(content);
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }, [content]);

  return (
    <div
      className={['markdown-body', compact ? 'markdown-compact' : '', className ?? ''].filter(Boolean).join(' ')}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

/**
 * Read-only markdown renderer. Memo avoids re-parse when sibling bubbles re-render during streaming.
 */
export const MarkdownView = memo(MarkdownViewImpl);
MarkdownView.displayName = 'MarkdownView';
