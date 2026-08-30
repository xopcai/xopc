import { NotebookPen, X } from 'lucide-react';

import type { ComposerContextRef } from '@/features/chat/composer/composer.types';

export function ComposerContextChips({
  refs,
  label,
  onRemove,
}: {
  refs: ComposerContextRef[];
  label: string;
  onRemove: (sourceId: string) => void;
}) {
  if (refs.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-4 pt-2" aria-label={label}>
      {refs.map((ref) => (
        <span
          key={ref.sourceId}
          className="inline-flex h-7 min-w-0 max-w-56 items-center gap-1.5 rounded-md border border-edge-subtle bg-accent-soft/50 px-2 text-xs text-fg"
        >
          <NotebookPen className="size-3.5 shrink-0 text-accent-fg" aria-hidden />
          <span className="truncate">{ref.title}</span>
          <button
            type="button"
            className="-mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-surface-hover hover:text-fg"
            aria-label={`${label}: ${ref.title}`}
            onClick={() => onRemove(ref.sourceId)}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
}
