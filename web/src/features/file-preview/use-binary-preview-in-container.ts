import { useEffect, useLayoutEffect, useState } from 'react';

import { EXCEL_PREVIEW_MAX_COLS, EXCEL_PREVIEW_MAX_ROWS } from '@/features/chat/attachments/attachment-utils-core';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

type BinaryRenderKind = 'pdf' | 'excel' | 'docx';

type UseBinaryPreviewInContainerArgs = {
  language: StoredLanguage;
  buffer: ArrayBuffer | null;
  kind: BinaryRenderKind | null;
  fileKey: string | null;
  containerEl: HTMLDivElement | null;
  onPdfPageCount?: (count: number) => void;
  pdfPage?: number;
  targetSheet?: string;
  targetParagraph?: number;
};

function previewLoadingText(language: StoredLanguage, kind: BinaryRenderKind): string {
  if (kind === 'pdf') return messages(language).chat.attachmentPreviewPdfRendering;
  if (language === 'zh') {
    if (kind === 'excel') return '正在加载电子表格…';
    return '正在加载文档…';
  }
  if (kind === 'excel') return 'Loading spreadsheet...';
  return 'Loading document...';
}

function renderLoadingPlaceholder(container: HTMLDivElement, text: string): void {
  container.innerHTML = '';
  const loadingEl = document.createElement('p');
  loadingEl.className = 'p-4 text-sm text-fg-muted';
  loadingEl.textContent = text;
  container.appendChild(loadingEl);
}

export function useBinaryPreviewInContainer({
  language,
  buffer,
  kind,
  fileKey,
  containerEl,
  onPdfPageCount,
  pdfPage,
  targetSheet,
  targetParagraph,
}: UseBinaryPreviewInContainerArgs): { error: string | null; excelTruncated: boolean } {
  const [error, setError] = useState<string | null>(null);
  const [excelTruncated, setExcelTruncated] = useState(false);
  const [navigatePdf, setNavigatePdf] = useState<((page: number) => Promise<void>) | null>(null);

  useEffect(() => {
    if (!navigatePdf || !pdfPage || kind !== 'pdf') return;
    let current = true;
    setError(null);
    void navigatePdf(pdfPage).catch(error => {
      if (current) setError(error instanceof Error ? error.message : String(error));
    });
    return () => { current = false; };
  }, [kind, navigatePdf, pdfPage]);


  useLayoutEffect(() => {
    setError(null);
    setExcelTruncated(false);
    setNavigatePdf(null);

    if (!buffer || !kind || !containerEl || !fileKey) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;
    // Each async renderer owns its host, so late completion cannot replace a newer preview.
    const renderHost = document.createElement('div');
    renderHost.className = 'flex min-h-0 flex-1 flex-col overflow-auto';
    containerEl.replaceChildren(renderHost);
    renderLoadingPlaceholder(renderHost, previewLoadingText(language, kind));
    const acceptCleanup = (dispose: () => void) => {
      if (cancelled) dispose();
      else cleanup = dispose;
    };

    void (async () => {
      try {
        const mod = await import('@/features/chat/attachments/attachment-preview-renderer');
        if (cancelled) return;
        const L = messages(language).chat;
        if (kind === 'pdf') {
          const { cleanup, goToPage } = await mod.renderPdfInContainer(renderHost, buffer, {
            loadingText: L.attachmentPreviewPdfRendering,
            loadMoreHint: L.attachmentPreviewPdfLoadMore,
            onPageCount: (count) => { if (!cancelled) onPdfPageCount?.(count); },
          });
          acceptCleanup(cleanup);
          if (!cancelled) setNavigatePdf(() => goToPage);
        } else if (kind === 'excel') {
          const { cleanup, truncated } = await mod.renderExcelInContainer(renderHost, buffer, {
            initialSheet: targetSheet,
            truncationNotice: L.attachmentPreviewExcelTruncated
              .replaceAll('{rows}', String(EXCEL_PREVIEW_MAX_ROWS))
              .replaceAll('{cols}', String(EXCEL_PREVIEW_MAX_COLS)),
          });
          acceptCleanup(cleanup);
          if (!cancelled) setExcelTruncated(truncated);
        } else if (kind === 'docx') {
          const { cleanup } = await mod.renderDocxInContainer(renderHost, buffer);
          acceptCleanup(cleanup);
          if (!cancelled && targetParagraph) renderHost.querySelectorAll('section.docx p')[targetParagraph - 1]?.scrollIntoView({ block: 'nearest' });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
      renderHost.remove();
    };
  }, [buffer, kind, containerEl, fileKey, language, onPdfPageCount, targetParagraph, targetSheet]);

  return { error, excelTruncated };
}
