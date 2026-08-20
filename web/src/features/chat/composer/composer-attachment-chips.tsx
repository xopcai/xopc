// The horizontal row of staged attachments shown above the composer input.
// Each chip renders an image thumbnail (for image/*), microphone icon (for
// voice / audio/*), or a generic file icon, plus name/size and a remove button.

import { File as FileIcon, FileCode2, Mic } from 'lucide-react';

import type { Attachment } from '@/features/chat/attachments/attachment-utils';
import { formatFileSize } from '@/features/chat/attachments/attachment-utils';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function ComposerAttachmentChips({
  attachments,
  topPadded,
  onRemove,
}: {
  attachments: Attachment[];
  /** Adds a smaller top padding when something (e.g. follow-up stack) is rendered above. */
  topPadded: boolean;
  onRemove: (index: number) => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language).chat;
  if (attachments.length === 0) return null;
  return (
    <div
      className={cn(
        'flex flex-wrap gap-2 border-b border-edge-subtle/90 bg-surface-hover/20 px-4 pb-2 dark:border-edge-subtle',
        topPadded ? 'pt-2' : 'pt-3',
      )}
    >
      {attachments.map((a, index) => (
        <div
          key={a.id ?? `${a.name}-${a.size}-${a.mimeType}-${a.content?.slice(0, 16) ?? ''}`}
          className="flex max-w-[200px] items-center gap-1.5 rounded-lg bg-surface-hover px-2 py-1 text-xs dark:bg-surface-hover/80"
        >
          {a.mimeType?.startsWith('image/') && a.content ? (
            <img
              src={`data:${a.mimeType};base64,${a.content}`}
              alt=""
              className="size-6 rounded object-cover"
            />
          ) : a.type === 'voice' || a.mimeType?.startsWith('audio/') ? (
            <Mic className="size-3.5 shrink-0 text-accent-fg" aria-hidden />
          ) : a.type === 'pasted_text' ? (
            <FileCode2 className="size-3.5 shrink-0 text-accent-fg" aria-hidden />
          ) : (
            <FileIcon className="size-3.5 shrink-0 text-fg-muted" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {a.type === 'pasted_text' ? m.pastedText : a.name}
          </span>
          <span className="text-fg-disabled">{formatFileSize(a.size)}</span>
          <button
            type="button"
            className="text-fg-muted hover:text-fg"
            onClick={() => onRemove(index)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
