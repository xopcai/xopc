import { useLayoutEffect, useRef, useState } from 'react';

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
};

export function useBinaryPreviewInContainer({
  language,
  buffer,
  kind,
  fileKey,
  containerEl,
}: UseBinaryPreviewInContainerArgs): { error: string | null; excelTruncated: boolean } {
  const cleanupRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [excelTruncated, setExcelTruncated] = useState(false);

  useLayoutEffect(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setError(null);
    setExcelTruncated(false);

    if (!buffer || !kind || !containerEl || !fileKey) return;

    let cancelled = false;

    void (async () => {
      try {
        const mod = await import('@/features/chat/attachments/attachment-preview-renderer');
        if (cancelled) return;
        const L = messages(language).chat;
        if (kind === 'pdf') {
          const { cleanup } = await mod.renderPdfInContainer(containerEl, buffer, {
            loadingText: L.attachmentPreviewPdfRendering,
            loadMoreHint: L.attachmentPreviewPdfLoadMore,
          });
          cleanupRef.current = cleanup;
        } else if (kind === 'excel') {
          const { cleanup, truncated } = await mod.renderExcelInContainer(containerEl, buffer, {
            truncationNotice: L.attachmentPreviewExcelTruncated
              .replaceAll('{rows}', String(EXCEL_PREVIEW_MAX_ROWS))
              .replaceAll('{cols}', String(EXCEL_PREVIEW_MAX_COLS)),
          });
          cleanupRef.current = cleanup;
          if (!cancelled) setExcelTruncated(truncated);
        } else if (kind === 'docx') {
          const { cleanup } = await mod.renderDocxInContainer(containerEl, buffer);
          cleanupRef.current = cleanup;
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [buffer, kind, containerEl, fileKey, language]);

  return { error, excelTruncated };
}

