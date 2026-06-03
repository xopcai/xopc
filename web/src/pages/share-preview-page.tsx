import { Download, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { PptxPreviewView } from '@/features/preview/pptx-preview-view';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

interface ShareMeta {
  kind: 'file' | 'directory';
  fileName: string;
  fileSize: number;
  mimeType: string;
  description: string | null;
  expiresAt: string;
  remainingViews: number | null;
  valid: boolean;
}

type PreviewKind = 'markdown' | 'text' | 'json' | 'pdf-or-image' | 'docx' | 'pptx' | 'unknown';

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

// 32 MB hard cap on client-side binary preview — beyond that the browser
// would chug, so we direct the user to download instead.
const BINARY_PREVIEW_MAX_BYTES = 32 * 1024 * 1024;
// 5 MB cap on inline text — markdown/json/text fetched via fetch.text().
const TEXT_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

function previewKindFor(mime: string): PreviewKind {
  if (mime === 'text/markdown') return 'markdown';
  if (mime === 'text/plain') return 'text';
  if (mime === 'application/json') return 'json';
  if (mime === 'application/pdf' || mime.startsWith('image/')) return 'pdf-or-image';
  if (mime === MIME_DOCX) return 'docx';
  if (mime === MIME_PPTX) return 'pptx';
  return 'unknown';
}

/**
 * Public share preview — reachable at hash route `/share/:token`.
 *
 * Runs OUTSIDE `AppShell` so it does not require the gateway token; it talks
 * only to the public `/s/:token/*` endpoints. The route renders rich previews
 * for content types where the browser's native rendering is unfriendly
 * (markdown / docx / pptx today).
 */
export function SharePreviewPage() {
  const { token } = useParams<{ token: string }>();
  const language = useLocaleStore((s) => s.language);
  const t = language === 'zh' ? PREVIEW_LABELS_ZH : PREVIEW_LABELS_EN;

  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [pptxText, setPptxText] = useState<string | null>(null);
  const [docxBuffer, setDocxBuffer] = useState<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError(t.invalidLink);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const metaRes = await fetch(apiUrl(`/s/${encodeURIComponent(token)}/meta`));
        if (!metaRes.ok) {
          if (cancelled) return;
          setError(metaRes.status === 404 ? t.notFound : t.expired);
          setLoading(false);
          return;
        }
        const m: ShareMeta = await metaRes.json();
        if (cancelled) return;
        if (!m.valid) {
          setMeta(m);
          setError(t.expired);
          setLoading(false);
          return;
        }
        setMeta(m);

        if (m.kind !== 'file') {
          setLoading(false);
          return;
        }

        const kind = previewKindFor(m.mimeType);

        // Text-like: fetch as string and render directly.
        if ((kind === 'markdown' || kind === 'text' || kind === 'json') && m.fileSize <= TEXT_PREVIEW_MAX_BYTES) {
          const contentRes = await fetch(apiUrl(`/s/${encodeURIComponent(token)}?inline=1`));
          if (cancelled) return;
          if (!contentRes.ok) {
            setError(t.expired);
            setLoading(false);
            return;
          }
          const text = await contentRes.text();
          if (cancelled) return;
          setTextContent(text);
          setLoading(false);
          return;
        }

        // docx / pptx: fetch as binary and dispatch to the right renderer.
        if ((kind === 'docx' || kind === 'pptx') && m.fileSize <= BINARY_PREVIEW_MAX_BYTES) {
          const contentRes = await fetch(apiUrl(`/s/${encodeURIComponent(token)}?inline=1`));
          if (cancelled) return;
          if (!contentRes.ok) {
            setError(t.expired);
            setLoading(false);
            return;
          }
          const buf = await contentRes.arrayBuffer();
          if (cancelled) return;
          if (kind === 'docx') {
            setDocxBuffer(buf);
          } else {
            try {
              const { processPptx } = await import(
                '@/features/chat/attachments/attachment-process-heavy'
              );
              const { extractedText } = await processPptx(buf, m.fileName);
              if (cancelled) return;
              setPptxText(extractedText);
            } catch (err) {
              if (cancelled) return;
              setError(err instanceof Error ? err.message : String(err));
            }
          }
          setLoading(false);
          return;
        }

        // pdf-or-image / unknown: let renderBody decide; nothing to pre-fetch.
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, t.expired, t.invalidLink, t.notFound]);

  const downloadUrl = token ? apiUrl(`/s/${encodeURIComponent(token)}?dl=1`) : '#';
  const openInlineUrl = token ? apiUrl(`/s/${encodeURIComponent(token)}?inline=1`) : '#';

  return (
    <div className="flex min-h-screen flex-col bg-surface-base">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-edge px-4">
        <span className="text-lg" aria-hidden>
          📄
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-fg" title={meta?.fileName ?? ''}>
            {meta?.fileName ?? t.loading}
          </div>
          {meta ? (
            <div className="truncate text-xs text-fg-muted">
              {formatBytes(meta.fileSize)} · {t.expiresAt}{' '}
              {new Date(meta.expiresAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}
            </div>
          ) : null}
        </div>
        {meta ? (
          <>
            <a
              href={openInlineUrl}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              {t.openInline}
            </a>
            <a
              href={downloadUrl}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90"
              download={meta.fileName}
            >
              <Download className="size-3.5" aria-hidden />
              {t.download}
            </a>
          </>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-app-main flex-1 px-4 py-6">
        {loading ? (
          <div className="flex min-h-[50vh] items-center justify-center text-sm text-fg-muted">
            <Loader2 className="mr-2 size-4 animate-spin" />
            {t.loading}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-edge bg-surface-panel p-6 text-sm text-fg">
            <p className="font-medium">{t.error}</p>
            <p className="mt-1 text-fg-muted">{error}</p>
          </div>
        ) : meta ? (
          <PreviewBody
            meta={meta}
            textContent={textContent}
            pptxText={pptxText}
            docxBuffer={docxBuffer}
            openInlineUrl={openInlineUrl}
            t={t}
          />
        ) : null}
      </main>
    </div>
  );
}

function PreviewBody({
  meta,
  textContent,
  pptxText,
  docxBuffer,
  openInlineUrl,
  t,
}: {
  meta: ShareMeta;
  textContent: string | null;
  pptxText: string | null;
  docxBuffer: ArrayBuffer | null;
  openInlineUrl: string;
  t: typeof PREVIEW_LABELS_EN | typeof PREVIEW_LABELS_ZH;
}) {
  if (meta.kind === 'directory') {
    return (
      <div className="rounded-lg border border-edge bg-surface-panel p-6 text-sm text-fg-muted">
        {t.directoryHint}
      </div>
    );
  }
  const kind = previewKindFor(meta.mimeType);

  if (kind === 'markdown' && textContent !== null) {
    return (
      <article className="rounded-lg border border-edge bg-surface-panel p-6">
        <MarkdownView content={textContent} />
      </article>
    );
  }
  if ((kind === 'text' || kind === 'json') && textContent !== null) {
    return (
      <pre className="overflow-x-auto rounded-lg border border-edge bg-surface-panel p-4 text-xs text-fg">
        <code>{textContent}</code>
      </pre>
    );
  }
  if (kind === 'pdf-or-image') {
    return (
      <iframe
        title={meta.fileName}
        src={openInlineUrl}
        className="h-[80vh] w-full rounded-lg border border-edge bg-surface-panel"
      />
    );
  }
  if (kind === 'pptx' && pptxText !== null) {
    return (
      <div className="rounded-lg border border-edge bg-surface-panel p-4">
        <PptxPreviewView
          text={pptxText}
          slideLabel={(n) => t.pptxSlide.replace('{n}', String(n))}
          emptySlideLabel={t.pptxEmptySlide}
        />
      </div>
    );
  }
  if (kind === 'docx' && docxBuffer !== null) {
    return <DocxPreview buffer={docxBuffer} loadingLabel={t.loading} />;
  }
  return (
    <div className="rounded-lg border border-edge bg-surface-panel p-6 text-sm text-fg-muted">
      {t.cannotPreview}
    </div>
  );
}

/**
 * Lazily renders docx via `docx-preview` into a managed container. The
 * underlying lib mutates the DOM directly, so we own the host node and
 * cleanup on unmount / buffer swap.
 */
function DocxPreview({ buffer, loadingLabel }: { buffer: ArrayBuffer; loadingLabel: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [rendering, setRendering] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const host = hostRef.current;
    if (!host) return;
    setRendering(true);
    setRenderError(null);
    (async () => {
      try {
        const { renderDocxInContainer } = await import(
          '@/features/chat/attachments/attachment-preview-renderer'
        );
        if (cancelled) return;
        const result = await renderDocxInContainer(host, buffer);
        if (cancelled) {
          result.cleanup();
          return;
        }
        cleanup = result.cleanup;
        setRendering(false);
      } catch (err) {
        if (cancelled) return;
        setRenderError(err instanceof Error ? err.message : String(err));
        setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [buffer]);

  return (
    <div className="rounded-lg border border-edge bg-surface-panel p-4">
      {rendering ? (
        <div className="flex min-h-[20vh] items-center justify-center text-sm text-fg-muted">
          <Loader2 className="mr-2 size-4 animate-spin" />
          {loadingLabel}
        </div>
      ) : null}
      {renderError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{renderError}</p>
      ) : null}
      <div ref={hostRef} className={rendering ? 'hidden' : 'min-h-[40vh]'} />
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1_073_741_824) return `${(n / 1_048_576).toFixed(1)} MB`;
  return `${(n / 1_073_741_824).toFixed(1)} GB`;
}

const PREVIEW_LABELS_ZH = {
  loading: '加载中…',
  error: '加载失败',
  expired: '链接已失效',
  notFound: '链接不存在',
  invalidLink: '链接无效',
  expiresAt: '有效期至',
  download: '下载',
  openInline: '在新窗口打开',
  cannotPreview: '此文件类型暂不支持在线预览，请下载查看。',
  directoryHint: '目录分享请使用主页面浏览。',
  pptxSlide: '第 {n} 页',
  pptxEmptySlide: '（本页无文本）',
} as const;

const PREVIEW_LABELS_EN = {
  loading: 'Loading…',
  error: 'Failed to load',
  expired: 'Link no longer valid',
  notFound: 'Link not found',
  invalidLink: 'Invalid link',
  expiresAt: 'Expires',
  download: 'Download',
  openInline: 'Open raw',
  cannotPreview: 'This file type cannot be previewed here. Please download it instead.',
  directoryHint: 'Directory shares are browsed from the main page.',
  pptxSlide: 'Slide {n}',
  pptxEmptySlide: '(empty slide)',
} as const;
