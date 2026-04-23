import { FileText, Folder, Loader2 } from 'lucide-react';
import { memo, useLayoutEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import type { AtMentionItem } from '@/features/chat/at-mention-api';
import { fileExtColor } from '@/features/file-tree/file-tree';
import { cn } from '@/lib/cn';

const PORTAL_Z = 100;
const MAX_PALETTE_WIDTH_PX = 400;

/** Highlight matched characters for subsequence of `query` in `name` (case-insensitive). */
function matchRangesForName(name: string, query: string): [number, number][] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const n = name.toLowerCase();
  const ranges: [number, number][] = [];
  let qi = 0;
  for (let i = 0; i < n.length && qi < q.length; i++) {
    if (n[i] === q[qi]) {
      ranges.push([i, i + 1]);
      qi++;
    }
  }
  return ranges;
}

function NameWithHighlights({ name, query }: { name: string; query: string }) {
  const ranges = useMemo(() => matchRangesForName(name, query), [name, query]);
  if (ranges.length === 0) {
    return <span className="font-medium text-fg">{name}</span>;
  }
  const parts: ReactNode[] = [];
  let last = 0;
  ranges.forEach(([a, b], idx) => {
    if (a > last) {
      parts.push(
        <span key={`t-${idx}-pre`} className="font-medium text-fg">
          {name.slice(last, a)}
        </span>,
      );
    }
    parts.push(
      <span key={`h-${idx}`} className="font-semibold text-accent-fg">
        {name.slice(a, b)}
      </span>,
    );
    last = b;
  });
  if (last < name.length) {
    parts.push(
      <span key="tail" className="font-medium text-fg">
        {name.slice(last)}
      </span>,
    );
  }
  return <>{parts}</>;
}

export const AtMentionPicker = memo(function AtMentionPicker({
  open,
  anchorRef,
  items,
  selectedIndex,
  loading,
  query,
  noResults,
  onSelectItem,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  items: AtMentionItem[];
  selectedIndex: number;
  loading: boolean;
  query: string;
  noResults: string;
  onSelectItem: (item: AtMentionItem) => void;
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
      aria-label="File search"
      aria-activedescendant={selectedIndex >= 0 && selectedIndex < totalRows ? `at-mention-${selectedIndex}` : undefined}
    >
      {loading && totalRows === 0 ? (
        <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-fg-muted">
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
          <span>…</span>
        </div>
      ) : null}
      {!loading && totalRows === 0 ? (
        <div className="px-3 py-2 text-sm text-fg-muted">{noResults}</div>
      ) : (
        <>
          {items.map((item, i) => (
            <div
              key={`${item.relativePath}-${item.isDirectory}`}
              id={`at-mention-${i}`}
              role="option"
              aria-selected={selectedIndex === i}
              tabIndex={-1}
              className={cn(
                'flex cursor-pointer items-start gap-2 px-3 py-2 text-left text-sm',
                selectedIndex === i ? 'bg-surface-hover text-fg' : 'text-fg-subtle hover:bg-surface-hover/80',
              )}
              onPointerDown={(e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                e.preventDefault();
                onSelectItem(item);
              }}
            >
              <span className="mt-0.5 shrink-0">
                {item.isDirectory ? (
                  <Folder className="size-3.5 text-amber-600 dark:text-amber-400" aria-hidden />
                ) : (
                  <FileText className={cn('size-3.5', fileExtColor(item.name))} aria-hidden />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <div className="truncate">
                  <NameWithHighlights name={item.name} query={query} />
                </div>
                <div className="mt-0.5 truncate text-xs text-fg-muted">{item.relativePath}</div>
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );

  return createPortal(shell, document.body);
});
