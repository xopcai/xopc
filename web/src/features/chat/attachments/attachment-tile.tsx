import { FileSpreadsheet, FileText, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import { getAttachmentBinaryPayload, resolveDataUrlForDisplay } from '@/features/chat/attachments/attachment-utils-core';
import { fetchWorkspaceRelativeFileAsBase64 } from '@/features/file-preview/fetch-workspace-relative-file-base64';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

type AttachmentTileProps = {
  attachment: MessageAttachment;
  authToken?: string;
  sessionKey?: string | null;
  showDelete?: boolean;
  onDelete?: () => void;
  onOpen: (att: MessageAttachment) => void;
};

export function AttachmentTile({
  attachment,
  authToken,
  sessionKey,
  showDelete = false,
  onDelete,
  onOpen,
}: AttachmentTileProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const missingAuthHintId = useId();
  // Hydration is keyed by the attachment reference: when the prop changes we
  // simply ignore stale hydrated data instead of round-tripping through a reset effect.
  const [hydration, setHydration] = useState<{ src: MessageAttachment; data: MessageAttachment } | null>(null);

  const effective = hydration?.src === attachment ? hydration.data : attachment;

  const needsGatewayBinary =
    Boolean(attachment.workspaceRelativePath) && !getAttachmentBinaryPayload(attachment);
  const showMissingAuthHint = needsGatewayBinary && !String(authToken ?? '').trim();

  useEffect(() => {
    const base = attachment;
    if (!base?.workspaceRelativePath || getAttachmentBinaryPayload(base)) {
      return;
    }
    if (!String(authToken ?? '').trim()) return;

    let cancelled = false;
    void (async () => {
      const result = await fetchWorkspaceRelativeFileAsBase64({
        workspaceRelativePath: base.workspaceRelativePath!,
        sessionKey,
      });
      if (!result.ok || cancelled) return;
      const b64 = result.base64;
      const isImg = base.mimeType?.startsWith('image/') || base.type === 'image';
      setHydration({
        src: base,
        data: {
          ...base,
          content: b64,
          data: b64,
          preview: isImg ? b64 : base.preview,
          type: isImg ? 'image' : 'document',
        },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [attachment, authToken, sessionKey]);

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

  const mainLabel = showMissingAuthHint
    ? `${displayName} — ${m.chat.attachmentPreviewMissingAuth}`
    : displayName;

  const missingAuthText = m.chat.attachmentPreviewMissingAuth;

  return (
    <div className="group relative inline-block">
      {showImageThumb ? (
        <div className="max-w-[10rem]">
          <div className="relative">
            <button
              type="button"
              className={cn(
                'block w-full overflow-hidden rounded-md border border-edge dark:border-edge',
                interaction.transition,
                interaction.press,
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
              )}
              onClick={() => onOpen(effective)}
              title={mainLabel}
              aria-label={mainLabel}
              aria-describedby={showMissingAuthHint ? missingAuthHintId : undefined}
            >
              <img src={thumbSrc} alt={displayName} className="max-h-16 w-full object-cover" />
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
          {showMissingAuthHint ? (
            <p
              id={missingAuthHintId}
              className="mt-1 line-clamp-2 text-[10px] leading-snug text-amber-600 dark:text-amber-500"
            >
              {missingAuthText}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="max-w-[14rem]">
          <button
            type="button"
            onClick={() => onOpen(effective)}
            title={mainLabel}
            aria-label={mainLabel}
            aria-describedby={showMissingAuthHint ? missingAuthHintId : undefined}
            className={cn(
              'flex w-full min-w-0 gap-2 rounded-md border border-edge bg-surface-hover px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-surface-active dark:border-edge',
              showMissingAuthHint ? 'items-start' : 'items-center',
              interaction.transition,
              interaction.press,
              interaction.focusRingPanel,
            )}
          >
            {isExcel ? (
              <FileSpreadsheet className="size-8 shrink-0 text-fg-subtle" aria-hidden />
            ) : (
              <FileText className="size-8 shrink-0 text-fg-subtle" aria-hidden />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-fg">{displayName}</span>
              {showMissingAuthHint ? (
                <span
                  id={missingAuthHintId}
                  className="mt-0.5 line-clamp-2 block text-[10px] font-normal leading-snug text-amber-600 dark:text-amber-500"
                >
                  {missingAuthText}
                </span>
              ) : null}
            </span>
          </button>
        </div>
      )}
      {showDelete ? (
        <button
          type="button"
          className={cn(
            'absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border border-edge bg-surface-panel text-fg-muted shadow-surface hover:text-fg dark:border-edge',
            interaction.transition,
            interaction.press,
            interaction.focusRingPanel,
          )}
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.();
          }}
          title={m.chat.attachmentPreviewRemove}
          aria-label={m.chat.attachmentPreviewRemove}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
