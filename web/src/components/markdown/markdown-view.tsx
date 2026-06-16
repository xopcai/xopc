import DOMPurify from 'dompurify';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';

import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

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

/** Lucide-style 14px icons for DOM-injected code-copy control (keeps bundle self-contained here). */
const ICON_COPY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

const ICON_CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

function getCodeTextFromPre(pre: HTMLPreElement): string {
  return pre.querySelector('code')?.textContent ?? pre.textContent ?? '';
}

function languageLabelFromPre(pre: HTMLPreElement): string {
  const code = pre.querySelector('code');
  if (!code?.className) return 'plaintext';
  for (const c of code.className.split(/\s+/)) {
    if (c.startsWith('language-')) {
      const id = c.slice('language-'.length).trim();
      return id || 'plaintext';
    }
  }
  return 'plaintext';
}

function buildCopyButtonContent(mode: 'idle' | 'copied', labels: { copy: string; copied: string }): DocumentFragment {
  const frag = document.createDocumentFragment();
  const iconWrap = document.createElement('span');
  iconWrap.className = 'markdown-code-copy-inner';
  iconWrap.innerHTML = mode === 'idle' ? ICON_COPY_SVG : ICON_CHECK_SVG;
  const label = document.createElement('span');
  label.className = 'markdown-code-copy-label';
  label.textContent = mode === 'idle' ? labels.copy : labels.copied;
  frag.appendChild(iconWrap);
  frag.appendChild(label);
  return frag;
}

function unwrapMarkdownCodeBlocks(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-md-code-block]').forEach((wrap) => {
    const pre = wrap.querySelector(':scope > pre');
    const parent = wrap.parentNode;
    if (pre && parent) {
      parent.insertBefore(pre, wrap);
      wrap.remove();
    }
  });
}

function mountMarkdownCodeBlocks(root: HTMLElement, labels: { copy: string; copied: string }): () => void {
  const pres = root.querySelectorAll<HTMLPreElement>('.markdown-body pre');
  const disposers: Array<() => void> = [];

  for (const pre of pres) {
    if (pre.closest('[data-md-code-block]')) continue;
    if (pre.closest('[data-mermaid-fallback]')) continue;
    const parent = pre.parentNode;
    if (!parent) continue;

    const wrapper = document.createElement('div');
    wrapper.className = 'markdown-code-block';
    wrapper.setAttribute('data-md-code-block', '');

    const header = document.createElement('div');
    header.className = 'markdown-code-block-header';

    const lang = document.createElement('span');
    lang.className = 'markdown-code-block-lang';
    lang.textContent = languageLabelFromPre(pre);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'markdown-code-copy-btn';
    btn.dataset.mdCodeCopy = '';
    btn.title = labels.copy;
    btn.setAttribute('aria-label', labels.copy);
    btn.replaceChildren(buildCopyButtonContent('idle', labels));

    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const raw = getCodeTextFromPre(pre);
      void copyTextToClipboard(raw).then((ok) => {
        if (!ok || !btn.isConnected) return;
        btn.replaceChildren(buildCopyButtonContent('copied', labels));
        btn.title = labels.copied;
        btn.setAttribute('aria-label', labels.copied);
        window.setTimeout(() => {
          if (!btn.isConnected) return;
          btn.replaceChildren(buildCopyButtonContent('idle', labels));
          btn.title = labels.copy;
          btn.setAttribute('aria-label', labels.copy);
        }, 2000);
      });
    };

    btn.addEventListener('click', onClick);
    header.appendChild(lang);
    header.appendChild(btn);
    wrapper.appendChild(header);
    parent.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    disposers.push(() => {
      btn.removeEventListener('click', onClick);
      const w = pre.parentElement;
      if (w?.matches('[data-md-code-block]') && w.parentNode) {
        w.parentNode.insertBefore(pre, w);
        w.remove();
      }
    });
  }

  return () => {
    for (const d of disposers) d();
  };
}

export interface MarkdownViewProps {
  content: string;
  /** Tighter heading/paragraph spacing for chat bubbles */
  compact?: boolean;
  /** GFM line breaks: single `\n` in paragraphs becomes `<br>` (chat-style wrapping). */
  breaks?: boolean;
  className?: string;
  /** When true (default), fenced code blocks get a copy-to-clipboard control. */
  codeCopy?: boolean;
}

function MarkdownViewImpl({
  content,
  compact = false,
  breaks = false,
  className,
  codeCopy = true,
}: MarkdownViewProps) {
  const language = useLocaleStore((s) => s.language);
  const labels = useMemo(() => {
    const m = messages(language).chat;
    return { copy: m.codeBlockCopy, copied: m.messageCopied };
  }, [language]);

  const safeHtml = useMemo(() => {
    if (!content.trim()) return '';
    const raw = parseMarkdown(content, breaks ? { breaks: true } : undefined);
    return DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true, svg: true },
      ADD_ATTR: [
        'viewBox', 'xmlns', 'd', 'fill', 'stroke', 'transform',
        'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
        'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r',
        'x1', 'y1', 'x2', 'y2', 'offset', 'stop-color', 'stop-opacity',
        'points', 'text-anchor', 'dominant-baseline', 'font-size',
        'font-family', 'font-weight', 'font-style', 'class', 'id', 'style',
        'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits',
        'text-decoration', 'opacity', 'clip-path', 'mask', 'filter',
        'preserveAspectRatio', 'xmlns:xlink', 'xlink:href', 'xml:space',
      ],
    });
  }, [content, breaks]);

  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    unwrapMarkdownCodeBlocks(el);

    if (!codeCopy || !safeHtml) return;

    return mountMarkdownCodeBlocks(el, labels);
  }, [codeCopy, safeHtml, labels]);

  return (
    <div ref={hostRef}>
      <div
        className={['markdown-body', compact ? 'markdown-compact' : '', className ?? ''].filter(Boolean).join(' ')}
        // safeHtml is sanitized via DOMPurify above; the external-link hook hardens cross-origin anchors.
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    </div>
  );
}

/**
 * Read-only markdown renderer. Memo avoids re-parse when sibling bubbles re-render during streaming.
 */
export const MarkdownView = memo(MarkdownViewImpl);
MarkdownView.displayName = 'MarkdownView';
