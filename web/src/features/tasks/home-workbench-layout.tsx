import * as Popover from '@radix-ui/react-popover';
import { GripHorizontal, Undo2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { routeWheelThroughVerticalScrollChain } from '@/lib/wheel-scroll-chain';

const CARD_IDS = ['attention', 'delivery', 'resume', 'background', 'observation'] as const;
const LANES = ['left', 'right', 'full'] as const;
const STORAGE_KEY = 'xopc.workbench.layout';
const DRAG_TYPE = 'application/x-xopc-workbench-card';
const GAP = 24;
const MIN_LEFT = 340;
const MIN_RIGHT = 304;
const SPLIT_MIN_WIDTH = 864;
const DEFAULT_RATIO = 1 / 1.57;
const MIN_CARD_WIDTH = 260;
const MIN_CARD_HEIGHT = 72;
const MAX_CARD_HEIGHT = 1600;

type CardId = typeof CARD_IDS[number];
type Lane = typeof LANES[number];
type CardSize = { width?: number; height?: number };
type Preferences = {
  order: CardId[];
  lanes: Partial<Record<CardId, Lane>>;
  sizes: Partial<Record<CardId, CardSize>>;
  ratio: number;
};
type Placement = { lane: Lane; anchor?: CardId; after?: boolean };

export type WorkbenchCard = { id: CardId; label: string; lane: Lane; content: ReactNode };

const defaults: Preferences = { order: [...CARD_IDS], lanes: {}, sizes: {}, ratio: DEFAULT_RATIO };

function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const order = Array.isArray(saved?.order)
      ? CARD_IDS.filter((id) => saved.order.includes(id)).sort((a, b) => saved.order.indexOf(a) - saved.order.indexOf(b))
      : [];
    const lanes: Preferences['lanes'] = {};
    const sizes: Preferences['sizes'] = {};
    for (const id of CARD_IDS) {
      const lane = saved?.lanes?.[id];
      if (LANES.includes(lane)) lanes[id] = lane;
      const { width, height } = saved?.sizes?.[id] ?? {};
      const validWidth = Number.isFinite(width) && width >= MIN_CARD_WIDTH;
      const validHeight = Number.isFinite(height) && height >= MIN_CARD_HEIGHT && height <= MAX_CARD_HEIGHT;
      if (validWidth || validHeight) sizes[id] = { width: validWidth ? width : undefined, height: validHeight ? height : undefined };
    }
    const ratio = typeof saved?.ratio === 'number' && saved.ratio > 0 && saved.ratio < 1 ? saved.ratio : DEFAULT_RATIO;
    return { order: [...new Set([...order, ...CARD_IDS])], lanes, sizes, ratio };
  } catch {
    return defaults;
  }
}

const menuItem = 'w-full justify-start rounded-md px-2.5 text-sm text-fg';

function fit(value: number, min: number, max: number) {
  return Math.round(Math.min(max, Math.max(min, value)));
}

export function HomeWorkbenchLayout({ cards, editing, language }: {
  cards: WorkbenchCard[];
  editing: boolean;
  language: 'zh' | 'en';
}) {
  const zh = language === 'zh';
  const [preferences, setPreferences] = useState(readPreferences);
  const [geometry, setGeometry] = useState<{ width: number; heights: Record<string, number> }>({ width: 0, heights: {} });
  const [dragged, setDragged] = useState<CardId>();
  const [target, setTarget] = useState<Placement>();
  const [resizing, setResizing] = useState<CardId | 'columns'>();
  const [undo, setUndo] = useState<Preferences>();
  const [announcement, setAnnouncement] = useState('');
  const surface = useRef<HTMLDivElement>(null);
  const resizeStart = useRef<{ id: number; x: number; width: number; before: Preferences } | null>(null);
  const cardResize = useRef<{
    pointer: number; x: number; y: number; width: number; height: number; before: Preferences;
  } | null>(null);

  useEffect(() => {
    if (resizing) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch { /* Layout still works without storage. */ }
  }, [preferences, resizing]);

  useEffect(() => {
    const root = surface.current;
    const page = root?.closest<HTMLElement>('[data-workbench-page-scroll]');
    if (!root || !page) return;
    const onWheel = (event: WheelEvent) => {
      const card = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-workbench-card-scroll]') : null;
      if (card) routeWheelThroughVerticalScrollChain(event, card, page, { handoffOnly: true });
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);

  const available = geometry.width - GAP;
  const maxLeft = Math.max(MIN_LEFT, available - MIN_RIGHT);
  const leftWidth = Math.max(MIN_LEFT, Math.min(maxLeft, Math.round(available * preferences.ratio)));
  const byId = new Map(cards.map((card) => [card.id, card]));
  const lanes = LANES.map((lane) => preferences.order.flatMap((id) => {
    const card = byId.get(id);
    return card && (preferences.lanes[id] ?? card.lane) === lane ? [card] : [];
  }));
  const hasPinnedColumn = cards.some(({ id }) => preferences.lanes[id] === 'left' || preferences.lanes[id] === 'right');
  const wide = geometry.width >= SPLIT_MIN_WIDTH;
  const split = wide && (editing || hasPinnedColumn || (lanes[0].length > 0 && lanes[1].length > 0));

  useLayoutEffect(() => {
    const root = surface.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    // Keep cards in the same React list when moving between columns so open forms retain their state.
    const measure = () => {
      const width = root.clientWidth;
      const heights: Record<string, number> = {};
      for (const child of root.children) {
        if (child instanceof HTMLElement && child.dataset.workbenchItem) {
          heights[child.dataset.workbenchItem] = Math.ceil(child.getBoundingClientRect().height);
        }
      }
      setGeometry((previous) => previous.width === width
        && Object.keys(previous.heights).length === Object.keys(heights).length
        && Object.entries(heights).every(([id, height]) => previous.heights[id] === height)
        ? previous : { width, heights });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const child of root.children) observer.observe(child);
    measure();
    return () => observer.disconnect();
  }, [cards, editing, split, leftWidth]);

  function move(id: CardId, placement: Placement) {
    const { lane, anchor, after } = placement;
    setUndo(preferences);
    setPreferences((current) => {
      const order = current.order.filter((item) => item !== id);
      order.splice(anchor ? order.indexOf(anchor) + (after ? 1 : 0) : order.length, 0, id);
      return { ...current, order, lanes: { ...current.lanes, [id]: lane } };
    });
    setAnnouncement(zh ? `已移动「${byId.get(id)?.label}」` : `Moved ${byId.get(id)?.label}`);
  }

  function finishDrag() {
    setDragged(undefined);
    setTarget(undefined);
  }

  function drop(event: DragEvent<HTMLElement>, placement: Placement) {
    if (!dragged || event.dataTransfer.getData(DRAG_TYPE) !== dragged || placement.anchor === dragged) return;
    event.preventDefault();
    move(dragged, placement);
    finishDrag();
  }

  function showTarget(event: DragEvent<HTMLElement>, placement: Placement) {
    if (!dragged || placement.anchor === dragged) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setTarget((current) => current?.lane === placement.lane && current.anchor === placement.anchor && current.after === placement.after ? current : placement);
  }

  function relativePlacement(event: DragEvent<HTMLElement>, lane: Lane, anchor: CardId): Placement {
    const rect = event.currentTarget.getBoundingClientRect();
    return { lane, anchor, after: event.clientY >= rect.top + rect.height / 2 };
  }

  function resize(width: number) {
    const next = fit(width, MIN_LEFT, maxLeft);
    if (next === leftWidth) return;
    setPreferences((current) => ({ ...current, ratio: next / available }));
  }

  function finishColumnResize(cancelled: boolean) {
    const start = resizeStart.current;
    if (!start) return;
    resizeStart.current = null;
    setResizing(undefined);
    if (cancelled) setPreferences(start.before);
    else if (preferences.ratio !== start.before.ratio) setUndo(start.before);
  }

  function setCardSize(id: CardId, size: CardSize) {
    setPreferences((current) => {
      const previous = current.sizes[id];
      if (previous?.width === size.width && previous?.height === size.height) return current;
      const sizes = { ...current.sizes, [id]: size };
      if (size.width === undefined && size.height === undefined) delete sizes[id];
      return { ...current, sizes };
    });
  }

  function resetCardSize(card: WorkbenchCard) {
    if (!preferences.sizes[card.id]) return;
    setUndo(preferences);
    setCardSize(card.id, {});
    setAnnouncement(zh ? `「${card.label}」已恢复自动尺寸` : `${card.label} restored to automatic size`);
  }

  function finishCardResize(card: WorkbenchCard, cancelled: boolean) {
    const start = cardResize.current;
    if (!start) return;
    cardResize.current = null;
    setResizing(undefined);
    if (cancelled) {
      setPreferences(start.before);
    } else {
      const before = start.before.sizes[card.id];
      const after = preferences.sizes[card.id];
      if (after?.width !== before?.width || after?.height !== before?.height) {
        setUndo(start.before);
        setAnnouncement(zh ? `已调整「${card.label}」大小` : `Resized ${card.label}`);
      }
    }
  }

  const laneLabels = zh ? ['左栏', '右栏', '全宽'] : ['Left column', 'Right column', 'Full width'];
  const tops = [0, 0, 0];
  const positions = new Map<string, { top: number; left: number; width: number }>();
  const dropZones = LANES.filter((_, index) => editing && lanes[index].length === 0);
  for (const [index, lane] of LANES.entries()) {
    const left = index === 1 ? leftWidth + GAP : 0;
    const width = index === 0 ? leftWidth : index === 1 ? available - leftWidth : geometry.width;
    if (lane === 'full') tops[2] = Math.max(tops[0], tops[1]);
    const items: string[] = lanes[index].map((card) => card.id);
    if (dropZones.includes(lane)) items.push(lane);
    for (const id of items) {
      positions.set(id, { top: tops[index], left, width });
      tops[index] += (geometry.heights[id] ?? 0) + GAP;
    }
  }

  return (
    <div className="min-w-0">
      <span className="sr-only" role="status">{announcement}</span>
      {editing ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 text-xs text-fg-muted">
          <p>{zh ? '拖动上方手柄移动卡片，拖动右下角调整大小。' : 'Drag the top handle to move a card, or its bottom-right corner to resize.'}</p>
          <div className="flex gap-1">
            <Button variant="ghost" className="rounded-lg text-xs" disabled={!undo} onClick={() => {
              if (!undo) return;
              setPreferences(undo);
              setUndo(undefined);
              setAnnouncement(zh ? '已撤销布局调整' : 'Layout change undone');
            }}>
              <Undo2 className="size-3.5" aria-hidden />
              {zh ? '撤销' : 'Undo'}
            </Button>
            <Button variant="ghost" className="rounded-lg text-xs" onClick={() => {
              setUndo(preferences);
              setPreferences(defaults);
            }}>
              {zh ? '恢复默认布局' : 'Reset layout'}
            </Button>
          </div>
        </div>
      ) : null}
      <div
        ref={surface}
        className={cn('relative min-w-0', !split && 'flex flex-col gap-6', resizing && 'select-none')}
        style={split ? { height: Math.max(0, tops[2] - GAP) } : undefined}
      >
        {split ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={zh ? '调整左右栏宽度' : 'Resize workbench columns'}
            aria-valuemin={MIN_LEFT}
            aria-valuemax={maxLeft}
            aria-valuenow={leftWidth}
            tabIndex={0}
            title={zh ? '左右拖动调整栏宽，双击恢复默认' : 'Drag to resize columns, double-click to reset'}
            className="group absolute top-0 z-10 flex w-6 touch-none cursor-col-resize items-start justify-center rounded-lg pt-3 focus-visible:outline-2 focus-visible:outline-accent"
            style={{ left: leftWidth, height: Math.max(0, Math.max(tops[0], tops[1]) - GAP) }}
            onPointerDown={(event) => {
              if (event.button !== 0 || resizing) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              resizeStart.current = { id: event.pointerId, x: event.clientX, width: leftWidth, before: preferences };
              setResizing('columns');
            }}
            onPointerMove={(event) => {
              const start = resizeStart.current;
              if (start?.id === event.pointerId) resize(start.width + event.clientX - start.x);
            }}
            onPointerUp={() => finishColumnResize(false)}
            onPointerCancel={() => finishColumnResize(true)}
            onLostPointerCapture={() => finishColumnResize(true)}
            onDoubleClick={() => {
              setUndo(preferences);
              setPreferences((current) => ({ ...current, ratio: DEFAULT_RATIO }));
            }}
            onKeyDown={(event) => {
              const widths: Record<string, number> = { ArrowLeft: leftWidth - 16, ArrowRight: leftWidth + 16, Home: MIN_LEFT, End: maxLeft };
              if (!Object.hasOwn(widths, event.key)) return;
              event.preventDefault();
              setUndo(preferences);
              resize(widths[event.key]);
            }}
          >
            <span aria-hidden className={cn('h-8 w-px rounded-full bg-edge-strong motion-safe:transition-colors group-hover:bg-accent', resizing === 'columns' && 'bg-accent')} />
          </div>
        ) : null}
        {lanes.flatMap((laneCards, laneIndex) => laneCards.map((card, index) => {
          const lane = LANES[laneIndex];
          const isTarget = target?.anchor === card.id;
          const gripLabel = zh ? `移动「${card.label}」` : `Move ${card.label}`;
          const sizeLabel = zh ? `调整「${card.label}」大小` : `Resize ${card.label}`;
          const position = positions.get(card.id);
          const maxWidth = (split ? position?.width : geometry.width) ?? geometry.width;
          const preferred = preferences.sizes[card.id];
          const width = wide && preferred?.width !== undefined ? Math.min(maxWidth, preferred.width) : undefined;
          const height = preferred?.height;
          const resizingThisCard = resizing === card.id;
          const contentId = `home-workbench-content-${card.id}`;
          return (
            <div
              key={card.id}
              data-workbench-item={card.id}
              data-workbench-lane={lane}
              className={cn(
                'relative min-w-0',
                split && 'absolute',
                dragged === card.id && 'opacity-50',
                editing && 'rounded-xl bg-surface-panel pb-3 shadow-surface ring-1 ring-inset ring-edge pointer-coarse:pb-8',
                editing && '[&_[data-workbench-panel]]:border-transparent [&_[data-workbench-panel]]:bg-transparent [&_[data-workbench-panel]]:shadow-none',
                resizingThisCard && 'ring-2 ring-accent',
              )}
              style={split ? { ...position, width: width ?? position?.width } : { width }}
              onDragOver={dragged ? (event) => showTarget(event, relativePlacement(event, lane, card.id)) : undefined}
              onDrop={dragged ? (event) => drop(event, relativePlacement(event, lane, card.id)) : undefined}
              onDragLeave={(event) => {
                if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                setTarget((current) => current?.anchor === card.id ? undefined : current);
              }}
            >
              {isTarget ? <span aria-hidden className={cn('pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-accent', target.after ? '-bottom-2' : '-top-2')} /> : null}
              {editing ? (
                <div className="flex justify-start px-2 pt-1">
                  <Popover.Root>
                    <Popover.Trigger asChild>
                      <Button
                        variant="ghost"
                        className="h-7 cursor-grab rounded-lg px-3 py-0 active:cursor-grabbing"
                        aria-label={gripLabel}
                        title={gripLabel}
                        draggable
                        onDragStart={(event) => {
                          const block = event.currentTarget.closest<HTMLElement>('[data-workbench-item]');
                          if (block) {
                            const rect = block.getBoundingClientRect();
                            event.dataTransfer.setDragImage(block, event.clientX - rect.left, event.clientY - rect.top);
                          }
                          event.dataTransfer.setData(DRAG_TYPE, card.id);
                          event.dataTransfer.effectAllowed = 'move';
                          setDragged(card.id);
                        }}
                        onDragEnd={finishDrag}
                      >
                        <GripHorizontal className="size-4" aria-hidden />
                      </Button>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content align="start" sideOffset={4} aria-label={gripLabel} className="z-50 min-w-36 rounded-lg border border-edge bg-surface-overlay p-1 shadow-popover">
                        <Popover.Close asChild><Button variant="ghost" className={menuItem} disabled={index === 0} onClick={() => move(card.id, { lane, anchor: laneCards[index - 1]?.id })}>
                          {zh ? '上移' : 'Move up'}
                        </Button></Popover.Close>
                        <Popover.Close asChild><Button variant="ghost" className={menuItem} disabled={index === laneCards.length - 1} onClick={() => move(card.id, { lane, anchor: laneCards[index + 1]?.id, after: true })}>
                          {zh ? '下移' : 'Move down'}
                        </Button></Popover.Close>
                        {LANES.map((destination, destinationIndex) => (
                          <Popover.Close key={destination} asChild><Button variant="ghost" className={menuItem} disabled={destination === lane} onClick={() => move(card.id, { lane: destination })}>
                            {zh ? `移到${laneLabels[destinationIndex]}` : `Move to ${laneLabels[destinationIndex].toLowerCase()}`}
                          </Button></Popover.Close>
                        ))}
                        <Popover.Close asChild>
                          <Button variant="ghost" className={menuItem} disabled={!preferred} onClick={() => resetCardSize(card)}>
                            {zh ? '恢复自动尺寸' : 'Restore automatic size'}
                          </Button>
                        </Popover.Close>
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                </div>
              ) : null}
              <div
                id={contentId}
                data-workbench-card-scroll={height !== undefined ? '' : undefined}
                className={cn(
                  'min-w-0 rounded-xl',
                  editing && (card.id === 'delivery' || card.id === 'resume') && 'px-3',
                  height !== undefined && 'overflow-auto overscroll-y-auto focus-visible:outline-2 focus-visible:outline-accent [&>section]:min-h-full [&>section:has(>[data-workbench-fill])]:flex [&>section:has(>[data-workbench-fill])]:flex-col [&>section>[data-workbench-fill]]:grow',
                )}
                style={{ height }}
                role={height !== undefined ? 'group' : undefined}
                aria-label={height !== undefined ? card.label : undefined}
                tabIndex={height !== undefined ? 0 : undefined}
              >
                {card.content}
              </div>
              {editing ? (
                <>
                  {resizingThisCard ? (
                    <span aria-hidden className="pointer-events-none absolute bottom-2 right-9 z-10 rounded-md bg-accent-soft px-2 py-1 text-xs tabular-nums text-accent-fg">
                      {wide ? `${width ?? maxWidth} × ` : ''}{height ?? cardResize.current?.height} px
                    </span>
                  ) : null}
                  <Button
                    variant="segmented"
                    className={cn(
                      'absolute bottom-0 right-0 z-10 size-8 touch-none rounded-none rounded-br-xl p-0 active:scale-100',
                      'pointer-fine:[clip-path:polygon(0_75%,75%_75%,75%_0,100%_0,100%_100%,0_100%)]',
                      'after:pointer-events-none after:absolute after:inset-0 after:rounded-br-xl after:border-b-2 after:border-r-2 after:border-accent after:opacity-0 motion-safe:after:transition-opacity hover:after:opacity-100 focus-visible:after:opacity-100',
                      wide ? 'cursor-nwse-resize' : 'cursor-ns-resize',
                      resizingThisCard && 'after:opacity-100',
                    )}
                    aria-label={sizeLabel}
                    aria-controls={contentId}
                    title={zh ? '拖动或使用方向键调整大小，双击恢复自动尺寸' : 'Drag or use arrow keys to resize. Double-click to restore automatic size.'}
                    onPointerDown={(event) => {
                      if (event.button !== 0 || resizing) return;
                      const rect = document.getElementById(contentId)?.getBoundingClientRect();
                      if (!rect) return;
                      event.currentTarget.focus({ preventScroll: true });
                      event.preventDefault();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      cardResize.current = {
                        pointer: event.pointerId, x: event.clientX, y: event.clientY,
                        width: Math.round(rect.width), height: Math.round(rect.height), before: preferences,
                      };
                      setResizing(card.id);
                    }}
                    onPointerMove={(event) => {
                      const start = cardResize.current;
                      if (start?.pointer !== event.pointerId) return;
                      const original = start.before.sizes[card.id];
                      const dx = event.clientX - start.x;
                      const dy = event.clientY - start.y;
                      setCardSize(card.id, {
                        width: wide && dx !== 0 ? fit(start.width + dx, MIN_CARD_WIDTH, maxWidth) : original?.width,
                        height: dy !== 0 ? fit(start.height + dy, MIN_CARD_HEIGHT, MAX_CARD_HEIGHT) : original?.height,
                      });
                    }}
                    onPointerUp={() => finishCardResize(card, false)}
                    onPointerCancel={() => finishCardResize(card, true)}
                    onLostPointerCapture={() => finishCardResize(card, true)}
                    onDoubleClick={() => resetCardSize(card)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape' && resizingThisCard) {
                        event.preventDefault();
                        const pointer = cardResize.current?.pointer;
                        finishCardResize(card, true);
                        if (pointer !== undefined && event.currentTarget.hasPointerCapture(pointer)) event.currentTarget.releasePointerCapture(pointer);
                        return;
                      }
                      if (event.key === 'Home' || event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        resetCardSize(card);
                        return;
                      }
                      const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
                      const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
                      if ((!horizontal || !wide) && !vertical) return;
                      const rect = document.getElementById(contentId)?.getBoundingClientRect();
                      if (!rect) return;
                      event.preventDefault();
                      const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -16 : 16;
                      setUndo(preferences);
                      setCardSize(card.id, {
                        width: horizontal ? fit((width ?? rect.width) + delta, MIN_CARD_WIDTH, maxWidth) : preferred?.width,
                        height: vertical ? fit((height ?? rect.height) + delta, MIN_CARD_HEIGHT, MAX_CARD_HEIGHT) : preferred?.height,
                      });
                      setAnnouncement(zh ? `已调整「${card.label}」大小` : `Resized ${card.label}`);
                    }}
                  />
                </>
              ) : null}
            </div>
          );
        }))}
        {dropZones.map((lane) => (
          <div
            key={lane}
            data-workbench-item={lane}
            className={cn('grid min-h-16 place-items-center rounded-xl border border-dashed border-edge-strong text-xs text-fg-muted',
              split && 'absolute', target?.lane === lane && !target.anchor && 'border-accent bg-accent-soft text-accent-fg')}
            style={split ? positions.get(lane) : undefined}
            onDragOver={(event) => showTarget(event, { lane })}
            onDrop={(event) => drop(event, { lane })}
            onDragLeave={() => setTarget((current) => current?.lane === lane && !current.anchor ? undefined : current)}
          >
            {laneLabels[LANES.indexOf(lane)]}
          </div>
        ))}
      </div>
    </div>
  );
}
