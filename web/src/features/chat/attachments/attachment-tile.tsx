import { FileSpreadsheet, FileText, X } from 'lucide-react';
import { useId } from 'react';

import type { MessageAttachment } from '@/features/chat/messages/messages.types';
import { getAttachmentBinaryPayload } from '@/features/chat/attachments/attachment-utils-core';
import { useAttachmentImageSrc } from '@/features/chat/attachments/use-attachment-image-src';
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
  /** How image thumbnails are sized inside attachment grids. */
  imageSize?: 'thumbnail' | 'single' | 'grid-cell';
  /** Grid-cell aspect (legacy; grid tiles always use square cells). */
  gridCellFill?: 'square' | 'stretch';
  /** Smaller thumbnails for user message bubbles. */
  compact?: boolean;
  className?: string;
  /** Shown over the thumbnail when the album truncates extra images. */
  overflowLabel?: string;
  onOpen: (att: MessageAttachment) => void;
};

export function AttachmentTile({
  attachment,
  authToken,
  sessionKey,
  showDelete = false,
  onDelete,
  imageSize = 'thumbnail',
  compact = false,
  gridCellFill: _gridCellFill = 'square',
  className,
  overflowLabel,
  onOpen,
}: AttachmentTileProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const missingAuthHintId = useId();

  const isImageMime = attachment.mimeType?.startsWith('image/') || attachment.type === 'image';
  const thumbSrc = useAttachmentImageSrc(attachment, { authToken, sessionKey });
  const showImageThumb = isImageMime && Boolean(thumbSrc);

  const needsGatewayBinary = Boolean(attachment.uri) && !getAttachmentBinaryPayload(attachment);
  const showMissingAuthHint = needsGatewayBinary && !String(authToken ?? '').trim();

  const isPdf = attachment.mimeType === 'application/pdf';
  const isExcel =
    attachment.mimeType?.includes('spreadsheetml') ||
    attachment.name?.toLowerCase().endsWith('.xlsx') ||
    attachment.name?.toLowerCase().endsWith('.xls');
  const displayName = attachment.name ?? 'file';

  const mainLabel = showMissingAuthHint
    ? `${displayName} — ${m.chat.attachmentPreviewMissingAuth}`
    : displayName;

  const missingAuthText = m.chat.attachmentPreviewMissingAuth;

  const imageThumbClass =
    imageSize === 'single'
      ? compact
        ? 'max-h-28 w-full max-w-[9rem] object-contain'
        : 'max-h-36 w-full max-w-44 object-contain'
      : imageSize === 'grid-cell'
        ? 'size-full object-cover'
        : 'max-h-16 w-full object-cover';

  const imageWrapperClass =
    imageSize === 'single'
      ? compact
        ? 'max-w-[9rem]'
        : 'max-w-44'
      : imageSize === 'grid-cell'
        ? 'min-h-0 w-full'
        : 'max-w-[10rem]';

  const imageButtonClass =
    imageSize === 'grid-cell'
      ? 'relative block aspect-square w-full min-w-0 overflow-hidden rounded-md border border-edge dark:border-edge'
      : 'block w-full overflow-hidden rounded-md border border-edge dark:border-edge';

  return (
    <div
      className={cn(
        'group relative min-w-0',
        imageSize === 'grid-cell' ? 'w-full min-h-0' : 'inline-block',
        className,
      )}
    >
      {showImageThumb ? (
        <div className={imageWrapperClass}>
          <div className="relative size-full min-h-0">
            <button
              type="button"
              className={cn(
                imageButtonClass,
                interaction.transition,
                interaction.press,
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
              )}
              onClick={() => onOpen(attachment)}
              title={mainLabel}
              aria-label={mainLabel}
              aria-describedby={showMissingAuthHint ? missingAuthHintId : undefined}
            >
              <img src={thumbSrc} alt={displayName} className={imageThumbClass} />
              {overflowLabel ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-lg font-semibold text-white">
                  {overflowLabel}
                </span>
              ) : null}
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
            onClick={() => onOpen(attachment)}
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
