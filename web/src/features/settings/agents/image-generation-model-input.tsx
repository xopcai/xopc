import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';

import {
  comboboxTriggerLayoutClass,
  formControlBorderFocusClass,
  selectComboboxTriggerFocusClass,
} from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/fetch';
import { SETTINGS_SHELL_POPOVER_Z } from '@/lib/settings-shell-dialog-layer';
import { interaction } from '@/lib/interaction';
import { apiUrl } from '@/lib/url';

export type ImageProviderSummary = {
  id: string;
  defaultModel?: string;
  models: string[];
  /** From gateway: provider has resolvable API credentials. */
  configured?: boolean;
};

async function fetchImageGenerationProviders(): Promise<ImageProviderSummary[]> {
  const res = await apiFetch(apiUrl('/api/image/providers'));
  if (!res.ok) throw new Error(`Image providers: HTTP ${res.status}`);
  const data = (await res.json()) as { payload?: { providers?: ImageProviderSummary[] } };
  return data.payload?.providers ?? [];
}

function modelIdsForProviders(providerList: ImageProviderSummary[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of providerList) {
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

/** Only image-generation providers the gateway marks as configured (credentials available). */
function buildConfiguredModelIds(providers: ImageProviderSummary[], currentValueTrimmed: string): string[] {
  const configuredOnly = providers.filter((p) => p.configured === true);
  const fromRegistry = modelIdsForProviders(configuredOnly);
  if (!currentValueTrimmed || fromRegistry.includes(currentValueTrimmed)) {
    return fromRegistry;
  }
  return [currentValueTrimmed, ...fromRegistry];
}

function idsMatchingQuery(ids: string[], query: string): string[] {
  const raw = query.trim().toLowerCase();
  if (!raw) return ids;
  const tokens = raw.split(/[/\s]+/).filter(Boolean);
  return ids.filter((h) => {
    const lower = h.toLowerCase();
    return tokens.every((t) => lower.includes(t));
  });
}

const SWR_KEY = 'image-generation-providers';

/**
 * Dropdown only: choose a registered `provider/model` from the gateway. Search runs inside
 * the popover; the trigger is not a text field (no free-text model strings).
 */
export function ImageGenerationModelInput({
  value,
  disabled,
  placeholder,
  searchPlaceholder,
  noMatches,
  registryEmptyHint,
  outOfFilterNote,
  className,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  placeholder: string;
  searchPlaceholder: string;
  noMatches: string;
  /** When every provider is unconfigured and there is no current value. */
  registryEmptyHint?: string;
  /** Current value uses a provider that is not configured (still listed so you can change it). */
  outOfFilterNote?: string;
  className?: string;
  onChange: (modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const { data: providers, isLoading, error } = useSWR(SWR_KEY, fetchImageGenerationProviders, {
    revalidateOnFocus: false,
  });

  const valueTrimmed = value.trim();
  const configuredOnlyIds = useMemo(
    () => modelIdsForProviders((providers ?? []).filter((p) => p.configured === true)),
    [providers],
  );
  const allIds = useMemo(
    () => buildConfiguredModelIds(providers ?? [], valueTrimmed),
    [providers, valueTrimmed],
  );
  const filtered = useMemo(() => idsMatchingQuery(allIds, query), [allIds, query]);
  const showOutOfFilterNote =
    Boolean(outOfFilterNote) &&
    Boolean(valueTrimmed) &&
    !configuredOnlyIds.includes(valueTrimmed);

  const label = value.trim() ? value : placeholder;
  const titleText = value.trim() || placeholder;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) {
        setQuery('');
      }
    },
    [],
  );

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Popover.Root open={open} onOpenChange={handleOpenChange} modal={false}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled || isLoading}
            title={isLoading ? '…' : titleText}
            className={cn(
              comboboxTriggerLayoutClass,
              'items-center gap-2 rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2 text-left text-sm font-normal text-fg',
              interaction.transition,
              interaction.press,
              'hover:border-edge hover:bg-surface-hover/45',
              selectComboboxTriggerFocusClass,
              'disabled:cursor-not-allowed disabled:opacity-50',
              'dark:border-edge-subtle dark:hover:bg-surface-hover/55',
              className,
            )}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <span className="min-w-0 truncate">{isLoading ? '…' : label}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle opacity-70" aria-hidden />
          </button>
        </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={cn(
            'w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-edge-subtle bg-surface-panel p-1 shadow-elevated dark:border-edge-subtle',
            SETTINGS_SHELL_POPOVER_Z,
          )}
          side="bottom"
          sideOffset={4}
          align="end"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <input
            type="search"
            className={cn(
              'mb-1 w-full rounded-lg border border-edge-subtle bg-surface-base px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-disabled dark:bg-surface-hover/40',
              formControlBorderFocusClass,
            )}
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="max-h-60 overflow-auto" role="listbox" aria-label={searchPlaceholder}>
            {error ? (
              <div className="p-2 text-xs text-red-600 dark:text-red-400">
                {error instanceof Error ? error.message : 'Failed to load image providers'}
              </div>
            ) : null}
            {!error && allIds.length === 0 && !isLoading ? (
              <div className="px-2 py-3 text-center text-xs text-fg-muted">
                {registryEmptyHint ?? noMatches}
              </div>
            ) : null}
            {!error && allIds.length > 0 && filtered.length === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-fg-muted">{noMatches}</div>
            ) : null}
            {filtered.map((id) => (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={id === value}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-surface-hover',
                  interaction.press,
                  id === value && 'bg-surface-hover/90 font-medium dark:bg-surface-hover/70',
                )}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <Check className={cn('size-4 shrink-0', id !== value && 'invisible')} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{id}</span>
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
      </Popover.Root>
      {showOutOfFilterNote ? (
        <p className="text-xs text-amber-700 dark:text-amber-400/90">{outOfFilterNote}</p>
      ) : null}
    </div>
  );
}
