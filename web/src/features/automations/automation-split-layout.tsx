import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import type { StoredLanguage } from '@/lib/storage';

const WIDTH_KEY = 'xopc.automations.listWidth';
const DEFAULT_WIDTH = 272;
const MIN_WIDTH = 200;
const MAX_WIDTH = 560;

export function AutomationSplitLayout({ children, language, busy }: {
  children: [ReactNode, ReactNode];
  language: StoredLanguage;
  busy: boolean;
}) {
  const layoutRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH) return saved;
    } catch { /* Use the default when storage is unavailable. */ }
    return DEFAULT_WIDTH;
  });

  useEffect(() => {
    try { window.localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* Keep resizing available without storage. */ }
  }, [width]);

  useEffect(() => {
    if (!dragging) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
    };
  }, [dragging]);

  const clampWidth = (next: number) => {
    const available = layoutRef.current?.getBoundingClientRect().width ?? 1000;
    const maximum = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, available * 0.6, available - 292));
    return Math.round(Math.max(MIN_WIDTH, Math.min(maximum, next)));
  };
  const label = language === 'zh' ? '调整任务列表宽度' : 'Resize task list';

  return (
    <section
      ref={layoutRef}
      aria-busy={busy}
      className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-y-3 md:grid-cols-[minmax(0,min(var(--automation-list-width),60%))_0.75rem_minmax(0,1fr)] md:grid-rows-1 md:gap-y-0"
      style={{ '--automation-list-width': `${width}px` } as CSSProperties}
    >
      {children[0]}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        title={language === 'zh' ? '左右拖动调整宽度，双击恢复默认' : 'Drag to resize, double-click to reset'}
        className="relative hidden touch-none select-none cursor-col-resize focus-visible:outline-accent md:block"
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const actualWidth = event.currentTarget.previousElementSibling?.getBoundingClientRect().width ?? width;
          dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: actualWidth };
          setDragging(true);
        }}
        onPointerMove={event => {
          const drag = dragRef.current;
          if (drag?.pointerId !== event.pointerId) return;
          setWidth(clampWidth(drag.startWidth + event.clientX - drag.startX));
        }}
        onPointerUp={event => {
          if (dragRef.current?.pointerId !== event.pointerId) return;
          dragRef.current = null;
          setDragging(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { dragRef.current = null; setDragging(false); }}
        onLostPointerCapture={() => { dragRef.current = null; setDragging(false); }}
        onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          setWidth(clampWidth(event.key === 'Home' ? MIN_WIDTH : event.key === 'End' ? MAX_WIDTH : width + (event.key === 'ArrowLeft' ? -16 : 16)));
        }}
      />
      {children[1]}
    </section>
  );
}
