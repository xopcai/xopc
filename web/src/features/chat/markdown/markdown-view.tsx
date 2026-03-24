import DOMPurify from 'dompurify';
import { useMemo } from 'react';

import { parseMarkdown } from '@/features/chat/markdown/parse-markdown';

import '@/features/chat/markdown/markdown.css';

export function MarkdownView({ content }: { content: string }) {
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
