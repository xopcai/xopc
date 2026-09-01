import DOMPurify from 'dompurify';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  decorateAppLinks,
  rewriteSupportedAppLinksInMarkdown,
} from '@/lib/app-link';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { useAppLinkOpener } from '@/lib/use-app-link-opener';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { parseMarkdown } from './parse-markdown';
import { recordStreamingParse } from './streaming-render-metrics';
import {
  linkWorkspaceFileMentions,
  parseWorkspaceFileLinkTarget,
  rewriteWorkspaceFileLinksInMarkdown,
  type WorkspaceFileLinkTarget,
} from './internal-links';
import { createMermaidSnapshot, downloadMermaidPng } from './mermaid-export';
import { renderMermaidSvg } from './mermaid-render';
import {
  MermaidPreviewDialog,
  type MermaidPreviewLabels,
  type MermaidPreviewState,
} from './mermaid-preview-dialog';
import './markdown.css';

/** Lucide-style 14px icons for DOM-injected code-copy control (keeps bundle self-contained here). */
const ICON_COPY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

const ICON_CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

const ICON_DOWNLOAD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>';

const ICON_MAXIMIZE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg>';

const FORBIDDEN_MARKDOWN_TAGS = [
  'base',
  'button',
  'embed',
  'form',
  'iframe',
  'input',
  'link',
  'meta',
  'object',
  'option',
  'select',
  'style',
  'template',
  'textarea',
];

const FORBIDDEN_MARKDOWN_ATTRIBUTES = [
  'action',
  'formaction',
  'id',
  'name',
  'srcdoc',
  'style',
];

function sanitizeMarkdownHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: FORBIDDEN_MARKDOWN_TAGS,
    FORBID_ATTR: FORBIDDEN_MARKDOWN_ATTRIBUTES,
  });
}

function sanitizeMermaidHtml(html: string): string {
  const withoutRemoteImports = html.replace(/@import\s+url\([^)]*\)\s*;?/gi, '');
  return DOMPurify.sanitize(withoutRemoteImports, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'script'],
    FORBID_ATTR: ['href', 'xlink:href'],
  });
}

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

function prepareMermaidShell(code: HTMLElement): HTMLElement | null {
  const pre = code.closest('pre');
  if (!pre?.parentNode) return null;
  const mountedCodeBlock = pre.closest<HTMLElement>('[data-md-code-block]');
  const shell = mountedCodeBlock ?? document.createElement('div');
  if (!mountedCodeBlock) {
    pre.parentNode.insertBefore(shell, pre);
    shell.appendChild(pre);
  }
  shell.classList.add('markdown-mermaid-shell');
  return shell;
}

function commitMermaidDiagram(shell: HTMLElement, svg: SVGElement): void {
  shell.replaceChildren(svg);
  shell.className = 'markdown-mermaid markdown-mermaid-shell';
  shell.removeAttribute('data-md-code-block');
  shell.setAttribute('data-mermaid-diagram', '');
}

function commitMermaidError(shell: HTMLElement, label: string, error: unknown): void {
  const message = document.createElement('div');
  message.className = 'markdown-mermaid-error-message';
  message.setAttribute('role', 'alert');
  message.textContent = label;
  if (error instanceof Error && error.message) message.title = error.message;

  shell.replaceChildren(message);
  shell.className = 'markdown-mermaid markdown-mermaid-error markdown-mermaid-shell';
  shell.removeAttribute('data-md-code-block');
  shell.setAttribute('data-mermaid-error', '');
}

type MermaidInlineActionLabels = {
  preview: string;
  downloadPng: string;
  downloadFailed: string;
};

function createMermaidActionButton(label: string, icon: string, action: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'markdown-mermaid-action-button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.dataset.mermaidAction = action;
  button.innerHTML = icon;
  return button;
}

function mountMermaidActions(
  shell: HTMLElement,
  diagramIndex: number,
  labels: MermaidInlineActionLabels,
  onPreview: (preview: MermaidPreviewState) => void,
): () => void {
  const svg = shell.querySelector<SVGSVGElement>('svg');
  if (!svg) return () => {};

  const baseName = `mermaid-diagram-${diagramIndex + 1}`;
  const actions = document.createElement('div');
  actions.className = 'markdown-mermaid-actions';
  const downloadButton = createMermaidActionButton(labels.downloadPng, ICON_DOWNLOAD_SVG, 'download-png');
  const previewButton = createMermaidActionButton(labels.preview, ICON_MAXIMIZE_SVG, 'preview');
  actions.append(downloadButton, previewButton);
  shell.appendChild(actions);
  shell.classList.add('markdown-mermaid-interactive');

  const buildPreview = (): MermaidPreviewState => ({
    snapshot: createMermaidSnapshot(svg, shell),
    baseName,
  });
  const openPreview = () => onPreview(buildPreview());
  const onPreviewClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    openPreview();
  };
  const onDownloadClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (downloadButton.disabled) return;
    downloadButton.disabled = true;
    downloadButton.title = labels.downloadPng;
    downloadButton.setAttribute('aria-label', labels.downloadPng);
    downloadButton.setAttribute('aria-busy', 'true');
    void downloadMermaidPng(buildPreview().snapshot, `${baseName}.png`)
      .catch(() => {
        downloadButton.title = labels.downloadFailed;
        downloadButton.setAttribute('aria-label', labels.downloadFailed);
      })
      .finally(() => {
        if (!downloadButton.isConnected) return;
        downloadButton.disabled = false;
        downloadButton.removeAttribute('aria-busy');
      });
  };
  const onShellClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('svg') && !target.closest('.markdown-mermaid-actions')) {
      openPreview();
    }
  };

  previewButton.addEventListener('click', onPreviewClick);
  downloadButton.addEventListener('click', onDownloadClick);
  shell.addEventListener('click', onShellClick);

  return () => {
    previewButton.removeEventListener('click', onPreviewClick);
    downloadButton.removeEventListener('click', onDownloadClick);
    shell.removeEventListener('click', onShellClick);
    actions.remove();
    shell.classList.remove('markdown-mermaid-interactive');
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
  /** Called when a chat/workspace file link should open in the local preview pane. */
  onWorkspaceFileOpen?: (target: WorkspaceFileLinkTarget) => void;
  /** Convert fenced Mermaid blocks to diagrams. */
  renderMermaid?: boolean;
  /** Add preview and image download actions to rendered Mermaid diagrams. */
  mermaidActions?: boolean;
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
  renderMermaid = true,
  mermaidActions = false,
  streamingMetricsKey,
}: MarkdownViewProps) {
  const openAppLink = useAppLinkOpener();
  const language = useLocaleStore((s) => s.language);
  const labels = useMemo(() => {
    const m = messages(language).chat;
    return {
      copy: m.codeBlockCopy,
      copied: m.messageCopied,
      mermaidRenderError: m.mermaidRenderError,
      mermaidInline: {
        preview: m.mermaidPreview,
        downloadPng: m.mermaidDownloadPng,
        downloadFailed: m.mermaidDownloadFailed,
      },
      mermaidPreview: {
        title: m.mermaidPreviewTitle,
        close: m.mermaidPreviewClose,
        zoomIn: m.mermaidZoomIn,
        zoomOut: m.mermaidZoomOut,
        fit: m.mermaidFit,
        downloadPng: m.mermaidDownloadPng,
        downloadSvg: m.mermaidDownloadSvg,
        downloadFailed: m.mermaidDownloadFailed,
      } satisfies MermaidPreviewLabels,
    };
  }, [language]);

  const safeHtml = useMemo(() => {
    if (!content.trim()) return '';
    const startedAt = streamingMetricsKey ? performance.now() : 0;
    const normalized = rewriteWorkspaceFileLinksInMarkdown(rewriteSupportedAppLinksInMarkdown(content));
    const raw = parseMarkdown(normalized, breaks ? { breaks: true } : undefined);
    const sanitized = sanitizeMarkdownHtml(raw);
    if (streamingMetricsKey) {
      recordStreamingParse(streamingMetricsKey, performance.now() - startedAt);
    }
    return sanitized;
  }, [content, breaks, streamingMetricsKey]);

  const hostRef = useRef<HTMLDivElement>(null);
  const [mermaidPreview, setMermaidPreview] = useState<MermaidPreviewState | null>(null);
  const openMermaidPreview = useCallback((preview: MermaidPreviewState) => {
    setMermaidPreview(preview);
  }, []);

  useEffect(() => {
    setMermaidPreview(null);
  }, [safeHtml]);

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
    const el = hostRef.current;
    if (el) decorateAppLinks(el);
  }, [safeHtml]);

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

    for (const { code, shell } of pending) {
      try {
        const template = document.createElement('template');
        template.innerHTML = sanitizeMermaidHtml(renderMermaidSvg(code.textContent ?? '')).trim();
        const svg = template.content.firstElementChild;
        if (!(svg instanceof SVGElement)) throw new Error('Mermaid renderer returned invalid SVG');

        commitMermaidDiagram(shell, svg);
      } catch (error) {
        console.error('[markdown:mermaid] render failed', error);
        commitMermaidError(shell, labels.mermaidRenderError, error);
      }
    }
  }, [labels.mermaidRenderError, renderMermaid, safeHtml]);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el || !mermaidActions) return;

    const actionDisposers = Array.from(
      el.querySelectorAll<HTMLElement>('[data-mermaid-diagram]'),
      (shell, index) => mountMermaidActions(
        shell,
        index,
        labels.mermaidInline,
        openMermaidPreview,
      ),
    );

    return () => {
      for (const dispose of actionDisposers) dispose();
    };
  }, [labels.mermaidInline, mermaidActions, openMermaidPreview, renderMermaid, safeHtml]);

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
      const fileTarget = onWorkspaceFileOpen ? parseWorkspaceFileLinkTarget(href) : null;
      if (fileTarget && onWorkspaceFileOpen) {
        event.preventDefault();
        onWorkspaceFileOpen(fileTarget);
        return;
      }

      event.preventDefault();
      void openAppLink(href);
    };

    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [onWorkspaceFileOpen, openAppLink]);

  return (
    <>
      <div ref={hostRef} className="markdown-render-boundary">
        <div
          className={['markdown-body', compact ? 'markdown-compact' : '', className ?? ''].filter(Boolean).join(' ')}
          // safeHtml is sanitized via DOMPurify above; link behavior is applied only after sanitization.
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      </div>
      {mermaidActions ? (
        <MermaidPreviewDialog
          preview={mermaidPreview}
          labels={labels.mermaidPreview}
          onClose={() => setMermaidPreview(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Read-only markdown renderer. Memo avoids re-parse when sibling bubbles re-render during streaming.
 */
export const MarkdownView = memo(MarkdownViewImpl);
MarkdownView.displayName = 'MarkdownView';
