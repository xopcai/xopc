import { FileText, Folder, Hash, Link2, Loader2, ScrollText } from 'lucide-react';
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import type { AtCategory, AtMentionItem } from '@/features/chat/at-mention-api';
import { fileExtColor } from '@/features/file-tree/file-tree';
import { cn } from '@/lib/cn';
import { readWorkspaceFile } from '@/features/workspace/workspace-api';

const PORTAL_Z = 100;
const MAX_PALETTE_WIDTH_PX = 400;
const PREVIEW_MAX_CHARS = 900;

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

const categoryIcon = {
  files: FileText,
  docs: ScrollText,
  symbols: Hash,
  urls: Link2,
} as const;

export const AtMentionPicker = memo(function AtMentionPicker({
  open,
  anchorRef,
  category,
  onCategoryChange,
  tabLabels,
  items,
  selectedIndex,
  loading,
  query,
  noResults,
  sessionKey,
  recentLabel,
  onSelectItem,
  shiftHint,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  category: AtCategory;
  onCategoryChange: (c: AtCategory) => void;
  tabLabels: Record<AtCategory, string>;
  items: AtMentionItem[];
  selectedIndex: number;
  loading: boolean;
  query: string;
  noResults: string;
  sessionKey: string | null;
  recentLabel: string;
  onSelectItem: (item: AtMentionItem, meta?: { shiftKey?: boolean }) => void;
  shiftHint?: string;
}) {
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{ text: string; x: number; y: number } | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewAbortRef = useRef(0);

  const clearPreviewTimer = () => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  };

  const schedulePreview = useCallback(
    (item: AtMentionItem, clientX: number, clientY: number) => {
      clearPreviewTimer();
      previewAbortRef.current += 1;
      const rid = previewAbortRef.current;
      if (
        !sessionKey?.trim() ||
        item.isDirectory ||
        item.isBrowseUp ||
        (item.pickKind !== 'file' && item.pickKind !== 'doc') ||
        !item.relativePath
      ) {
        setHoverPreview(null);
        return;
      }
      previewTimerRef.current = setTimeout(async () => {
        previewTimerRef.current = null;
        if (rid !== previewAbortRef.current) return;
        try {
          const { content } = await readWorkspaceFile(item.relativePath, { sessionKey });
          const snippet = content.length > PREVIEW_MAX_CHARS ? `${content.slice(0, PREVIEW_MAX_CHARS)}…` : content;
          if (rid !== previewAbortRef.current) return;
          setHoverPreview({ text: snippet, x: clientX, y: clientY });
        } catch {
          if (rid !== previewAbortRef.current) return;
          setHoverPreview(null);
        }
      }, 420);
    },
    [sessionKey],
  );

  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      setHoverPreview(null);
      clearPreviewTimer();
      previewAbortRef.current += 1;
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
  const categories: AtCategory[] = ['files', 'docs', 'symbols', 'urls'];

  const shell = (
    <div
      className="pointer-events-auto max-h-[min(28rem,60vh)] min-h-[2.5rem] overflow-hidden rounded-lg border border-edge bg-surface-panel shadow-lg dark:bg-surface-panel/95"
      style={{
        position: 'fixed',
        left: box.left,
        top: box.top,
        width: panelWidth,
        transform: 'translateY(calc(-100% - 8px))',
        zIndex: PORTAL_Z,
      }}
      role="presentation"
    >
      <div className="flex gap-0.5 border-b border-edge-subtle px-1.5 py-1.5">
        {categories.map((c) => {
          const Icon = categoryIcon[c];
          const active = category === c;
          return (
            <button
              key={c}
              type="button"
              className={cn(
                'inline-flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[0.7rem] font-medium',
                active
                  ? 'bg-surface-hover text-fg'
                  : 'text-fg-muted hover:bg-surface-hover/70 hover:text-fg',
              )}
              onPointerDown={(e) => {
                e.preventDefault();
                onCategoryChange(c);
              }}
            >
              <Icon className="size-3 shrink-0 opacity-80" aria-hidden />
              <span className="truncate">{tabLabels[c]}</span>
            </button>
          );
        })}
      </div>
      <div
        className="max-h-[min(22rem,48vh)] overflow-y-auto"
        role="listbox"
        aria-label={tabLabels[category]}
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
                key={`${item.pickKind}-${item.relativePath}-${item.name}-${item.line ?? i}`}
                id={`at-mention-${i}`}
                role="option"
                aria-selected={selectedIndex === i}
                tabIndex={-1}
                className={cn(
                  'flex cursor-pointer items-start gap-2 px-3 py-2 text-left text-sm',
                  selectedIndex === i ? 'bg-surface-hover text-fg' : 'text-fg-subtle hover:bg-surface-hover/80',
                  item.isRecent && 'border-l-2 border-l-accent/60',
                )}
                onPointerDown={(e) => {
                  if (e.pointerType === 'mouse' && e.button !== 0) return;
                  e.preventDefault();
                  onSelectItem(item, { shiftKey: e.shiftKey });
                }}
                onPointerEnter={(e) => schedulePreview(item, e.clientX, e.clientY)}
                onPointerLeave={() => {
                  clearPreviewTimer();
                  previewAbortRef.current += 1;
                  setHoverPreview(null);
                }}
              >
                <span className="mt-0.5 shrink-0">
                  {item.isBrowseUp ? (
                    <Folder className="size-3.5 text-fg-muted" aria-hidden />
                  ) : item.pickKind === 'symbol' ? (
                    <Hash className="size-3.5 text-violet-600 dark:text-violet-400" aria-hidden />
                  ) : item.pickKind === 'url' ? (
                    <Link2 className="size-3.5 text-sky-600 dark:text-sky-400" aria-hidden />
                  ) : item.pickKind === 'doc' ? (
                    <ScrollText className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  ) : item.isDirectory ? (
                    <Folder className="size-3.5 text-amber-600 dark:text-amber-400" aria-hidden />
                  ) : (
                    <FileText className={cn('size-3.5', fileExtColor(item.name))} aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 truncate">
                    <span className="truncate">
                      {item.pickKind === 'symbol' ? (
                        <span className="font-medium text-fg">{item.name}</span>
                      ) : (
                        <NameWithHighlights name={item.name} query={query} />
                      )}
                    </span>
                    {item.isRecent ? (
                      <span className="shrink-0 rounded bg-accent-soft px-1 py-0 text-[0.65rem] text-accent-fg">
                        {recentLabel}
                      </span>
                    ) : null}
                  </div>
                  {item.pickKind === 'symbol' && item.preview ? (
                    <div className="mt-0.5 line-clamp-2 font-mono text-[0.7rem] text-fg-muted">{item.preview}</div>
                  ) : (
                    <div className="mt-0.5 truncate text-xs text-fg-muted">
                      {item.pickKind === 'symbol' ? item.relativePath : item.relativePath || '—'}
                    </div>
                  )}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
      {shiftHint ? <div className="border-t border-edge-subtle px-3 py-1.5 text-[0.65rem] text-fg-muted">{shiftHint}</div> : null}
      {hoverPreview ? (
        <div
          className="pointer-events-none fixed z-[200] max-h-48 max-w-sm overflow-auto rounded-md border border-edge bg-surface-panel p-2 font-mono text-[0.7rem] text-fg shadow-lg"
          style={{
            left: Math.min(hoverPreview.x + 12, window.innerWidth - 320),
            top: Math.min(hoverPreview.y + 12, window.innerHeight - 200),
          }}
        >
          {hoverPreview.text}
        </div>
      ) : null}
    </div>
  );

  return createPortal(shell, document.body);
});
