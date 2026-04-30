import DOMPurify from 'dompurify';
import { memo, useMemo } from 'react';

import { parseMarkdown } from './parse-markdown';
import './markdown.css';

let externalLinkHookRegistered = false;

function registerExternalMarkdownLinkHook(): void {
  if (externalLinkHookRegistered || typeof window === 'undefined') return;
  externalLinkHookRegistered = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName !== 'A' || !node.hasAttribute('href')) return;
    const href = node.getAttribute('href') ?? '';
    try {
      const resolved = new URL(href, window.location.href);
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
      if (resolved.origin === window.location.origin) return;
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    } catch {
      /* invalid URL */
    }
  });
}

registerExternalMarkdownLinkHook();

export interface MarkdownViewProps {
  content: string;
  /** Tighter heading/paragraph spacing for chat bubbles */
  compact?: boolean;
  /** GFM line breaks: single `\n` in paragraphs becomes `<br>` (chat-style wrapping). */
  breaks?: boolean;
  className?: string;
}

function MarkdownViewImpl({ content, compact = false, breaks = false, className }: MarkdownViewProps) {
  const safeHtml = useMemo(() => {
    if (!content.trim()) return '';
    const raw = parseMarkdown(content, breaks ? { breaks: true } : undefined);
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }, [content, breaks]);

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
