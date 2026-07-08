import { Download, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { PPTX_PREVIEW_MAX_CHARS } from '@/features/chat/attachments/attachment-utils-core';
import {
  BINARY_PREVIEW_MAX_BYTES,
  detectPreviewFileType,
  inferPreviewMimeType,
  PreviewRuntimeView,
  readModeForPreviewType,
  TEXT_PREVIEW_MAX_BYTES,
  type PreviewFileDescriptor,
} from '@/features/preview-runtime';
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

type SharePreviewLoad = {
  textContent: string | null;
  binaryBuffer: ArrayBuffer | null;
  extractedText: string | null;
  extractedTextTruncated: boolean;
};

function emptyLoad(): SharePreviewLoad {
  return { textContent: null, binaryBuffer: null, extractedText: null, extractedTextTruncated: false };
}

export function SharePreviewPage() {
  const { token } = useParams<{ token: string }>();
  const language = useLocaleStore((s) => s.language);
  const t = language === 'zh' ? PREVIEW_LABELS_ZH : PREVIEW_LABELS_EN;

  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [load, setLoad] = useState<SharePreviewLoad>(emptyLoad);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const descriptor = useMemo((): PreviewFileDescriptor | null => {
    if (!meta || !token || meta.kind !== 'file') return null;
    const mimeType = inferPreviewMimeType(meta.fileName, meta.mimeType);
    return {
      id: `share:${token}:${meta.fileName}`,
      context: 'share',
      fileName: meta.fileName,
      mimeType,
      size: meta.fileSize,
      type: detectPreviewFileType(meta.fileName, mimeType),
      source: { kind: 'share', token },
    };
  }, [meta, token]);

  useEffect(() => {
    if (!token) {
      setError(t.invalidLink);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        setLoad(emptyLoad());
        const metaRes = await fetch(apiUrl(`/s/${encodeURIComponent(token)}/meta`));
        if (!metaRes.ok) {
          if (!cancelled) setError(metaRes.status === 404 ? t.notFound : t.expired);
          return;
        }
        const m = (await metaRes.json()) as ShareMeta;
        if (cancelled) return;
        setMeta(m);
        if (!m.valid) {
          setError(t.expired);
          return;
        }
        if (m.kind !== 'file') return;

        const mimeType = inferPreviewMimeType(m.fileName, m.mimeType);
        const type = detectPreviewFileType(m.fileName, mimeType);
        const mode = readModeForPreviewType(type);
        const contentUrl = apiUrl(`/s/${encodeURIComponent(token)}?inline=1`);

        if (mode === 'text') {
          if (m.fileSize > TEXT_PREVIEW_MAX_BYTES) {
            setError(t.tooLarge);
            return;
          }
          const res = await fetch(contentUrl);
          if (!res.ok) {
            setError(t.expired);
            return;
          }
          const text = await res.text();
          if (!cancelled) setLoad({ ...emptyLoad(), textContent: text });
          return;
        }

        if (mode === 'binary') {
          if (m.fileSize > BINARY_PREVIEW_MAX_BYTES) {
            setError(t.tooLarge);
            return;
          }
          const res = await fetch(contentUrl);
          if (!res.ok) {
            setError(t.expired);
            return;
          }
          const binaryBuffer = await res.arrayBuffer();
          if (cancelled) return;
          if (type === 'pptx') {
            const { processPptx } = await import('@/features/chat/attachments/attachment-process-heavy');
            const { extractedText } = await processPptx(binaryBuffer, m.fileName);
            const truncated = extractedText.length > PPTX_PREVIEW_MAX_CHARS;
            setLoad({
              textContent: null,
              binaryBuffer,
              extractedText: truncated ? extractedText.slice(0, PPTX_PREVIEW_MAX_CHARS) : extractedText,
              extractedTextTruncated: truncated,
            });
            return;
          }
          setLoad({ ...emptyLoad(), binaryBuffer });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, t.expired, t.invalidLink, t.notFound, t.tooLarge]);

  const downloadUrl = token ? apiUrl(`/s/${encodeURIComponent(token)}?dl=1`) : '#';
  const openInlineUrl = token ? apiUrl(`/s/${encodeURIComponent(token)}?inline=1`) : '#';

  return (
    <div className="flex min-h-screen flex-col bg-surface-base">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-edge px-4">
        <span className="text-lg" aria-hidden>
          #
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
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              {t.openInline}
            </a>
            <a
              href={downloadUrl}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              download={meta.fileName}
            >
              <Download className="size-3.5" aria-hidden />
              {t.download}
            </a>
          </>
        ) : null}
      </header>

      <main className="flex min-h-0 w-full flex-1 flex-col px-3 py-6 sm:px-5 xl:px-6">
        {loading ? (
          <div className="flex min-h-[50vh] items-center justify-center text-sm text-fg-muted">
            <Loader2 className="mr-2 size-4 animate-spin" />
            {t.loading}
          </div>
        ) : error ? (
          <div className="rounded-lg bg-surface-panel p-6 shadow-surface text-sm text-fg">
            <p className="font-medium">{t.error}</p>
            <p className="mt-1 text-fg-muted">{error}</p>
          </div>
        ) : meta?.kind === 'directory' ? (
          <div className="rounded-lg bg-surface-panel p-6 shadow-surface text-sm text-fg-muted">
            {t.directoryHint}
          </div>
        ) : descriptor ? (
          <div className="flex min-h-[70vh] flex-1 flex-col overflow-hidden rounded-lg bg-surface-panel shadow-surface">
            <PreviewRuntimeView
              language={language}
              descriptor={descriptor}
              loading={false}
              loadError={null}
              textContent={load.textContent}
              binaryBuffer={load.binaryBuffer}
              extractedText={load.extractedText}
              extractedTextTruncated={load.extractedTextTruncated}
              actions={{
                onDownload: () => {
                  window.location.href = downloadUrl;
                },
                canDownload: true,
              }}
            />
          </div>
        ) : null}
      </main>
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
  loading: '加载中...',
  error: '加载失败',
  expired: '链接已失效',
  notFound: '链接不存在',
  invalidLink: '链接无效',
  expiresAt: '有效期至',
  download: '下载',
  openInline: '在新窗口打开',
  directoryHint: '目录分享请使用主页面浏览。',
  tooLarge: '文件过大，无法在线预览，请下载查看。',
} as const;

const PREVIEW_LABELS_EN = {
  loading: 'Loading...',
  error: 'Failed to load',
  expired: 'Link no longer valid',
  notFound: 'Link not found',
  invalidLink: 'Invalid link',
  expiresAt: 'Expires',
  download: 'Download',
  openInline: 'Open raw',
  directoryHint: 'Directory shares are browsed from the main page.',
  tooLarge: 'This file is too large to preview here. Please download it instead.',
} as const;
