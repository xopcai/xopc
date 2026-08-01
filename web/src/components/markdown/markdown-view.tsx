import DOMPurify from 'dompurify';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import {
  parseProductReferenceDeepLink,
  productReferenceRoute,
} from '@xopcai/gateway-contract';

import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { parseMarkdown } from './parse-markdown';
import { recordStreamingParse } from './streaming-render-metrics';
import {
  linkWorkspaceFileMentions,
  openHttpLinksInNewTab,
  parseWorkspaceFileLinkTarget,
  rewriteXopcSettingsLinksInMarkdown,
  type WorkspaceFileLinkTarget,
} from './internal-links';
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

function findMermaidCodeBlocks(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('pre code.language-mermaid, pre code.hljs.language-mermaid'));
}

export function estimateMermaidPlaceholderHeight(code: string): number {
  const lineCount = Math.max(1, code.trim().split(/\r?\n/).length);
  return Math.min(360, Math.max(180, 120 + lineCount * 18));
}

function prepareMermaidShell(code: HTMLElement): HTMLElement | null {
  const pre = code.closest('pre');
  if (!pre?.parentNode) return null;
  const mountedCodeBlock = pre.closest<HTMLElement>('[data-md-code-block]');
  const shell = mountedCodeBlock ?? document.createElement('div');
  if (!mountedCodeBlock) {
    pre.parentNode.insertBefore(shell, pre);
    shell.appendChild(pre);
  }
  shell.classList.add('markdown-mermaid-shell', 'markdown-mermaid-pending');
  shell.style.setProperty(
    '--markdown-mermaid-placeholder-height',
    `${estimateMermaidPlaceholderHeight(code.textContent ?? '')}px`,
  );
  return shell;
}

function commitMermaidShell(
  shell: HTMLElement,
  renderedNode: Element,
  error: boolean,
): void {
  shell.replaceChildren(...Array.from(renderedNode.childNodes));
  shell.className = `${renderedNode.className} markdown-mermaid-shell`;
  shell.removeAttribute('data-md-code-block');
  shell.removeAttribute('data-mermaid-diagram');
  shell.removeAttribute('data-mermaid-fallback');
  shell.setAttribute(error ? 'data-mermaid-fallback' : 'data-mermaid-diagram', '');
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
  /** Called when a chat/workspace file link should open in the local preview pane. */
  onWorkspaceFileOpen?: (target: WorkspaceFileLinkTarget) => void;
  /** Opens HTTP(S) links in a separate browser tab or window. */
  openHttpLinksInNewTab?: boolean;
  /** Render Mermaid diagrams. Disabled while chat Markdown is still streaming. */
  renderMermaid?: boolean;
  /** Development-only stream identifier for parse timing metrics. */
  streamingMetricsKey?: string;
}

function MarkdownViewImpl({
  content,
  compact = false,
  breaks = false,
  className,
  codeCopy = true,
  onWorkspaceFileOpen,
  openHttpLinksInNewTab: shouldOpenHttpLinksInNewTab = false,
  renderMermaid = true,
  streamingMetricsKey,
}: MarkdownViewProps) {
  const language = useLocaleStore((s) => s.language);
  const labels = useMemo(() => {
    const m = messages(language).chat;
    return { copy: m.codeBlockCopy, copied: m.messageCopied };
  }, [language]);

  const safeHtml = useMemo(() => {
    if (!content.trim()) return '';
    const startedAt = streamingMetricsKey ? performance.now() : 0;
    const raw = parseMarkdown(rewriteXopcSettingsLinksInMarkdown(content), breaks ? { breaks: true } : undefined);
    const sanitized = DOMPurify.sanitize(raw, {
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
    if (streamingMetricsKey) {
      recordStreamingParse(streamingMetricsKey, performance.now() - startedAt);
    }
    return sanitized;
  }, [content, breaks, streamingMetricsKey]);

  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    unwrapMarkdownCodeBlocks(el);
    if (onWorkspaceFileOpen) {
      linkWorkspaceFileMentions(el);
    }

    if (!codeCopy || !safeHtml) return;

    return mountMarkdownCodeBlocks(el, labels);
  }, [codeCopy, safeHtml, labels, onWorkspaceFileOpen]);

  useLayoutEffect(() => {
    if (!shouldOpenHttpLinksInNewTab) return;
    const el = hostRef.current;
    if (!el) return;
    openHttpLinksInNewTab(el);
  }, [safeHtml, shouldOpenHttpLinksInNewTab]);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el || !safeHtml || !renderMermaid) return;

    const blocks = findMermaidCodeBlocks(el);
    if (blocks.length === 0) return;

    const pending = blocks
      .map((code) => ({ code, shell: prepareMermaidShell(code) }))
      .filter(
        (entry): entry is { code: HTMLElement; shell: HTMLElement } =>
          entry.shell !== null,
      );

    let cancelled = false;
    void import('./mermaid-render').then(({ renderMermaidBlock }) => {
      if (cancelled) return;
      for (const { code, shell } of pending) {
        if (!code.isConnected || !shell.isConnected) continue;
        const rendered = renderMermaidBlock(code.textContent ?? '');
        const template = document.createElement('template');
        template.innerHTML = rendered.html.trim();
        const node = template.content.firstElementChild;
        if (node) {
          commitMermaidShell(shell, node, rendered.error);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [renderMermaid, safeHtml]);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || !el.contains(anchor)) return;

      const filePath = anchor.dataset.xopcFilePath;
      if (filePath && onWorkspaceFileOpen) {
        event.preventDefault();
        const line = Number(anchor.dataset.xopcLine ?? '');
        onWorkspaceFileOpen({
          path: filePath,
          line: Number.isFinite(line) && line > 0 ? Math.floor(line) : undefined,
          kind: anchor.dataset.xopcFileKind === 'absolute' ? 'absolute' : 'workspace-relative',
        });
        return;
      }

      const href = anchor.getAttribute('href') ?? '';
      const productReference = parseProductReferenceDeepLink(href);
      if (productReference) {
        const route = productReferenceRoute({
          ...productReference,
          title: productReference.id,
          capabilities: ['open'],
        });
        if (route) {
          event.preventDefault();
          window.location.hash = `#${route}`;
          return;
        }
      }
      const fileTarget = onWorkspaceFileOpen ? parseWorkspaceFileLinkTarget(href) : null;
      if (fileTarget && onWorkspaceFileOpen) {
        event.preventDefault();
        onWorkspaceFileOpen(fileTarget);
        return;
      }

      if (href.startsWith('/settings/')) {
        event.preventDefault();
        window.location.hash = `#${href}`;
      }
    };

    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [onWorkspaceFileOpen]);

  return (
    <div ref={hostRef}>
      <div
        className={['markdown-body', compact ? 'markdown-compact' : '', className ?? ''].filter(Boolean).join(' ')}
        // safeHtml is sanitized via DOMPurify above; link behavior is applied only after sanitization.
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
