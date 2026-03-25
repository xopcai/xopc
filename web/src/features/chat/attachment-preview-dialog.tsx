import * as Dialog from '@radix-ui/react-dialog';
import { Download, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { MessageAttachment } from '@/features/chat/messages.types';
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  extractTextForPreview,
  getAttachmentBinaryPayload,
  resolveDataUrlForDisplay,
} from '@/features/chat/attachment-utils-core';
import { apiFetch } from '@/lib/fetch';
import type { StoredLanguage } from '@/lib/storage';
import { apiUrl } from '@/lib/url';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

type FileType = 'image' | 'pdf' | 'docx' | 'pptx' | 'excel' | 'text';

function getFileType(att: MessageAttachment | undefined): FileType {
  if (!att) return 'text';
  if (att.mimeType?.startsWith('image/')) return 'image';
  if (att.type === 'image') return 'image';
  if (att.mimeType === 'application/pdf') return 'pdf';
  if (att.mimeType?.includes('wordprocessingml')) return 'docx';
  if (att.mimeType?.includes('presentationml') || att.name?.toLowerCase().endsWith('.pptx')) {
    return 'pptx';
  }
  if (
    att.mimeType?.includes('spreadsheetml') ||
    att.mimeType?.includes('ms-excel') ||
    att.name?.toLowerCase().endsWith('.xlsx') ||
    att.name?.toLowerCase().endsWith('.xls')
  ) {
    return 'excel';
  }
  return 'text';
}

function fileTypeLabel(ft: FileType, labels: ReturnType<typeof messages>['chat']): string {
  switch (ft) {
    case 'pdf':
      return labels.attachmentPreviewPdf;
    case 'docx':
      return labels.attachmentPreviewDocument;
    case 'pptx':
      return labels.attachmentPreviewPresentation;
    case 'excel':
      return labels.attachmentPreviewSpreadsheet;
    default:
      return '';
  }
}

function PreviewBody({
  attachment,
  fileType,
  showExtractedText,
  loadingGateway,
  fetchError,
  language,
}: {
  attachment: MessageAttachment;
  fileType: FileType;
  showExtractedText: boolean;
  loadingGateway: boolean;
  fetchError: string | null;
  language: StoredLanguage;
}) {
  const labels = messages(language).chat;
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setRenderError(null);
  }, [attachment, fileType, showExtractedText, fetchError]);

  useEffect(() => {
    if (showExtractedText || fetchError || loadingGateway) return;
    if (fileType === 'pptx') return;

    const el = containerRef.current;
    if (!el) return;

    const payload = getAttachmentBinaryPayload(attachment);
    if (!payload && fileType !== 'image' && fileType !== 'text') {
      return;
    }

    let cancelled = false;

    if (fileType === 'pdf') {
      void (async () => {
        if (!payload) return;
        try {
          const buf = base64ToArrayBuffer(payload);
          const mod = await import('@/features/chat/attachment-preview-renderer');
          if (cancelled) return;
          const { cleanup } = await mod.renderPdfInContainer(el, buf);
          cleanupRef.current = cleanup;
        } catch (e) {
          if (!cancelled) {
            const L = messages(language).chat;
            setRenderError(e instanceof Error ? e.message : L.attachmentPreviewFailedPdf);
          }
        }
      })();
    } else if (fileType === 'docx') {
      void (async () => {
        if (!payload) return;
        try {
          const buf = base64ToArrayBuffer(payload);
          const mod = await import('@/features/chat/attachment-preview-renderer');
          if (cancelled) return;
          const { cleanup } = await mod.renderDocxInContainer(el, buf);
          cleanupRef.current = cleanup;
        } catch (e) {
          if (!cancelled) {
            const L = messages(language).chat;
            setRenderError(e instanceof Error ? e.message : L.attachmentPreviewFailedDocx);
          }
        }
      })();
    } else if (fileType === 'excel') {
      void (async () => {
        if (!payload) return;
        try {
          const buf = base64ToArrayBuffer(payload);
          const mod = await import('@/features/chat/attachment-preview-renderer');
          if (cancelled) return;
          const { cleanup } = await mod.renderExcelInContainer(el, buf);
          cleanupRef.current = cleanup;
        } catch (e) {
          if (!cancelled) {
            const L = messages(language).chat;
            setRenderError(e instanceof Error ? e.message : L.attachmentPreviewFailedExcel);
          }
        }
      })();
    }

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [attachment, fileType, showExtractedText, fetchError, loadingGateway, language]);

  if (loadingGateway) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center py-12 text-sm text-fg-muted">
        {labels.attachmentPreviewLoading}
      </div>
    );
  }

  const err = fetchError || renderError;
  if (err) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <div className="text-sm font-medium text-fg">{labels.attachmentPreviewLoadError}</div>
        <div className="max-w-lg text-xs text-fg-muted">{err}</div>
      </div>
    );
  }

  if (showExtractedText && fileType !== 'image') {
    const text = extractTextForPreview(attachment) || labels.attachmentPreviewNoText;
    return (
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-edge-subtle bg-surface-hover/40 p-4 dark:border-edge">
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-fg-muted">
          {text}
        </pre>
      </div>
    );
  }

  switch (fileType) {
    case 'image': {
      const p = getAttachmentBinaryPayload(attachment);
      if (!p) {
        return (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-fg-muted">
            {labels.attachmentPreviewMissingData}
          </div>
        );
      }
      const mime = attachment.mimeType?.startsWith('image/') ? attachment.mimeType : 'image/png';
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-2">
          <img
            src={resolveDataUrlForDisplay(mime, p)}
            alt={attachment.name ?? ''}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      );
    }

    case 'pptx': {
      const text = extractTextForPreview(attachment) || labels.attachmentPreviewNoText;
      return (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-edge-subtle p-4 dark:border-edge">
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-fg">{text}</pre>
        </div>
      );
    }

    case 'pdf':
    case 'docx':
    case 'excel':
      return (
        <div
          ref={containerRef}
          className="docx-preview-host min-h-0 flex-1 overflow-auto rounded-lg border border-edge-subtle bg-surface-panel p-2 dark:border-edge"
        />
      );

    default: {
      const text = extractTextForPreview(attachment) || labels.attachmentPreviewNoText;
      return (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-edge-subtle p-4 dark:border-edge">
          <pre className="whitespace-pre-wrap font-mono text-sm text-fg">{text}</pre>
        </div>
      );
    }
  }
}

export function AttachmentPreviewDialog({
  open,
  attachment,
  authToken,
  onClose,
}: {
  open: boolean;
  attachment: MessageAttachment | null;
  authToken?: string;
  onClose: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const labels = messages(language).chat;
  const [preview, setPreview] = useState<MessageAttachment | null>(null);
  const [showExtractedText, setShowExtractedText] = useState(false);
  const [loadingGateway, setLoadingGateway] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (open && attachment) {
      setPreview(attachment);
      setShowExtractedText(false);
      setFetchError(null);
    }
  }, [open, attachment]);

  useEffect(() => {
    if (!open || !preview) return;
    const path = preview.workspaceRelativePath;
    const hasPayload = Boolean(getAttachmentBinaryPayload(preview));
    if (!path || hasPayload) {
      setLoadingGateway(false);
      return;
    }
    if (!authToken) {
      setFetchError(messages(language).chat.attachmentPreviewMissingAuth);
      setLoadingGateway(false);
      return;
    }

    let cancelled = false;
    setLoadingGateway(true);
    setFetchError(null);
    const L = messages(language).chat;

    void (async () => {
      try {
        const url = apiUrl(`/api/workspace/inbound-file?rel=${encodeURIComponent(path)}`);
        const res = await apiFetch(url);
        if (cancelled) return;
        if (!res.ok) {
          setFetchError(`${L.attachmentPreviewLoadError} (HTTP ${res.status})`);
          return;
        }
        const buf = await res.arrayBuffer();
        const b64 = arrayBufferToBase64(buf);
        setPreview((prev) => (prev ? { ...prev, content: b64, data: b64 } : prev));
      } catch (e) {
        if (!cancelled) {
          setFetchError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) {
          setLoadingGateway(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, preview?.workspaceRelativePath, authToken, language]);

  const fileType = getFileType(preview ?? undefined);
  const hasExtractedText = Boolean(preview?.extractedText);
  const showToggle =
    fileType !== 'image' && fileType !== 'text' && fileType !== 'pptx' && hasExtractedText;

  const handleDownload = () => {
    if (!preview) return;
    const payload = getAttachmentBinaryPayload(preview);
    if (!payload) return;
    const byteCharacters = atob(payload);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: preview.mimeType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = preview.name ?? 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopcbot-dialog-overlay fixed inset-0 z-[80] bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content className="xopcbot-dialog-content-fullscreen fixed inset-0 z-[81] flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col overflow-hidden border-0 bg-surface-panel shadow-none outline-none">
          <div className="shrink-0 border-b border-edge dark:border-edge">
            <div className="mx-auto flex w-full max-w-app-main items-center justify-between gap-2 px-4 py-3 sm:px-8">
              <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
                {preview?.name ?? ''}
              </Dialog.Title>
              <div className="flex shrink-0 items-center gap-1">
                {showToggle ? (
                  <div
                    className="mr-2 flex rounded-lg border border-edge p-0.5 dark:border-edge"
                    role="group"
                    aria-label={labels.attachmentPreviewText}
                  >
                    <button
                      type="button"
                      className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                        !showExtractedText ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:text-fg'
                      }`}
                      onClick={() => {
                        setShowExtractedText(false);
                        setFetchError(null);
                      }}
                    >
                      {fileTypeLabel(fileType, labels)}
                    </button>
                    <button
                      type="button"
                      className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                        showExtractedText ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:text-fg'
                      }`}
                      onClick={() => {
                        setShowExtractedText(true);
                        setFetchError(null);
                      }}
                    >
                      {labels.attachmentPreviewText}
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="rounded-md p-2 text-fg-muted hover:bg-surface-hover hover:text-fg"
                  title={labels.attachmentPreviewDownload}
                  aria-label={labels.attachmentPreviewDownload}
                  onClick={handleDownload}
                >
                  <Download className="h-4 w-4" />
                </button>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-md p-2 text-fg-muted hover:bg-surface-hover hover:text-fg"
                    title={labels.attachmentPreviewClose}
                    aria-label={labels.attachmentPreviewClose}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </Dialog.Close>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="mx-auto flex h-full min-h-0 w-full max-w-app-main flex-col overflow-hidden px-4 pb-4 pt-2 sm:px-8">
              {preview ? (
                <PreviewBody
                  attachment={preview}
                  fileType={fileType}
                  showExtractedText={showExtractedText}
                  loadingGateway={loadingGateway}
                  fetchError={fetchError}
                  language={language}
                />
              ) : null}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
