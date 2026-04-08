import { Sparkles, Terminal } from 'lucide-react';
import { memo, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import type { PaletteItem } from '@/features/chat/command-palette.types';
import { cn } from '@/lib/cn';

/** Above shell `overflow-hidden`; portal + fixed avoids clipping (only shadow was visible). */
const PORTAL_Z = 100;
/** Cap width so the list stays readable; full composer width is often unnecessarily wide. */
const MAX_PALETTE_WIDTH_PX = 352;

export const CommandPalette = memo(function CommandPalette({
  open,
  anchorRef,
  items,
  selectedIndex,
  noResults,
  onSelectItem,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  items: PaletteItem[];
  selectedIndex: number;
  noResults: string;
  /** Same behavior as choosing the row with Enter (skill pill / slash command). */
  onSelectItem: (item: PaletteItem) => void;
}) {
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }

    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setBox({ left: r.left, top: r.top, width: r.width });
    };

    update();

    const el = anchorRef.current;
    const ro =
      el && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            update();
          })
        : null;
    if (el && ro) ro.observe(el);

    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      if (el && ro) ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef]);

  if (!open || typeof document === 'undefined' || box === null) {
    return null;
  }

  const totalRows = items.length;
  const panelWidth = Math.min(box.width, MAX_PALETTE_WIDTH_PX);

  const shell = (
    <div
      className="pointer-events-auto max-h-[min(24rem,55vh)] min-h-[2.5rem] overflow-y-auto rounded-lg border border-edge bg-surface-panel shadow-lg dark:bg-surface-panel/95"
      style={{
        position: 'fixed',
        left: box.left,
        top: box.top,
        width: panelWidth,
        transform: 'translateY(calc(-100% - 8px))',
        zIndex: PORTAL_Z,
      }}
      role="listbox"
      aria-label="Commands"
      aria-activedescendant={selectedIndex >= 0 && selectedIndex < totalRows ? `palette-${selectedIndex}` : undefined}
    >
      {totalRows === 0 ? (
        <div className="px-3 py-2 text-sm text-fg-muted">{noResults}</div>
      ) : (
        <>
          {items.map((item, i) => (
            <PaletteRow
              key={item.id}
              item={item}
              icon={
                item.kind === 'skill' ? (
                  <Sparkles className="size-3.5 shrink-0 text-accent-fg" aria-hidden />
                ) : (
                  <Terminal className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                )
              }
              selected={selectedIndex === i}
              id={`palette-${i}`}
              onSelect={() => onSelectItem(item)}
            />
          ))}
        </>
      )}
    </div>
  );

  return createPortal(shell, document.body);
});

const PaletteRow = memo(function PaletteRow({
  item,
  icon,
  selected,
  id,
  onSelect,
}: {
  item: PaletteItem;
  icon: ReactNode;
  selected: boolean;
  id: string;
  onSelect: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      className={cn(
        'flex cursor-pointer items-start gap-2 px-3 py-2 text-left text-sm',
        selected ? 'bg-surface-hover text-fg' : 'text-fg-subtle hover:bg-surface-hover/80',
      )}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        onSelect();
      }}
    >
      <span className="mt-0.5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="font-medium text-fg">/{item.name}</span>
        {item.category && item.kind !== 'skill' ? (
          <span className="ml-2 rounded bg-surface-hover px-1.5 py-0.5 text-[0.65rem] text-fg-muted">{item.category}</span>
        ) : null}
        {item.description ? <div className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{item.description}</div> : null}
      </span>
    </div>
  );
});
