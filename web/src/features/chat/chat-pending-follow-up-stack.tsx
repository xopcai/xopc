import { ChevronDown, ChevronUp, FileIcon, GripVertical, Sparkles, X } from 'lucide-react';
import { memo, useCallback } from 'react';

import { MAX_PENDING_FOLLOW_UPS, type PendingFollowUp } from '@/features/chat/pending-follow-up.types';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';

export const ChatPendingFollowUpStack = memo(function ChatPendingFollowUpStack({
  items,
  disabled,
  editingFollowUpId,
  onEditInComposer,
  onRemove,
  onMove,
  onReorder,
  onSteer,
  steeringBusyId,
}: {
  items: PendingFollowUp[];
  disabled?: boolean;
  editingFollowUpId?: string | null;
  onEditInComposer: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: 'up' | 'down') => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onSteer: (id: string) => void;
  steeringBusyId?: string | null;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  const DT_PREFIX = 'xopc-followup:';

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDropRow = useCallback(
    (targetIndex: number) => (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw.startsWith(DT_PREFIX)) return;
      const from = Number.parseInt(raw.slice(DT_PREFIX.length), 10);
      if (Number.isNaN(from) || from === targetIndex) return;
      onReorder(from, targetIndex);
    },
    [onReorder],
  );

  if (items.length === 0) return null;

  return (
    <div
      className="space-y-0.5 px-2 py-1.5"
      role="list"
      aria-label={m.chat.followUpQueueAria}
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-0.5">
        <span className="text-[0.65rem] font-medium uppercase tracking-wide text-fg-muted">
          {m.chat.followUpQueueHeading}
        </span>
        <span className="tabular-nums text-[0.65rem] text-fg-muted">
          {items.length}/{MAX_PENDING_FOLLOW_UPS}
        </span>
      </div>
      {items.map((item, index) => {
        const canSteer = !item.attachments?.length && item.text.trim().length > 0;
        const isSteering = steeringBusyId === item.id;
        let preview = item.text.trim();
        if (!preview && item.attachments?.length) {
          const n0 = item.attachments[0]?.name?.trim();
          preview = n0 || m.chat.followUpQueueAttachmentOnly;
        }
        if (!preview) preview = m.chat.followUpQueueEmptyPreview;
        return (
          <div
            key={item.id}
            role="listitem"
            onDragOver={onDragOver}
            onDrop={disabled ? undefined : onDropRow(index)}
            className={cn(
              'flex h-7 items-center gap-1 rounded border px-1',
              editingFollowUpId === item.id
                ? 'border-accent/50 bg-accent-soft/20 dark:border-accent/50 dark:bg-accent-soft/10'
                : 'border-edge-subtle/80 bg-surface-hover/25 dark:border-edge-subtle/90 dark:bg-surface-hover/15',
            )}
          >
            <div
              draggable={!disabled}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', `${DT_PREFIX}${index}`);
                e.dataTransfer.effectAllowed = 'move';
              }}
              className={cn(
                'flex shrink-0 cursor-grab items-center active:cursor-grabbing',
                disabled && 'cursor-not-allowed opacity-40',
              )}
              title={m.chat.followUpQueueDrag}
            >
              <GripVertical className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
            </div>
            <button
              type="button"
              disabled={disabled}
              title={m.chat.followUpQueueClickToEdit}
              aria-label={m.chat.followUpQueueClickToEdit}
              className={cn(
                'h-6 min-w-0 flex-1 truncate rounded px-1.5 text-left text-[0.75rem] leading-none text-fg hover:bg-surface-panel/60 dark:hover:bg-surface-panel/40',
                interaction.press,
                interaction.focusRingPanel,
                'disabled:pointer-events-none disabled:opacity-50',
              )}
              onClick={() => onEditInComposer(item.id)}
            >
              {item.attachments?.length ? (
                <span className="inline-flex max-w-full items-center gap-1">
                  <FileIcon className="h-3 w-3 shrink-0 text-fg-muted" aria-hidden />
                  <span className="truncate">{preview}</span>
                </span>
              ) : (
                <span className="block truncate">{preview}</span>
              )}
            </button>
            <div className="flex shrink-0 items-center gap-px">
              <button
                type="button"
                disabled={disabled || index === 0}
                className={cn(
                  'inline-flex size-6 items-center justify-center rounded text-fg-muted hover:bg-surface-hover hover:text-fg',
                  interaction.press,
                  interaction.focusRingPanel,
                  'disabled:pointer-events-none disabled:opacity-25',
                )}
                title={m.chat.followUpQueueMoveUp}
                aria-label={m.chat.followUpQueueMoveUp}
                onClick={(e) => {
                  e.stopPropagation();
                  onMove(item.id, 'up');
                }}
              >
                <ChevronUp className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                disabled={disabled || index >= items.length - 1}
                className={cn(
                  'inline-flex size-6 items-center justify-center rounded text-fg-muted hover:bg-surface-hover hover:text-fg',
                  interaction.press,
                  interaction.focusRingPanel,
                  'disabled:pointer-events-none disabled:opacity-25',
                )}
                title={m.chat.followUpQueueMoveDown}
                aria-label={m.chat.followUpQueueMoveDown}
                onClick={(e) => {
                  e.stopPropagation();
                  onMove(item.id, 'down');
                }}
              >
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                disabled={disabled || !canSteer || isSteering}
                className={cn(
                  'inline-flex size-6 items-center justify-center rounded text-accent-fg hover:bg-accent-soft/80',
                  interaction.press,
                  interaction.focusRingPanel,
                  'disabled:pointer-events-none disabled:opacity-35',
                )}
                title={m.chat.followUpQueueSteerNow}
                aria-label={m.chat.followUpQueueSteerNow}
                onClick={(e) => {
                  e.stopPropagation();
                  onSteer(item.id);
                }}
              >
                <Sparkles className={cn('h-3.5 w-3.5', isSteering && 'animate-pulse')} aria-hidden />
              </button>
              <button
                type="button"
                disabled={disabled}
                className={cn(
                  'inline-flex size-6 items-center justify-center rounded text-fg-muted hover:bg-red-500/15 hover:text-red-600 dark:hover:text-red-400',
                  interaction.press,
                  interaction.focusRingPanel,
                )}
                title={m.chat.followUpQueueRemove}
                aria-label={m.chat.followUpQueueRemove}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(item.id);
                }}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        );
      })}
      {items.some((i) => i.attachments?.length) ? (
        <p className="px-1 pt-0.5 text-[0.65rem] leading-tight text-fg-muted">
          {m.chat.followUpQueueAttachmentsNote}
        </p>
      ) : null}
    </div>
  );
});
