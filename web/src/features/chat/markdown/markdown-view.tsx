import DOMPurify from 'dompurify';
import { memo, useMemo } from 'react';

import { parseMarkdown } from '@/features/chat/markdown/parse-markdown';

import '@/features/chat/markdown/markdown.css';

function MarkdownViewImpl({ content }: { content: string }) {
  const safe = useMemo(() => {
    if (!content.trim()) return '';
    const raw = parseMarkdown(content);
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }, [content]);

  if (!safe) {
    return <div className="markdown-body" />;
  }

  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: safe }} />;
}

/** Pure markdown render — memo avoids DOMPurify + parse when sibling bubbles re-render (e.g. streaming). */
export const MarkdownView = memo(MarkdownViewImpl);
MarkdownView.displayName = 'MarkdownView';
