import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, CircleHelp, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/cn';

export type ResponsePersonalContext = {
  id: string;
  statement: string;
  origin: 'told_by_user' | 'observed' | 'inferred' | 'connected_source';
  sourceName: string;
};

type ResponseContextDialogLabels = {
  title: string;
  hint: string;
  close: string;
  itemsSummary: string;
  expandAll: string;
  collapseAll: string;
  groupSummary: string;
  origins: Record<ResponsePersonalContext['origin'], string>;
};

type ResponseContextGroup = {
  id: string;
  label: string;
  items: ResponsePersonalContext[];
};

function buildGroups(
  items: ResponsePersonalContext[],
  origins: ResponseContextDialogLabels['origins'],
): ResponseContextGroup[] {
  const groups = new Map<string, ResponseContextGroup>();

  for (const item of items) {
    const sourceName = item.sourceName.trim();
    const normalizedStatement = item.statement.trim().replace(/\s+/g, ' ');
    const id = item.origin === 'connected_source'
      ? `${item.origin}:${sourceName}`
      : item.origin;
    const label = item.origin === 'connected_source'
      ? origins.connected_source.replace('{{source}}', sourceName)
      : origins[item.origin];
    const group = groups.get(id);

    if (group) {
      const duplicate = group.items.some(
        (existing) => existing.statement.trim().replace(/\s+/g, ' ') === normalizedStatement,
      );
      if (!duplicate) group.items.push(item);
    } else {
      groups.set(id, { id, label, items: [item] });
    }
  }

  return Array.from(groups.values());
}

export function ResponseContextDialog({
  open,
  onOpenChange,
  items,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ResponsePersonalContext[];
  labels: ResponseContextDialogLabels;
}) {
  const groups = useMemo(() => buildGroups(items, labels.origins), [items, labels.origins]);
  const displayedItemCount = useMemo(
    () => groups.reduce((count, group) => count + group.items.length, 0),
    [groups],
  );
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || groups.length === 0) return;
    setExpandedGroupIds(new Set(displayedItemCount <= 6 ? groups.map((group) => group.id) : [groups[0].id]));
  }, [displayedItemCount, groups, open]);

  const allExpanded = groups.length > 0 && groups.every((group) => expandedGroupIds.has(group.id));

  const toggleAll = () => {
    setExpandedGroupIds(allExpanded ? new Set() : new Set(groups.map((group) => group.id)));
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[80] bg-scrim/60 backdrop-blur-[1px]" />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 z-[90] flex h-[min(36rem,calc(100dvh-2rem))]',
            'w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
            'rounded-2xl border border-edge bg-surface-overlay shadow-popover outline-none',
          )}
        >
          <header className="flex shrink-0 items-start gap-3 border-b border-edge-subtle px-4 py-4 sm:px-5">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg">
              <CircleHelp className="size-4" strokeWidth={1.75} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold text-fg">{labels.title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-5 text-fg-muted">
                {labels.hint}
              </Dialog.Description>
              <p className="mt-2 text-xs font-medium text-fg-subtle">
                {labels.itemsSummary.replace('{{count}}', String(displayedItemCount))}
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors duration-150 hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={labels.close}
                title={labels.close}
              >
                <X className="size-4" strokeWidth={1.75} aria-hidden />
              </button>
            </Dialog.Close>
          </header>

          <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-edge-subtle px-4 sm:px-5">
            <span className="text-xs text-fg-subtle">
              {labels.groupSummary.replace('{{count}}', String(groups.length))}
            </span>
            {groups.length > 1 ? (
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs font-medium text-accent-fg transition-colors duration-150 hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                onClick={toggleAll}
              >
                {allExpanded ? labels.collapseAll : labels.expandAll}
              </button>
            ) : null}
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4"
            data-testid="response-context-scroll-region"
          >
            <div className="space-y-2">
              {groups.map((group) => {
                const expanded = expandedGroupIds.has(group.id);
                return (
                  <section key={group.id} className="overflow-hidden rounded-xl border border-edge-subtle bg-surface-panel">
                    <button
                      type="button"
                      className="flex min-h-12 w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                      aria-expanded={expanded}
                      onClick={() => toggleGroup(group.id)}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{group.label}</span>
                      <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-[11px] tabular-nums text-fg-muted">
                        {group.items.length}
                      </span>
                      <ChevronDown
                        className={cn('size-4 shrink-0 text-fg-subtle transition-transform duration-200', expanded && 'rotate-180')}
                        strokeWidth={1.75}
                        aria-hidden
                      />
                    </button>
                    {expanded ? (
                      <div className="border-t border-edge-subtle px-3.5">
                        {group.items.map((item) => (
                          <p
                            key={item.id}
                            className="border-b border-edge-subtle py-3 text-sm leading-6 text-fg last:border-b-0"
                          >
                            {item.statement}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
