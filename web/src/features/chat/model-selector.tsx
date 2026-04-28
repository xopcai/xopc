import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronsUpDown, Settings2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached, type ConfiguredModel } from '@/features/chat/registry-api';
import {
  comboboxTriggerLayoutClass,
  formControlBorderFocusClass,
  selectComboboxTriggerFocusClass,
} from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

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
  contentSide = 'bottom',
  contentAlign = 'end',
  className,
  popoverContentClassName,
  /** Chat header: footer link to provider (API key) settings. */
  showProviderSettingsFooter,
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
  /** Radix popover placement — use `top` when the trigger sits near the viewport bottom (e.g. chat composer). */
  contentSide?: 'top' | 'bottom';
  contentAlign?: 'start' | 'center' | 'end';
  /** Merged onto the trigger button (e.g. full width in wide forms). */
  className?: string;
  /** Merged onto `Popover.Content` — use e.g. `z-[70]` when the trigger sits inside a `z-[60]` dialog. */
  popoverContentClassName?: string;
  showProviderSettingsFooter?: boolean;
  onChange: (modelId: string) => void;
}) {
  const navigate = useNavigate();
  const language = useLocaleStore((s) => s.language);
  const m = messages(language).chat;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const { data: models = [], isLoading, error } = useSWR(CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached, {
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
            comboboxTriggerLayoutClass,
            'items-center gap-2 rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2 text-left text-sm font-normal text-fg',
            interaction.transition,
            'hover:border-edge hover:bg-surface-hover/45',
            selectComboboxTriggerFocusClass,
            'disabled:cursor-not-allowed disabled:opacity-50',
            'dark:border-edge-subtle dark:hover:bg-surface-hover/55',
            compact && 'py-1.5 text-[13px]',
            className,
          )}
        >
          <span className="min-w-0 truncate">{isLoading ? '…' : label}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-fg-subtle opacity-70" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={cn(
            'z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-edge-subtle bg-surface-panel p-1 shadow-elevated dark:border-edge-subtle',
            popoverContentClassName,
          )}
          side={contentSide}
          sideOffset={4}
          align={contentAlign}
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
            {filtered.map((model) => (
              <button
                key={model.id}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-surface-hover',
                  model.id === value && 'bg-surface-hover/90 font-medium dark:bg-surface-hover/70',
                )}
                onClick={() => {
                  onChange(model.id);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <Check className={cn('h-4 w-4 shrink-0', model.id !== value && 'invisible')} aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{model.name}</span>{' '}
                  <span className="text-fg-muted">({model.provider})</span>
                </span>
              </button>
            ))}
          </div>
          {showProviderSettingsFooter ? (
            <div className="mt-1 border-t border-edge-subtle pt-1">
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-accent',
                  interaction.transition,
                  'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                )}
                onClick={() => {
                  navigate('/settings/providers');
                  setOpen(false);
                  setQuery('');
                }}
              >
                <Settings2 className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
                <span className="min-w-0">{m.modelProviderSettingsLink}</span>
              </button>
            </div>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
