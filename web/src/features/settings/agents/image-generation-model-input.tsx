import * as Popover from '@radix-ui/react-popover';
import { Check } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import useSWR from 'swr';

import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import { inputClassName } from './defaults-field-styles';

export type ImageProviderSummary = { id: string; defaultModel?: string; models: string[] };

async function fetchImageGenerationProviders(): Promise<ImageProviderSummary[]> {
  const res = await apiFetch(apiUrl('/api/image/providers'));
  if (!res.ok) throw new Error(`Image providers: HTTP ${res.status}`);
  const data = (await res.json()) as { payload?: { providers?: ImageProviderSummary[] } };
  return data.payload?.providers ?? [];
}

function buildHints(providers: ImageProviderSummary[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of providers) {
    const models = p.models.length > 0 ? p.models : p.defaultModel ? [p.defaultModel] : [];
    for (const m of models) {
      const id = `${p.id}/${m}`;
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

function hintsMatchingQuery(hints: string[], query: string): string[] {
  const raw = query.trim().toLowerCase();
  if (!raw) return hints;
  const tokens = raw.split(/[/\s]+/).filter(Boolean);
  return hints.filter((h) => {
    const lower = h.toLowerCase();
    return tokens.every((t) => lower.includes(t));
  });
}

const SWR_KEY = 'image-generation-providers';

export function ImageGenerationModelInput({
  value,
  disabled,
  placeholder,
  searchPlaceholder,
  noMatches,
  className,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  placeholder: string;
  searchPlaceholder: string;
  noMatches: string;
  className?: string;
  onChange: (modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const { data: providers, isLoading, error } = useSWR(SWR_KEY, fetchImageGenerationProviders, {
    revalidateOnFocus: false,
  });

  const allHints = useMemo(() => buildHints(providers ?? []), [providers]);
  const filtered = useMemo(() => hintsMatchingQuery(allHints, value), [allHints, value]);

  useEffect(() => {
    setActiveIndex(0);
  }, [value, open, filtered.length]);

  const selectHint = useCallback(
    (id: string) => {
      onChange(id);
      setOpen(false);
    },
    [onChange],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (open && filtered.length > 0) {
          const pick = filtered[activeIndex] ?? filtered[0];
          if (pick) selectHint(pick);
        } else {
          setOpen(false);
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!open) setOpen(true);
        else if (filtered.length > 0) {
          setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (open && filtered.length > 0) {
          setActiveIndex((i) => Math.max(i - 1, 0));
        }
        return;
      }
    },
    [open, filtered, activeIndex, selectHint],
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
      <Popover.Anchor asChild>
        <div className={cn('w-full', className)}>
          <input
            type="text"
            disabled={disabled || isLoading}
            autoComplete="off"
            spellCheck={false}
            className={cn(
              inputClassName(),
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
            placeholder={isLoading ? '…' : placeholder}
            value={value}
            title={value || placeholder}
            aria-autocomplete="list"
            aria-expanded={open}
            onChange={(e) => {
              onChange(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-[var(--radix-popper-anchor-width,min(24rem,100%))] min-w-[10rem] max-w-lg rounded-xl border border-edge-subtle bg-surface-panel p-1 shadow-elevated dark:border-edge-subtle"
          side="bottom"
          sideOffset={4}
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {error ? (
            <div className="px-2 py-2 text-xs text-red-600 dark:text-red-400">
              {error instanceof Error ? error.message : 'Failed to load image providers'}
            </div>
          ) : null}
          {!error && allHints.length === 0 && !isLoading ? (
            <div className="px-2 py-3 text-center text-xs text-fg-muted">{noMatches}</div>
          ) : null}
          {!error && allHints.length > 0 ? (
            <div className="max-h-60 overflow-auto" role="listbox" aria-label={searchPlaceholder}>
              {filtered.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-fg-muted">{noMatches}</div>
              ) : null}
              {filtered.map((hint, idx) => (
                <button
                  key={hint}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-surface-hover',
                    hint === value && 'bg-surface-hover/90 font-medium dark:bg-surface-hover/70',
                    idx === activeIndex && 'bg-surface-hover/50',
                  )}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => selectHint(hint)}
                >
                  <Check className={cn('h-4 w-4 shrink-0', hint !== value && 'invisible')} aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{hint}</span>
                </button>
              ))}
            </div>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
