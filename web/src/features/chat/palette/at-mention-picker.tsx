import { FileText, Folder, Loader2, NotebookPen } from 'lucide-react';
import {
  Fragment,
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import type { AtMentionItem } from '@/features/chat/palette/at-mention-api';
import { fileExtColor } from '@/features/file-tree/file-tree-utils';
import { cn } from '@/lib/cn';
import { readWorkspaceFile } from '@/features/workspace/workspace-api';

const PORTAL_Z = 100;
const MAX_PALETTE_WIDTH_PX = 400;
const PREVIEW_MAX_CHARS = 900;

type PickerLayoutState = {
  box: { left: number; top: number; width: number } | null;
  hoverPreview: { text: string; x: number; y: number } | null;
};

type PickerLayoutAction =
  | { type: 'reset' }
  | { type: 'set-box'; box: NonNullable<PickerLayoutState['box']> }
  | { type: 'set-hover'; hoverPreview: PickerLayoutState['hoverPreview'] };

function pickerLayoutReducer(state: PickerLayoutState, action: PickerLayoutAction): PickerLayoutState {
  switch (action.type) {
    case 'reset':
      return { box: null, hoverPreview: null };
    case 'set-box':
      return { ...state, box: action.box };
    case 'set-hover':
      return { ...state, hoverPreview: action.hoverPreview };
  }
}

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
  ranges.forEach(([a, b]) => {
    if (a > last) {
      parts.push(
        <span key={`pre-${a}`} className="font-medium text-fg">
          {name.slice(last, a)}
        </span>,
      );
    }
    parts.push(
      <span key={`hl-${a}-${b}`} className="font-semibold text-accent-fg">
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
  sessionKey,
  recentLabel,
  filesLabel,
  notesLabel,
  ariaLabel,
  onSelectItem,
  shiftHint,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  items: AtMentionItem[];
  selectedIndex: number;
  loading: boolean;
  query: string;
  noResults: string;
  sessionKey: string | null;
  recentLabel: string;
  filesLabel: string;
  notesLabel: string;
  ariaLabel: string;
  onSelectItem: (item: AtMentionItem, meta?: { shiftKey?: boolean }) => void;
  shiftHint?: string;
}) {
  const [layout, dispatchLayout] = useReducer(pickerLayoutReducer, {
    box: null,
    hoverPreview: null,
  });
  const box = layout.box;
  const hoverPreview = layout.hoverPreview;
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewAbortRef = useRef(0);
  const listboxRef = useRef<HTMLDivElement | null>(null);

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
      if (item.kind !== 'file') {
        dispatchLayout({ type: 'set-hover', hoverPreview: null });
        return;
      }
      const relativePath = item.relativePath;
      if (!sessionKey?.trim() || item.isDirectory || item.isBrowseUp || !relativePath) {
        dispatchLayout({ type: 'set-hover', hoverPreview: null });
        return;
      }
      previewTimerRef.current = setTimeout(() => {
        previewTimerRef.current = null;
        if (rid !== previewAbortRef.current) return;
        void readWorkspaceFile(relativePath, { sessionKey })
          .then(({ content }) => {
            const snippet = content.length > PREVIEW_MAX_CHARS ? `${content.slice(0, PREVIEW_MAX_CHARS)}…` : content;
            if (rid !== previewAbortRef.current) return;
            dispatchLayout({ type: 'set-hover', hoverPreview: { text: snippet, x: clientX, y: clientY } });
          })
          .catch(() => {
            if (rid !== previewAbortRef.current) return;
            dispatchLayout({ type: 'set-hover', hoverPreview: null });
          });
      }, 420);
    },
    [sessionKey],
  );

  useLayoutEffect(() => {
    if (!open) {
      dispatchLayout({ type: 'reset' });
      clearPreviewTimer();
      previewAbortRef.current += 1;
      return;
    }

    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      dispatchLayout({ type: 'set-box', box: { left: r.left, top: r.top, width: r.width } });
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

  useLayoutEffect(() => {
    if (!open || selectedIndex < 0 || selectedIndex >= items.length) return;
    const activeOption = listboxRef.current?.querySelector<HTMLElement>(`#at-mention-${selectedIndex}`);
    activeOption?.scrollIntoView({ block: 'nearest' });
  }, [open, selectedIndex, items.length]);

  if (!open || typeof document === 'undefined' || box === null) {
    return null;
  }

  const totalRows = items.length;
  const panelWidth = Math.min(box.width, MAX_PALETTE_WIDTH_PX);

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
      <div
        ref={listboxRef}
        className="max-h-[min(26rem,54vh)] overflow-y-auto"
        role="listbox"
        aria-label={ariaLabel}
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
            {items.map((item, i) => {
              const previousKind = items[i - 1]?.kind;
              const sectionLabel = item.kind === 'note' ? notesLabel : filesLabel;
              const isRecent = item.kind === 'file' && item.isRecent;
              return (
                <Fragment key={item.kind === 'note' ? `note:${item.noteRef.sourceId}` : `file:${item.relativePath}`}>
                  {previousKind !== item.kind ? (
                    <div className="border-t border-edge-subtle px-3 pb-1 pt-2 text-[0.65rem] font-medium uppercase tracking-wide text-fg-muted first:border-t-0">
                      {sectionLabel}
                    </div>
                  ) : null}
                  <div
                    id={`at-mention-${i}`}
                    role="option"
                    aria-selected={selectedIndex === i}
                    tabIndex={-1}
                    className={cn(
                      'flex cursor-pointer items-start gap-2 px-3 py-2 text-left text-sm',
                      selectedIndex === i ? 'bg-surface-hover text-fg' : 'text-fg-subtle hover:bg-surface-hover/80',
                      isRecent && 'border-l-2 border-l-accent/60',
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
                      dispatchLayout({ type: 'set-hover', hoverPreview: null });
                    }}
                  >
                    <span className="mt-0.5 shrink-0">
                      {item.kind === 'note' ? (
                        <NotebookPen className="size-3.5 text-accent-fg" aria-hidden />
                      ) : item.isBrowseUp ? (
                        <Folder className="size-3.5 text-fg-muted" aria-hidden />
                      ) : item.isDirectory ? (
                        <Folder className="size-3.5 text-amber-600 dark:text-amber-400" aria-hidden />
                      ) : (
                        <FileText className={cn('size-3.5', fileExtColor(item.name))} aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 truncate">
                        <span className="truncate">
                          <NameWithHighlights name={item.name} query={query} />
                        </span>
                        {isRecent ? (
                          <span className="shrink-0 rounded bg-accent-soft px-1 py-0 text-[0.65rem] text-accent-fg">
                            {recentLabel}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-fg-muted">
                        {item.kind === 'note' ? item.description || notesLabel : item.relativePath || '—'}
                      </div>
                    </span>
                  </div>
                </Fragment>
              );
            })}
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
