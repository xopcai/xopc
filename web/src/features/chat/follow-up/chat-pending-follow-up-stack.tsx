import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { CornerDownRight, ChevronDown, ChevronUp, Ellipsis, FileIcon, GripVertical, ListEnd, MessageCirclePlus, NotebookPen, Pencil, Trash2 } from 'lucide-react';
import { memo, useRef } from 'react';
import { parseUserTurnDocument, renderUserTurnDocument, userTurnDocumentRefIds } from '@xopcai/gateway-contract';

import { useFollowUpRowDrag } from './use-follow-up-row-drag';

import { MAX_PENDING_FOLLOW_UPS, type PendingFollowUp } from '@/features/chat/follow-up/pending-follow-up.types';
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
  queueingEnabled = true,
  onToggleQueueing,
  onOpenSideChat,
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
  queueingEnabled?: boolean;
  onToggleQueueing?: () => void;
  onOpenSideChat?: (item: PendingFollowUp, preview: string) => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  const keepComposerFocus = useRef(false);
  const queuedItems = items.filter((row) => row.status === 'queued');
  const busy = Boolean(disabled || steeringBusyId);
  const drag = useFollowUpRowDrag({ items, disabled: busy, onReorder });
  const actionClass = cn('inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35', interaction.focusRingPanel);
  const menuItemClass = 'flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-fg outline-none focus:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-35';

  if (items.length === 0) return null;

  return (
    <div
      ref={drag.listRef}
      className="space-y-1 px-2 py-2"
      onClickCapture={drag.onClickCapture}
      role="list"
      aria-label={m.chat.followUpQueueAria}
    >
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        <span className="text-xs font-medium text-fg-muted">
          {m.chat.followUpQueueHeading}
        </span>
        <span className="tabular-nums text-[0.65rem] text-fg-muted">
          {items.length}/{MAX_PENDING_FOLLOW_UPS}
        </span>
      </div>
      {items.map((item) => {
        const mutable = item.status === 'queued';
        const removable = mutable || item.status === 'interrupted';
        const queuedIndex = queuedItems.findIndex((row) => row.id === item.id);
        const canSteer = removable && !item.attachments?.length && !item.contextRefs?.length && item.text.trim().length > 0;
        const isSteering = steeringBusyId === item.id;
        const statusText = item.status === 'interrupted' ? m.chat.followUpStatusInterrupted : null;
        const document = parseUserTurnDocument(item.text);
        const refsById = new Map(item.contextRefs?.flatMap(ref => ref.refId ? [[ref.refId, ref.title] as const] : []) ?? []);
        const inlineRefIds = new Set(document ? userTurnDocumentRefIds(document) : []);
        const detachedRefs = item.contextRefs?.filter(ref => !ref.refId || !inlineRefIds.has(ref.refId));
        let preview = (document
          ? renderUserTurnDocument(document, refId => refsById.get(refId))
          : item.text).trim();
        if (!preview && item.attachments?.length) {
          const n0 = item.attachments[0]?.name?.trim();
          preview = n0 || m.chat.followUpQueueAttachmentOnly;
        }
        if (!preview) preview = m.chat.followUpQueueEmptyPreview;
        return (
          <div
            key={item.id}
            role="listitem"
            data-follow-up-id={item.id}
            data-follow-up-sortable={!busy && mutable}
            onPointerDown={(event) => drag.onPointerDown(event, item)}
            onDragStart={(event) => event.preventDefault()}
            style={{ transform: drag.view?.shifts[item.id] ? `translateY(${drag.view.shifts[item.id]}px)` : undefined }}
            className={cn(
              'relative flex min-h-10 items-center gap-1 rounded-lg px-1.5 py-1 motion-safe:transition-transform motion-safe:duration-150',
              !busy && mutable && 'cursor-grab',
              drag.view?.id === item.id && 'bg-surface-inset ring-1 ring-inset ring-edge-strong [&>*]:invisible',
              editingFollowUpId === item.id
                ? 'bg-accent-soft ring-1 ring-inset ring-accent/30'
                : 'hover:bg-surface-hover/50',
            )}
          >
            <div
              data-follow-up-drag-handle
              className={cn(
                'flex shrink-0 touch-none cursor-grab items-center active:cursor-grabbing',
                (busy || !mutable) && 'cursor-not-allowed opacity-40',
              )}
              title={m.chat.followUpQueueDrag}
            >
              <GripVertical className="size-3.5 text-fg-muted" aria-hidden />
            </div>
            <button
              type="button"
              data-follow-up-drag-surface
              disabled={busy || !mutable}
              title={m.chat.followUpQueueClickToEdit}
              aria-label={m.chat.followUpQueueClickToEdit}
              className={cn(
                'min-h-8 min-w-0 flex-1 cursor-grab rounded-md px-1.5 text-left text-sm text-fg',
                interaction.focusRingPanel,
                'disabled:pointer-events-none disabled:opacity-50',
              )}
              onClick={() => onEditInComposer(item.id)}
            >
              {item.attachments?.length ? (
                <span className="inline-flex max-w-full items-center gap-1">
                  <FileIcon className="size-3 shrink-0 text-fg-muted" aria-hidden />
                  <span className="truncate">{preview}</span>
                </span>
              ) : (
                <span className="line-clamp-2 break-words [overflow-wrap:anywhere]">{preview}</span>
              )}
            </button>
            {detachedRefs?.length ? (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 rounded bg-accent-soft px-1.5 py-0.5 text-[0.625rem] text-accent-fg"
                title={detachedRefs.map((ref) => ref.title).join(', ')}
              >
                <NotebookPen className="size-3" aria-hidden />
                {detachedRefs.length}
              </span>
            ) : null}
            {statusText ? (
              <span className="shrink-0 rounded bg-surface-panel px-1.5 py-0.5 text-[0.625rem] text-fg-muted">
                {statusText}
              </span>
            ) : null}
            <div className="flex shrink-0 items-center gap-0.5">
              <button type="button" className={actionClass} disabled={busy || !canSteer}
                title={m.chat.followUpQueueSteerHint} aria-label={m.chat.followUpQueueSteerNow}
                aria-busy={isSteering} onClick={() => onSteer(item.id)}>
                <CornerDownRight className={cn('size-4', isSteering && 'motion-safe:animate-pulse')} aria-hidden />
                <span className="hidden text-xs sm:inline">{m.chat.followUpQueueSteerNow}</span>
              </button>
              <button type="button" className={cn(actionClass, 'px-1.5 hover:text-danger')}
                disabled={busy || !removable} title={m.chat.followUpQueueRemove}
                aria-label={m.chat.followUpQueueRemove} onClick={() => onRemove(item.id)}>
                <Trash2 className="size-4" aria-hidden />
              </button>
              <DropdownMenu.Root modal={false}>
                <DropdownMenu.Trigger asChild>
                  <button type="button" className={cn(actionClass, 'px-1.5')} disabled={busy}
                    title={m.chat.followUpQueueMore} aria-label={m.chat.followUpQueueMore}>
                    <Ellipsis className="size-4" aria-hidden />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content side="top" align="end" sideOffset={6}
                    onCloseAutoFocus={(event) => {
                      if (keepComposerFocus.current) event.preventDefault();
                      keepComposerFocus.current = false;
                    }}
                    className="z-50 min-w-52 max-w-[calc(100vw-2rem)] rounded-xl border border-edge bg-surface-overlay p-1 shadow-popover">
                    <DropdownMenu.Item className={menuItemClass} disabled={!mutable}
                      onSelect={() => {
                        keepComposerFocus.current = true;
                        onEditInComposer(item.id);
                      }}>
                      <Pencil className="size-4" aria-hidden />{m.chat.followUpQueueClickToEdit}
                    </DropdownMenu.Item>
                    {onOpenSideChat ? <DropdownMenu.Item className={menuItemClass} disabled={!canSteer}
                      onSelect={() => onOpenSideChat(item, preview)}>
                      <MessageCirclePlus className="size-4" aria-hidden />{m.chat.followUpQueueOpenSideChat}
                    </DropdownMenu.Item> : null}
                    {queuedItems.length > 1 ? <>
                      <DropdownMenu.Separator className="my-1 h-px bg-edge-subtle" />
                      <DropdownMenu.Item className={menuItemClass} disabled={!mutable || queuedIndex === 0}
                        onSelect={() => onMove(item.id, 'up')}>
                        <ChevronUp className="size-4" aria-hidden />{m.chat.followUpQueueMoveUp}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className={menuItemClass} disabled={!mutable || queuedIndex >= queuedItems.length - 1}
                        onSelect={() => onMove(item.id, 'down')}>
                        <ChevronDown className="size-4" aria-hidden />{m.chat.followUpQueueMoveDown}
                      </DropdownMenu.Item>
                    </> : null}
                    {onToggleQueueing ? <>
                      <DropdownMenu.Separator className="my-1 h-px bg-edge-subtle" />
                      <DropdownMenu.Item className={menuItemClass} onSelect={onToggleQueueing}>
                        <ListEnd className="size-4" aria-hidden />
                        {queueingEnabled ? m.chat.followUpQueueTurnOff : m.chat.followUpQueueTurnOn}
                      </DropdownMenu.Item>
                    </> : null}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </div>
        );
      })}
      {items.some((i) => i.attachments?.length || i.contextRefs?.length) ? (
        <p className="px-1 pt-0.5 text-[0.65rem] leading-tight text-fg-muted">
          {m.chat.followUpQueueAttachmentsNote}
        </p>
      ) : null}
    </div>
  );
});
