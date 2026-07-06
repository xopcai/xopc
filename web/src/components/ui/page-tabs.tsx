import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

export type PageTabItem<T extends string> = {
  id: T;
  label: ReactNode;
  icon?: LucideIcon;
  count?: ReactNode;
  suffix?: ReactNode;
  title?: string;
};

type PageTabsDropPosition = 'before' | 'after';

export function PageTabs<T extends string>({
  items,
  activeTab,
  onChange,
  ariaLabel,
  tabIdPrefix,
  panelIdPrefix,
  className,
  buttonClassName,
  selectedClassName = 'bg-accent-soft text-accent-fg',
  unselectedClassName = 'text-fg-muted hover:bg-surface-hover hover:text-fg',
  countClassName,
  onReorder,
}: {
  items: readonly PageTabItem<T>[];
  activeTab: T;
  onChange: (tab: T) => void;
  ariaLabel: string;
  tabIdPrefix?: string;
  panelIdPrefix?: string;
  className?: string;
  buttonClassName?: string;
  selectedClassName?: string;
  unselectedClassName?: string;
  countClassName?: string;
  onReorder?: (draggedId: T, targetId: T, position: PageTabsDropPosition) => void;
}) {
  const [draggedId, setDraggedId] = useState<T | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: T; position: PageTabsDropPosition } | null>(null);

  const clearDragState = () => {
    setDraggedId(null);
    setDropTarget(null);
  };

  return (
    <nav
      aria-label={ariaLabel}
      className={cn('-mx-1 flex gap-1 overflow-x-auto px-1 pb-1', className)}
      role="tablist"
      onDragLeave={(event) => {
        if (!onReorder) return;
        const relatedTarget = event.relatedTarget;
        if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
        setDropTarget(null);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const currentIndex = items.findIndex((item) => item.id === activeTab);
        if (currentIndex < 0) return;
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        const nextIndex = (currentIndex + delta + items.length) % items.length;
        onChange(items[nextIndex].id);
      }}
    >
      {items.map(({ id, icon: Icon, label, count, suffix, title }) => {
        const selected = id === activeTab;
        const dragging = draggedId === id;
        const dropBefore = dropTarget?.id === id && dropTarget.position === 'before';
        const dropAfter = dropTarget?.id === id && dropTarget.position === 'after';
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            id={tabIdPrefix ? `${tabIdPrefix}-${id}` : undefined}
            aria-controls={panelIdPrefix ? `${panelIdPrefix}-${id}` : undefined}
            aria-grabbed={onReorder ? dragging : undefined}
            draggable={Boolean(onReorder)}
            title={title}
            className={cn(
              'relative inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              interaction.press,
              selected ? selectedClassName : unselectedClassName,
              onReorder && 'cursor-grab active:cursor-grabbing',
              dragging && 'scale-[0.98] border border-edge bg-surface-active/60 opacity-55 shadow-surface',
              (dropBefore || dropAfter) && !dragging && 'bg-surface-hover text-fg',
              buttonClassName,
            )}
            onClick={() => onChange(id)}
            onDragStart={(event) => {
              if (!onReorder) return;
              setDraggedId(id);
              setDropTarget(null);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', id);
            }}
            onDragOver={(event) => {
              if (!onReorder || !draggedId) return;
              if (draggedId === id) {
                setDropTarget(null);
                return;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              const rect = event.currentTarget.getBoundingClientRect();
              const position: PageTabsDropPosition = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
              setDropTarget((current) => (
                current?.id === id && current.position === position
                  ? current
                  : { id, position }
              ));
            }}
            onDrop={(event) => {
              if (!onReorder || !draggedId || draggedId === id) return;
              event.preventDefault();
              onReorder(draggedId, id, dropTarget?.id === id ? dropTarget.position : 'before');
              clearDragState();
            }}
            onDragEnd={clearDragState}
          >
            {dropBefore ? (
              <span className="pointer-events-none absolute -left-0.5 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_2px_var(--color-surface-panel)]" aria-hidden />
            ) : null}
            {Icon ? <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden /> : null}
            <span>{label}</span>
            {count !== undefined && count !== null ? (
              <span className={cn('rounded-full bg-surface-hover px-1.5 py-0.5 text-[10px] tabular-nums text-fg-subtle', countClassName)}>
                {count}
              </span>
            ) : null}
            {suffix}
            {dropAfter ? (
              <span className="pointer-events-none absolute -right-0.5 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_2px_var(--color-surface-panel)]" aria-hidden />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
