import { Wrench } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { SessionTimelineItem } from '@/features/chat/session/session-manager';
import { formatChatMessageTime } from '@/features/chat/messages/message-time';
import {
  buildTimeline,
  formatToolCount,
  type ChatTimelineLabels,
  type TimelineTurn,
} from '@/features/chat/timeline/chat-timeline-rail-model';
import { cn } from '@/lib/cn';

function tickClass(opts: {
  active: boolean;
  scrubbing: boolean;
  distance: number;
}): string {
  const { active, scrubbing, distance } = opts;
  if (!scrubbing) {
    return active ? 'w-3.5 bg-fg-muted' : 'w-2.5 bg-edge-strong/45';
  }
  if (distance === 0) return 'w-7 bg-fg';
  if (distance === 1) return 'w-5 bg-fg-muted';
  if (distance === 2) return 'w-4 bg-edge-strong/70';
  return active ? 'w-3.5 bg-fg-muted' : 'w-2.5 bg-edge-strong/45';
}

function TimelinePreviewCard({
  turn,
  labels,
}: {
  turn: TimelineTurn;
  labels: ChatTimelineLabels;
}) {
  const visibleTools = turn.tools.slice(0, 3);
  const hiddenToolCount = Math.max(0, turn.tools.length - visibleTools.length);
  const visibleEvents = turn.events.slice(0, Math.max(0, 3 - visibleTools.length));
  const hiddenEventCount = Math.max(0, turn.events.length - visibleEvents.length);
  const hiddenItemCount = hiddenToolCount + hiddenEventCount;
  const detailText =
    turn.tools.length > 0 || turn.events.length > 0
      ? [
          ...visibleTools.map((tool) => tool.label),
          ...visibleEvents.map((event) => event.label),
          ...(hiddenItemCount > 0 ? [`+${hiddenItemCount}`] : []),
        ].join(' · ')
      : turn.title;

  return (
    <div
      className={cn(
        'pointer-events-auto absolute right-12 top-1/2 z-[100] w-[min(25rem,calc(100vw-8rem))] -translate-y-1/2',
        'rounded-2xl border border-edge bg-surface-panel/95 p-3 text-left shadow-popover backdrop-blur',
      )}
    >
      {turn.timestamp ? (
        <div className="mb-1 flex min-w-0 justify-end text-xs">
          <time
            suppressHydrationWarning
            className="shrink-0 tabular-nums text-fg-disabled"
            dateTime={new Date(turn.timestamp).toISOString()}
          >
            {formatChatMessageTime(turn.timestamp)}
          </time>
        </div>
      ) : null}
      <div className="min-w-0 text-sm font-semibold leading-5 text-fg">
        <span className="line-clamp-1">{turn.preview}</span>
      </div>
      <div className="mt-1 line-clamp-3 text-sm leading-6 text-fg-muted">{detailText}</div>
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-sm text-fg-subtle">
        {turn.tools.length > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <Wrench className="size-3.5 shrink-0" aria-hidden />
            <span>{formatToolCount(turn.tools.length, labels)}</span>
          </span>
        ) : (
          <span>{turn.title}</span>
        )}
        {visibleTools.map((tool) => (
          <span
            key={tool.key}
            className={cn(
              'inline-flex min-w-0 max-w-[9rem] items-center gap-1.5',
              tool.running && 'text-accent',
            )}
          >
            <Wrench className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{tool.label}</span>
          </span>
        ))}
        {visibleEvents.map((event) => (
          <span
            key={event.key}
            className={cn(
              'inline-flex min-w-0 max-w-[10rem] items-center gap-1.5',
              event.tone === 'branch' && 'text-accent',
              event.tone === 'compaction' && 'text-fg-muted',
            )}
          >
            <span className="size-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden />
            <span className="truncate">{event.label}</span>
          </span>
        ))}
        {hiddenItemCount > 0 ? <span>+{hiddenItemCount}</span> : null}
      </div>
    </div>
  );
}

export function ChatTimelineRail({
  items,
  activeMessageIndex,
  labels,
  onSelectMessage,
}: {
  items: SessionTimelineItem[];
  activeMessageIndex: number;
  labels: ChatTimelineLabels;
  onSelectMessage: (messageIndex: number) => void;
}) {
  const turns = useMemo(() => buildTimeline(items, labels), [items, labels]);
  const [previewTurnId, setPreviewTurnId] = useState<string | null>(null);
  const railRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!previewTurnId) return undefined;

    const close = () => {
      setPreviewTurnId(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!railRef.current?.contains(target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [previewTurnId]);

  if (turns.length < 4) return null;

  let activeTurnId = turns[0]?.id;
  for (const turn of turns) {
    if (turn.messageIndex <= activeMessageIndex) {
      activeTurnId = turn.id;
    }
  }
  const selectedTurnId = previewTurnId ?? activeTurnId;
  const previewTurn = previewTurnId ? turns.find((turn) => turn.id === previewTurnId) : null;
  const scrubbing = previewTurnId !== null;
  const selectedTurnIndex = Math.max(
    0,
    turns.findIndex((turn) => turn.id === selectedTurnId),
  );

  return (
    <aside
      ref={railRef}
      className="hidden h-full min-h-0 max-h-full w-12 shrink-0 items-center overflow-visible py-4 xl:flex"
      aria-label={labels.title}
      onMouseLeave={() => {
        setPreviewTurnId(null);
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          setPreviewTurnId(null);
        }
      }}
    >
      <div className="relative z-[90] flex h-full min-h-0 w-full flex-col justify-center overflow-visible">
        <div className="chat-timeline-scroll flex min-h-0 w-full flex-col">
          <ol
            className="my-auto flex w-full shrink-0 flex-col items-end py-1"
            onMouseEnter={() => setPreviewTurnId((current) => current ?? activeTurnId ?? null)}
          >
            {turns.map((turn, index) => {
              const active = turn.id === selectedTurnId;
              const distance = Math.abs(index - selectedTurnIndex);
              return (
                <li
                  key={turn.id}
                  className="group relative flex h-3.5 w-full shrink-0 items-center justify-end"
                  onMouseEnter={() => setPreviewTurnId(turn.id)}
                  onFocus={() => setPreviewTurnId(turn.id)}
                >
                  <button
                    type="button"
                    className={cn(
                      'flex h-3.5 w-full items-center justify-end rounded-sm pr-1.5',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    )}
                    onClick={() => onSelectMessage(turn.messageIndex)}
                    aria-label={`${turn.title}: ${turn.preview}`}
                  >
                    <span
                      className={cn(
                        'block h-0.5 rounded-full transition-[width,background-color] duration-150 ease-out',
                        tickClass({ active, scrubbing, distance }),
                        'group-hover:bg-fg',
                      )}
                      aria-hidden
                    />
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        {previewTurn ? <TimelinePreviewCard turn={previewTurn} labels={labels} /> : null}
      </div>
    </aside>
  );
}
