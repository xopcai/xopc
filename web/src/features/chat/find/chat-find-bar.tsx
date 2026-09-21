import { ChevronDown, ChevronUp, Loader2, Search, X } from 'lucide-react';
import type { RefObject } from 'react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

export function ChatFindBar({
  open,
  query,
  activeIndex,
  resultCount,
  searching = false,
  truncated = false,
  limitedToLoaded = false,
  inputRef,
  labels,
  onQueryChange,
  onPrevious,
  onNext,
  onClose,
}: {
  open: boolean;
  query: string;
  activeIndex: number;
  resultCount: number;
  searching?: boolean;
    truncated?: boolean;
    limitedToLoaded?: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  labels: {
    input: string;
    previous: string;
    next: string;
    close: string;
    noResults: string;
    resultCount: string;
    searching: string;
    loadedOnly: string;
  };
  onQueryChange: (query: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  const hasQuery = Boolean(query.trim());
  const baseCountLabel = searching
    ? labels.searching
    : hasQuery && resultCount === 0
      ? labels.noResults
      : hasQuery
        ? labels.resultCount
          .replace('{{current}}', String(activeIndex + 1))
          .replace('{{total}}', `${resultCount}${truncated ? '+' : ''}`)
        : '';
  const countLabel = limitedToLoaded && hasQuery
    ? [baseCountLabel, labels.loadedOnly].filter(Boolean).join(' · ')
    : baseCountLabel;
  const navigationDisabled = searching || resultCount === 0;

  return (
    <section
      data-chat-find-bar
      role="search"
      aria-label={labels.input}
      className="absolute right-3 top-3 z-30 w-[min(25rem,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-edge bg-surface-overlay shadow-popover"
    >
      <div className="flex min-w-0 items-center gap-2 px-3">
        <Search className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
        <input
          ref={inputRef}
          value={query}
          type="search"
          autoComplete="off"
          spellCheck={false}
          aria-label={labels.input}
          className="h-12 min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle"
          placeholder={labels.input}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              if (event.shiftKey) onPrevious();
              else onNext();
            }
          }}
        />
        {searching ? <Loader2 className="size-4 shrink-0 animate-spin text-fg-muted" aria-hidden /> : null}
        <button
          type="button"
          onClick={onClose}
          className={cn(
            'inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg',
            interaction.focusRingPanel,
            interaction.press,
          )}
          aria-label={labels.close}
        >
          <X className="size-5" strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <div className="flex h-11 items-center border-t border-edge-subtle px-1.5">
        <button
          type="button"
          disabled={navigationDisabled}
          onClick={onPrevious}
          className={cn(
            'inline-flex size-10 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg',
            interaction.focusRingPanel,
            interaction.press,
            interaction.disabled,
          )}
          aria-label={labels.previous}
        >
          <ChevronUp className="size-5" strokeWidth={1.75} aria-hidden />
        </button>
        <button
          type="button"
          disabled={navigationDisabled}
          onClick={onNext}
          className={cn(
            'inline-flex size-10 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg',
            interaction.focusRingPanel,
            interaction.press,
            interaction.disabled,
          )}
          aria-label={labels.next}
        >
          <ChevronDown className="size-5" strokeWidth={1.75} aria-hidden />
        </button>
        <span className="ml-auto px-2 text-sm tabular-nums text-fg-muted" aria-live="polite" aria-atomic="true">
          {countLabel}
        </span>
      </div>
    </section>
  );
}
