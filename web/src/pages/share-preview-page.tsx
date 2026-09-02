import { Download, ExternalLink } from 'lucide-react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { MarkdownView } from '@/components/markdown/markdown-view';
import { blockRemoteMarkdownImages } from '@/features/shares/public-markdown';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

interface ShareMeta {
  kind: 'file' | 'directory' | 'note' | 'session';
  fileName: string;
  fileSize: number;
  mimeType: string;
  description: string | null;
  expiresAt: string;
  remainingViews: number | null;
  valid: boolean;
}

interface SharedSessionView {
  kind: 'session';
  title: string;
  snapshotAt: string;
  expiresAt: string;
  description: string | null;
  snapshotRevision: number;
  messages: Array<{ id: string; role: 'user' | 'assistant'; markdown: string; createdAt: string; attachmentIds: string[] }>;
  toolActivities: Array<{ id: string; messageId?: string; toolName: string; status: 'completed' | 'failed'; createdAt: string }>;
  attachments: Array<{ id: string; messageId: string; mimeType: string; fileName: string; size: number; url: string }>;
}

interface SharedNoteView {
  kind: 'note';
  title: string;
  markdown: string;
  snapshotAt: string;
  expiresAt: string;
  description: string | null;
  sourceVersion: number;
  snapshotRevision: number;
  attachments: Array<{ id: string; type: string; mimeType: string; fileName: string; size: number; duration?: number }>;
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
  const [noteView, setNoteView] = useState<SharedNoteView | null>(null);
  const [sessionView, setSessionView] = useState<SharedSessionView | null>(null);

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
        setNoteView(null);
        setSessionView(null);
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
        if (m.kind === 'note' || m.kind === 'session') {
          const viewRes = await fetch(apiUrl(`/s/${encodeURIComponent(token)}/view`), { method: 'POST' });
          if (!viewRes.ok) {
            setError(viewRes.status === 404 ? t.notFound : t.expired);
            return;
          }
          const view = await viewRes.json() as { payload?: SharedNoteView | SharedSessionView };
          if (!cancelled && view.payload?.kind === 'note') setNoteView(view.payload);
          if (!cancelled && view.payload?.kind === 'session') setSessionView(view.payload);
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-base">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-edge px-4">
        <span className="text-lg" aria-hidden>
          #
        </span>
        <div className="min-w-0 flex-1">
          {meta ? (
            <div className="truncate text-sm font-semibold text-fg" title={meta.fileName}>
              {meta.fileName}
            </div>
          ) : loading ? (
            <Skeleton className="h-4 w-48 max-w-full" />
          ) : (
            <div className="truncate text-sm font-semibold text-fg">{t.error}</div>
          )}
          {meta ? (
            <div className="truncate text-xs text-fg-muted">
              {formatBytes(meta.fileSize)} · {t.expiresAt}{' '}
              {new Date(meta.expiresAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}
            </div>
          ) : null}
        </div>
        {meta && meta.kind === 'file' ? (
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

      <main className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-contain px-3 py-6 sm:px-5 xl:px-6">
        {loading ? (
          <div className="flex min-h-[70vh] flex-1 flex-col overflow-hidden rounded-lg bg-surface-panel p-4 shadow-surface" aria-busy="true">
            <Skeleton className="h-5 w-56 max-w-full" />
            <div className="mt-5 grid gap-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-10/12" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <Skeleton className="mt-6 min-h-0 flex-1 rounded-lg" />
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
        ) : meta?.kind === 'note' && noteView ? (
          <article className="mx-auto w-full max-w-3xl rounded-xl border border-edge-subtle bg-surface-panel px-6 py-8 shadow-surface sm:px-10 sm:py-10">
            <h1 className="text-3xl font-bold tracking-tight text-fg">{noteView.title}</h1>
            <div className="mt-2 text-xs text-fg-muted">
              {t.sharedAt}{' '}{new Date(noteView.snapshotAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}
              {' · '}{t.expiresAt}{' '}{new Date(noteView.expiresAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}
            </div>
            {noteView.description ? (
              <p className="mt-5 rounded-lg bg-surface-subtle px-4 py-3 text-sm leading-6 text-fg-muted">{noteView.description}</p>
            ) : null}
            <MarkdownView content={blockRemoteMarkdownImages(noteView.markdown, t.remoteImageBlocked)} className="mt-8" />
            <footer className="mt-10 border-t border-edge-subtle pt-4 text-center text-xs text-fg-subtle">{t.sharedVia}</footer>
          </article>
        ) : meta?.kind === 'session' && sessionView ? (
          <article className="mx-auto w-full max-w-4xl rounded-xl border border-edge-subtle bg-surface-panel px-4 py-7 shadow-surface sm:px-8 sm:py-9">
            <header className="mx-auto max-w-3xl border-b border-edge-subtle pb-5">
              <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">{sessionView.title}</h1>
              <div className="mt-2 text-xs text-fg-muted">
                {t.sharedAt}{' '}{new Date(sessionView.snapshotAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}
                {' · '}{t.expiresAt}{' '}{new Date(sessionView.expiresAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}
              </div>
              {sessionView.description ? <p className="mt-4 text-sm leading-6 text-fg-muted">{sessionView.description}</p> : null}
            </header>
            <div className="mx-auto mt-6 max-w-3xl space-y-5">
              {sessionView.messages.map((message) => (
                <section key={message.id} className={message.role === 'user' ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-full'}>
                  <div className="mb-1 text-xs font-medium text-fg-subtle">{message.role === 'user' ? t.you : t.assistant}</div>
                  <div className={message.role === 'user' ? 'rounded-2xl bg-surface-subtle px-4 py-3' : 'px-1 py-1'}>
                    <MarkdownView content={blockRemoteMarkdownImages(message.markdown, t.remoteImageBlocked)} />
                    {sessionView.attachments.filter((attachment) => message.attachmentIds.includes(attachment.id)).map((attachment) => (
                      <SharedSessionAttachment key={attachment.id} attachment={attachment} />
                    ))}
                    {sessionView.toolActivities.filter((activity) => activity.messageId === message.id).map((activity) => (
                      <div key={activity.id} className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-edge-subtle px-2 py-1 text-xs text-fg-muted">
                        <span>{activity.toolName}</span>
                        <span aria-hidden>·</span>
                        <span>{activity.status === 'completed' ? t.toolCompleted : t.toolFailed}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
              {sessionView.toolActivities.filter((activity) => !activity.messageId).map((activity) => (
                <div key={activity.id} className="text-center text-xs text-fg-muted">
                  {activity.toolName} · {activity.status === 'completed' ? t.toolCompleted : t.toolFailed}
                </div>
              ))}
            </div>
            <footer className="mx-auto mt-10 max-w-3xl border-t border-edge-subtle pt-4 text-center text-xs text-fg-subtle">{t.sharedVia}</footer>
          </article>
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

function SharedSessionAttachment({ attachment }: { attachment: SharedSessionView['attachments'][number] }) {
  if (attachment.mimeType.startsWith('image/')) {
    return <img src={attachment.url} alt={attachment.fileName} loading="lazy" className="mt-3 max-h-[28rem] max-w-full rounded-lg border border-edge-subtle object-contain" />;
  }
  if (attachment.mimeType.startsWith('audio/')) {
    return <audio src={attachment.url} controls preload="none" className="mt-3 max-w-full" />;
  }
  return (
    <a href={attachment.url} target="_blank" rel="noreferrer" className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-edge-subtle px-3 py-2 text-sm text-accent hover:bg-surface-hover">
      <span className="min-w-0 truncate">{attachment.fileName}</span>
      <span className="shrink-0 text-xs text-fg-subtle">{formatBytes(attachment.size)}</span>
    </a>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1_073_741_824) return `${(n / 1_048_576).toFixed(1)} MB`;
  return `${(n / 1_073_741_824).toFixed(1)} GB`;
}

const PREVIEW_LABELS_ZH = {
  error: '加载失败',
  expired: '链接已失效',
  notFound: '链接不存在',
  invalidLink: '链接无效',
  expiresAt: '有效期至',
  download: '下载',
  openInline: '在新窗口打开',
  directoryHint: '目录分享请使用主页面浏览。',
  tooLarge: '文件过大，无法在线预览，请下载查看。',
  sharedAt: '分享于',
  sharedVia: '通过 xopc 分享',
  you: '你',
  assistant: '助手',
  toolCompleted: '已完成',
  toolFailed: '失败',
  remoteImageBlocked: '远程图片（点击打开）',
} as const;

const PREVIEW_LABELS_EN = {
  error: 'Failed to load',
  expired: 'Link no longer valid',
  notFound: 'Link not found',
  invalidLink: 'Invalid link',
  expiresAt: 'Expires',
  download: 'Download',
  openInline: 'Open raw',
  directoryHint: 'Directory shares are browsed from the main page.',
  tooLarge: 'This file is too large to preview here. Please download it instead.',
  sharedAt: 'Shared',
  sharedVia: 'Shared via xopc',
  you: 'You',
  assistant: 'Assistant',
  toolCompleted: 'completed',
  toolFailed: 'failed',
  remoteImageBlocked: 'Remote image (open manually)',
} as const;
