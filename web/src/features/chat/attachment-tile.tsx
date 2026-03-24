import { FileSpreadsheet, FileText, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { MessageAttachment } from '@/features/chat/messages.types';
import {
  arrayBufferToBase64,
  getAttachmentBinaryPayload,
  resolveDataUrlForDisplay,
} from '@/features/chat/attachment-utils-core';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

type AttachmentTileProps = {
  attachment: MessageAttachment;
  authToken?: string;
  showDelete?: boolean;
  onDelete?: () => void;
  onOpen: (att: MessageAttachment) => void;
};

export function AttachmentTile({
  attachment,
  authToken,
  showDelete = false,
  onDelete,
  onOpen,
}: AttachmentTileProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const [hydrated, setHydrated] = useState<MessageAttachment | null>(null);

  const effective = hydrated ?? attachment;

  useEffect(() => {
    setHydrated(null);
  }, [attachment]);

  useEffect(() => {
    const base = attachment;
    if (!base?.workspaceRelativePath || getAttachmentBinaryPayload(base)) {
      return;
    }
    if (!authToken) return;

    let cancelled = false;
    void (async () => {
      try {
        const url = apiUrl(
          `/api/workspace/inbound-file?rel=${encodeURIComponent(base.workspaceRelativePath!)}`,
        );
        const res = await apiFetch(url);
        if (!res.ok || cancelled) return;
        const buf = await res.arrayBuffer();
        const b64 = arrayBufferToBase64(buf);
        const isImg = base.mimeType?.startsWith('image/') || base.type === 'image';
        setHydrated({
          ...base,
          content: b64,
          data: b64,
          preview: isImg ? b64 : base.preview,
          type: isImg ? 'image' : 'document',
        });
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attachment, authToken]);

  const previewBase64 = effective.preview ?? getAttachmentBinaryPayload(effective);
  const isImageMime = effective.mimeType?.startsWith('image/') || effective.type === 'image';
  const isPdf = effective.mimeType === 'application/pdf';
  const isExcel =
    effective.mimeType?.includes('spreadsheetml') ||
    effective.name?.toLowerCase().endsWith('.xlsx') ||
    effective.name?.toLowerCase().endsWith('.xls');
  const displayName = effective.name ?? 'file';
  const imgMime = effective.mimeType?.startsWith('image/') ? effective.mimeType : 'image/png';
  const thumbSrc =
    previewBase64 && isImageMime ? resolveDataUrlForDisplay(imgMime, previewBase64) : '';
  const showImageThumb = Boolean(thumbSrc);

  return (
    <div className="group relative inline-block">
      {showImageThumb ? (
        <div className="relative">
          <button
            type="button"
            className="block overflow-hidden rounded-md border border-edge focus:outline-none focus:ring-2 focus:ring-accent dark:border-edge"
            onClick={() => onOpen(effective)}
            title={displayName}
          >
            <img src={thumbSrc} alt={displayName} className="max-h-48 w-full object-cover" />
          </button>
          {isPdf ? (
            <div
              className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white"
              aria-hidden
            >
              PDF
            </div>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onOpen(effective)}
          title={displayName}
          className="flex max-w-[14rem] items-center gap-2 rounded-md border border-edge bg-surface-hover px-2 py-1.5 text-left text-xs text-fg-muted transition hover:bg-surface-active dark:border-edge"
        >
          {isExcel ? (
            <FileSpreadsheet className="h-8 w-8 shrink-0 text-fg-subtle" aria-hidden />
          ) : (
            <FileText className="h-8 w-8 shrink-0 text-fg-subtle" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate text-fg">{displayName}</span>
        </button>
      )}
      {showDelete ? (
        <button
          type="button"
          className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-edge bg-surface-panel text-fg-muted shadow-sm hover:text-fg dark:border-edge"
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.();
          }}
          title={m.chat.attachmentPreviewRemove}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}
