// The horizontal row of staged attachments shown above the composer input.
// Each chip renders an image thumbnail (for image/*), microphone icon (for
// voice / audio/*), or a generic file icon, plus name/size and a remove button.

import { File as FileIcon, FileCode2, Mic } from 'lucide-react';
import { useState } from 'react';

import { AttachmentPreviewDialog } from '@/features/chat/attachments/attachment-preview-dialog';
import type { Attachment } from '@/features/chat/attachments/attachment-utils';
import { formatFileSize } from '@/features/chat/attachments/attachment-utils';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function ComposerAttachmentChips({
  attachments,
  conversationId,
  topPadded,
  onRemove,
  className,
}: {
  attachments: Attachment[];
  conversationId?: string | null;
  /** Adds a smaller top padding when something (e.g. follow-up stack) is rendered above. */
  topPadded: boolean;
  onRemove: (index: number) => void;
  className?: string;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language).chat;
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  if (attachments.length === 0) return null;
  return (
    <>
      <div
        className={cn(
          'flex flex-wrap gap-2 border-b border-edge-subtle/90 bg-surface-hover/20 px-4 pb-2 dark:border-edge-subtle',
          topPadded ? 'pt-2' : 'pt-3',
          className,
        )}
      >
        {attachments.map((a, index) => {
          const displayName = a.type === 'pasted_text' ? m.pastedText : a.name;
          return (
            <div
              key={a.id ?? `${a.name}-${a.size}-${a.mimeType}-${a.content?.slice(0, 16) ?? ''}`}
              className="flex max-w-[200px] items-center rounded-lg bg-surface-hover text-xs dark:bg-surface-hover/80"
            >
              <button
                type="button"
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-1.5 rounded-l-lg py-1 pl-2 pr-1 text-left hover:bg-surface-active',
                  interaction.transition,
                  interaction.press,
                  interaction.focusRingPanel,
                )}
                onClick={() => setPreviewAttachment(a)}
                aria-label={`${m.attachmentPreviewOpen}: ${displayName}`}
                title={`${m.attachmentPreviewOpen}: ${displayName}`}
              >
                {a.mimeType?.startsWith('image/') && a.content ? (
                  <img
                    src={`data:${a.mimeType};base64,${a.content}`}
                    alt=""
                    className="size-6 shrink-0 rounded object-cover"
                  />
                ) : a.type === 'voice' || a.mimeType?.startsWith('audio/') ? (
                  <Mic className="size-3.5 shrink-0 text-accent-fg" aria-hidden />
                ) : a.type === 'pasted_text' ? (
                  <FileCode2 className="size-3.5 shrink-0 text-accent-fg" aria-hidden />
                ) : (
                  <FileIcon className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate">{displayName}</span>
                <span className="shrink-0 text-fg-disabled">{formatFileSize(a.size)}</span>
              </button>
              <button
                type="button"
                className={cn(
                  'flex min-h-8 min-w-8 items-center justify-center rounded-r-lg text-fg-muted hover:bg-surface-active hover:text-fg',
                  interaction.transition,
                  interaction.press,
                  interaction.focusRingPanel,
                )}
                onClick={() => onRemove(index)}
                aria-label={`${m.attachmentPreviewRemove}: ${displayName}`}
                title={`${m.attachmentPreviewRemove}: ${displayName}`}
              >
                <span aria-hidden>×</span>
              </button>
            </div>
          );
        })}
      </div>
      <AttachmentPreviewDialog
        open={previewAttachment !== null}
        attachment={previewAttachment}
        conversationId={conversationId}
        onClose={() => setPreviewAttachment(null)}
      />
    </>
  );
}
