import DOMPurify from 'dompurify';
import { Copy, Check, Download, Maximize2 } from 'lucide-react';
import { memo, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { isMermaidSource } from '@/components/markdown/mermaid-source';
import { sanitizeMermaidHtml } from '@/components/markdown/markdown-sanitize';
import { createMermaidSnapshot, downloadMermaidPng } from '@/components/markdown/mermaid-export';
import { MermaidPreviewDialog, type MermaidPreviewState } from '@/components/markdown/mermaid-preview-dialog';
import { useInlinePreviewLease } from '@/features/chat/product-delivery/inline-preview-scheduler';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { richMarkupCache } from '../render-cache';

export const ChatCodeBlock = memo(function ChatCodeBlock({ code, language, incomplete, renderMermaid, actions, copy }: {
  code: string; language: string; incomplete: boolean; renderMermaid: boolean; actions: boolean; copy: boolean;
}) {
  const id = useId();
  const lease = useInlinePreviewLease(id);
  const svgRef = useRef<HTMLDivElement>(null);
  const [markup, setMarkup] = useState<{ key: string; value: string } | null>(null);
  const [preview, setPreview] = useState<MermaidPreviewState | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  const currentCode = useRef(code);
  const locale = useLocaleStore(s => s.language);
  const m = messages(locale).chat;
  const diagram = (language === 'mermaid' || (!language && isMermaidSource(code))) && renderMermaid && !incomplete;
  const cacheKey = `${diagram ? 'mermaid' : 'code'}:${language}:${code}`;

  useEffect(() => {
    if (incomplete || !lease.active || new TextEncoder().encode(code).byteLength > 100 * 1024) return;
    let current = true;
    setError(false);
    const cached = richMarkupCache.get(cacheKey);
    const task = cached !== undefined ? Promise.resolve(cached) : diagram
      ? import('@/components/markdown/mermaid-render').then(({ renderMermaidSvg }) => sanitizeMermaidHtml(renderMermaidSvg(code)))
      : import('./highlight-code').then(({ highlightCode }) => DOMPurify.sanitize(highlightCode(code, language), { ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'] }));
    void task.then(value => {
      if (!current) return;
      richMarkupCache.set(cacheKey, value);
      setMarkup({ key: cacheKey, value });
    }).catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [cacheKey, code, diagram, incomplete, language, lease.active, retryRevision]);

  useLayoutEffect(() => { currentCode.current = code; }, [code]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, []);

  const snapshot = () => {
    const host = svgRef.current;
    const svg = host?.querySelector('svg');
    return host && svg ? createMermaidSnapshot(svg, host) : null;
  };
  const visibleMarkup = markup?.key === cacheKey ? markup.value : null;
  const isDiagram = diagram && Boolean(visibleMarkup) && !error;
  const labels = {
    title: m.mermaidPreviewTitle, close: m.mermaidPreviewClose, zoomIn: m.mermaidZoomIn,
    zoomOut: m.mermaidZoomOut, fit: m.mermaidFit, downloadPng: m.mermaidDownloadPng,
    downloadSvg: m.mermaidDownloadSvg, downloadFailed: m.mermaidDownloadFailed,
  };

  return <div ref={lease.containerRef} className={isDiagram ? 'markdown-mermaid markdown-mermaid-interactive' : 'markdown-code-block'} data-mermaid-diagram={isDiagram ? '' : undefined}>
    {isDiagram ? <>
      <div ref={svgRef} dangerouslySetInnerHTML={{ __html: visibleMarkup! }} />
      {actions && <div className="markdown-mermaid-actions">
        <button type="button" className="markdown-mermaid-action-button" title={m.mermaidPreview} aria-label={m.mermaidPreview} onClick={() => {
          const value = snapshot(); if (value) setPreview({ snapshot: value, baseName: 'diagram' });
        }}><Maximize2 className="size-4" aria-hidden /></button>
        <button type="button" className="markdown-mermaid-action-button" title={m.mermaidDownloadPng} aria-label={m.mermaidDownloadPng} onClick={() => {
          const value = snapshot(); if (value) void downloadMermaidPng(value, 'diagram.png').catch(() => { if (mounted.current) setError(true); });
        }}><Download className="size-4" aria-hidden /></button>
      </div>}
    </> : <>
      <div className="markdown-code-block-header">
        <span className="markdown-code-block-lang">{language || 'text'}</span>
        {diagram && <button type="button" className="markdown-code-copy-btn" title={m.mermaidPreview} aria-label={m.mermaidPreview} onClick={() => {
          lease.activate(); setRetryRevision(n => n + 1);
        }}><Maximize2 /></button>}
        {copy && <button type="button" className="markdown-code-copy-btn" title={copied ? m.messageCopied : m.codeBlockCopy} aria-label={copied ? m.messageCopied : m.codeBlockCopy} onClick={() => {
          void copyTextToClipboard(code).then(ok => {
            if (!ok || !mounted.current || currentCode.current !== code) return;
            setCopied(true);
            if (copyTimer.current) clearTimeout(copyTimer.current);
            copyTimer.current = setTimeout(() => setCopied(false), 2000);
          });
        }}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</button>}
      </div>
      <pre><code className={`hljs${language ? ` language-${language}` : ''}`}>
        {visibleMarkup && !diagram ? <span dangerouslySetInnerHTML={{ __html: visibleMarkup }} /> : code}
      </code></pre>
      {error && diagram && <p className="markdown-mermaid-error-message" role="status">{m.mermaidRenderError}</p>}
    </>}
    <MermaidPreviewDialog preview={preview} labels={labels} onClose={() => setPreview(null)} />
  </div>;
});
