import * as Dialog from '@radix-ui/react-dialog';
import { History, Wrench, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatChatMessageTime } from '@/features/chat/messages/message-time';
import type { SessionTimelineItem } from '@/features/chat/session/session-manager';
import {
  buildTimeline,
  formatToolCount,
  type ChatTimelineLabels,
  type TimelineTurn,
} from '@/features/chat/timeline/chat-timeline-rail-model';
import { cn } from '@/lib/cn';

function activeTurnIdFor(turns: TimelineTurn[], activeMessageIndex: number): string | undefined {
  let activeTurnId = turns[0]?.id;
  for (const turn of turns) {
    if (turn.messageIndex <= activeMessageIndex) {
      activeTurnId = turn.id;
    }
  }
  return activeTurnId;
}

function TimelineRow({
  turn,
  active,
  labels,
  currentLabel,
  onSelect,
}: {
  turn: TimelineTurn;
  active: boolean;
  labels: ChatTimelineLabels;
  currentLabel: string;
  onSelect: () => void;
}) {
  const visibleTools = turn.tools.slice(0, 2);
  const visibleEvents = turn.events.slice(0, Math.max(0, 3 - visibleTools.length));
  const hiddenToolCount = Math.max(0, turn.tools.length - visibleTools.length);
  const hiddenEventCount = Math.max(0, turn.events.length - visibleEvents.length);
  const hiddenItemCount = hiddenToolCount + hiddenEventCount;

  return (
    <li>
      <button
        type="button"
        className={cn(
          'flex w-full min-w-0 items-start gap-3 border-b border-edge-subtle px-4 py-3 text-left transition-colors',
          'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
          active && 'bg-accent-soft/70',
        )}
        onClick={onSelect}
      >
        <span
          className={cn(
            'mt-1 size-2.5 shrink-0 rounded-full border border-edge-strong bg-surface-panel',
            active && 'border-accent bg-accent',
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm font-medium text-fg">{turn.preview}</span>
            {active ? (
              <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white">
                {currentLabel}
              </span>
            ) : null}
          </span>
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
            <span>{turn.title}</span>
            {turn.timestamp ? (
              <time suppressHydrationWarning dateTime={new Date(turn.timestamp).toISOString()}>
                {formatChatMessageTime(turn.timestamp)}
              </time>
            ) : null}
            {turn.tools.length > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Wrench className="size-3.5 shrink-0" aria-hidden />
                {formatToolCount(turn.tools.length, labels)}
              </span>
            ) : null}
          </span>
          {visibleTools.length > 0 || turn.events.length > 0 ? (
            <span className="mt-2 flex min-w-0 flex-wrap gap-1.5">
              {visibleTools.map((tool) => (
                <span
                  key={tool.key}
                  className={cn(
                    'inline-flex max-w-[9rem] items-center gap-1 rounded-md bg-surface-hover px-1.5 py-0.5 text-[11px] text-fg-muted',
                    tool.running && 'text-accent-fg',
                  )}
                >
                  <Wrench className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{tool.label}</span>
                </span>
              ))}
              {visibleEvents.map((event) => (
                <span
                  key={event.key}
                  className="inline-flex max-w-[10rem] items-center gap-1 rounded-md bg-surface-hover px-1.5 py-0.5 text-[11px] text-fg-muted"
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden />
                  <span className="truncate">{event.label}</span>
                </span>
              ))}
              {hiddenItemCount > 0 ? (
                <span className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[11px] text-fg-muted">
                  +{hiddenItemCount}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

export function ChatTimelinePanel({
  items,
  activeMessageIndex,
  labels,
  openLabel,
  closeLabel,
  currentLabel,
  onSelectMessage,
}: {
  items: SessionTimelineItem[];
  activeMessageIndex: number;
  labels: ChatTimelineLabels;
  openLabel: string;
  closeLabel: string;
  currentLabel: string;
  onSelectMessage: (messageIndex: number) => void;
}) {
  const turns = useMemo(() => buildTimeline(items, labels), [items, labels]);
  const [open, setOpen] = useState(false);

  if (turns.length < 4) return null;

  const activeTurnId = activeTurnIdFor(turns, activeMessageIndex);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="size-11 shrink-0 rounded-full p-0 xl:hidden"
          aria-label={openLabel}
          title={openLabel}
        >
          <History className="size-5" strokeWidth={1.75} aria-hidden />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim/70 backdrop-blur-[1px] xl:hidden" />
        <Dialog.Content
          className={cn(
            'fixed bottom-0 left-0 right-0 z-[90] flex h-[min(72dvh,34rem)] flex-col overflow-hidden',
            'rounded-t-xl border border-edge bg-surface-panel shadow-popover outline-none',
            'md:bottom-auto md:left-auto md:right-4 md:top-20 md:h-[min(calc(100dvh-7rem),40rem)] md:w-[22rem] md:rounded-xl',
            'xl:hidden',
          )}
          aria-describedby={undefined}
        >
          <div className="flex min-w-0 shrink-0 items-center justify-between gap-3 border-b border-edge px-4 py-3">
            <Dialog.Title className="min-w-0 truncate text-base font-semibold text-fg">
              {labels.title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" className="size-8 shrink-0 p-0" aria-label={closeLabel}>
                <X className="size-4" strokeWidth={1.75} aria-hidden />
              </Button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ol className="min-w-0">
              {turns.map((turn) => (
                <TimelineRow
                  key={turn.id}
                  turn={turn}
                  active={turn.id === activeTurnId}
                  labels={labels}
                  currentLabel={currentLabel}
                  onSelect={() => {
                    onSelectMessage(turn.messageIndex);
                    setOpen(false);
                  }}
                />
              ))}
            </ol>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
