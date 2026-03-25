import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { fetchConfiguredModelsCached, type ConfiguredModel } from '@/features/chat/registry-api';
import { cn } from '@/lib/cn';

function haystack(m: ConfiguredModel): string {
  return `${m.id} ${m.name} ${m.provider}`.toLowerCase();
}

function modelsMatchingQuery(models: ConfiguredModel[], query: string): ConfiguredModel[] {
  const raw = query.trim().toLowerCase();
  if (!raw) return models;
  const tokens = raw.split(/\s+/).filter(Boolean);
  return models.filter((m) => {
    const h = haystack(m);
    return tokens.every((tok) => h.includes(tok));
  });
}

export function ModelSelector({
  value,
  disabled,
  placeholder,
  searchPlaceholder,
  noMatches,
  compact,
  showProviderInTrigger = true,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  placeholder: string;
  searchPlaceholder: string;
  noMatches: string;
  compact?: boolean;
  /** When false, trigger shows model name only (dropdown rows still include provider). */
  showProviderInTrigger?: boolean;
  onChange: (modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const { data: models = [], isLoading, error } = useSWR('gateway-configured-models', fetchConfiguredModelsCached, {
    revalidateOnFocus: false,
  });

  const filtered = useMemo(() => modelsMatchingQuery(models, query), [models, query]);
  const selected = models.find((m) => m.id === value);
  const label = selected
    ? showProviderInTrigger
      ? `${selected.name} (${selected.provider})`
      : selected.name
    : value || placeholder;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled || isLoading}
          title={selected ? `${selected.name} (${selected.provider})` : placeholder}
          className={cn(
            'flex max-w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-edge bg-surface-panel px-3 py-2 text-left text-sm font-medium text-fg transition-colors duration-150',
            'hover:border-edge-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            compact && 'py-1.5 text-[13px]',
          )}
        >
          <span className="min-w-0 truncate">{isLoading ? '…' : label}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-edge bg-surface-panel p-1 shadow-lg shadow-slate-200/60 dark:border-edge dark:shadow-black/40"
          sideOffset={4}
          align="end"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <input
            type="search"
            className="mb-1 w-full rounded-md border border-edge bg-surface-base px-2 py-1.5 text-sm text-fg placeholder:text-fg-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-60 overflow-auto">
            {error ? (
              <div className="px-2 py-2 text-xs text-red-600 dark:text-red-400">
                {error instanceof Error ? error.message : 'Failed to load models'}
              </div>
            ) : null}
            {!error && filtered.length === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-fg-muted">{noMatches}</div>
            ) : null}
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-hover',
                  m.id === value && 'bg-accent/10',
                )}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <Check className={cn('h-4 w-4 shrink-0', m.id !== value && 'invisible')} aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{m.name}</span>{' '}
                  <span className="text-fg-muted">({m.provider})</span>
                </span>
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
