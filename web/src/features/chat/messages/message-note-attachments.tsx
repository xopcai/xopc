import { ChevronRight, NotebookPen } from 'lucide-react';

import type { MessageContextRef } from '@/features/chat/messages/messages.types';

export function MessageNoteAttachments({
  refs,
  groupLabel,
  noteLabel,
  truncatedLabel,
  onOpen,
}: {
  refs: MessageContextRef[];
  groupLabel: string;
  noteLabel: string;
  truncatedLabel: string;
  onOpen: (ref: MessageContextRef) => void;
}) {
  if (refs.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-col gap-1.5" aria-label={groupLabel}>
      {refs.map((ref) => (
        <button
          key={`${ref.kind}:${ref.sourceId}`}
          type="button"
          className="group flex w-64 max-w-full items-center gap-2.5 rounded-lg border border-edge-subtle bg-surface-panel/80 px-2.5 py-2 text-left transition-colors hover:border-accent/40 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={`${groupLabel}: ${ref.title}`}
          title={ref.truncated ? truncatedLabel : ref.title}
          onClick={() => onOpen(ref)}
        >
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-fg">
            <NotebookPen className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] leading-4 text-fg-muted">{noteLabel}</span>
            <span className="block truncate text-xs font-medium text-fg">{ref.title}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-fg-disabled transition-transform group-hover:translate-x-0.5 group-hover:text-fg-muted" aria-hidden />
        </button>
      ))}
    </div>
  );
}
