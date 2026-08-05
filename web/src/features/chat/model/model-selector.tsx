import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronsUpDown, Settings2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached, type ConfiguredModel } from '@/features/chat/api/registry-api';
import {
  comboboxTriggerLayoutClass,
  formControlBorderFocusClass,
  selectComboboxTriggerFocusClass,
} from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { settingsShellPopoverZClass } from '@/lib/settings-shell-layer.utils';
import {
  useSettingsShellPopoverLayer,
  useSettingsShellPopoverPortalContainer,
} from '@/lib/settings-shell-layer-context';
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

function buildPickerModels(
  models: ConfiguredModel[],
  capabilitiesFilter: 'vision' | undefined,
  valueTrimmed: string,
): ConfiguredModel[] {
  if (capabilitiesFilter !== 'vision') {
    return models;
  }
  const visionOk = models.filter((m) => m.vision === true);
  if (!valueTrimmed) {
    return visionOk;
  }
  if (visionOk.some((m) => m.id === valueTrimmed)) {
    return visionOk;
  }
  const current = models.find((m) => m.id === valueTrimmed);
  if (current) {
    return [current, ...visionOk];
  }
  const slash = valueTrimmed.indexOf('/');
  const provider = slash >= 0 ? valueTrimmed.slice(0, slash) : '';
  const mid = slash >= 0 ? valueTrimmed.slice(slash + 1) : valueTrimmed;
  const synthetic: ConfiguredModel = {
    id: valueTrimmed,
    name: mid || valueTrimmed,
    provider: provider || '—',
    vision: false,
  };
  return [synthetic, ...visionOk];
}

export function ModelSelector({
  value,
  disabled,
  placeholder,
  searchPlaceholder,
  noMatches,
  models: suppliedModels,
  modelsLoading,
  modelsError,
  /** When set, only models matching the capability appear (plus current value if missing). */
  capabilitiesFilter,
  /** Shown under a row that is the current value but fails `capabilitiesFilter` (e.g. not flagged vision). */
  outOfFilterNote,
  /** When `capabilitiesFilter` yields an empty registry and no current value to prepend. */
  registryEmptyHint,
  compact,
  showProviderInTrigger = true,
  contentSide = 'bottom',
  contentAlign = 'end',
  className,
  popoverContentClassName,
  /** Chat header: footer link to provider (API key) settings. */
  showProviderSettingsFooter,
  settingsFooterLink,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  placeholder: string;
  searchPlaceholder: string;
  noMatches: string;
  /** Optional model source for specialized registries such as image generation. */
  models?: ConfiguredModel[];
  modelsLoading?: boolean;
  modelsError?: unknown;
  capabilitiesFilter?: 'vision';
  outOfFilterNote?: string;
  registryEmptyHint?: string;
  compact?: boolean;
  /** When false, trigger shows model name only (dropdown rows still include provider). */
  showProviderInTrigger?: boolean;
  /** Radix popover placement — use `top` when the trigger sits near the viewport bottom (e.g. chat composer). */
  contentSide?: 'top' | 'bottom';
  contentAlign?: 'start' | 'center' | 'end';
  /** Merged onto the trigger button (e.g. full width in wide forms). */
  className?: string;
  /** Optional override merged onto `Popover.Content` (e.g. cron dialog `z-[70]`). Settings shell tiers apply automatically. */
  popoverContentClassName?: string;
  showProviderSettingsFooter?: boolean;
  settingsFooterLink?: { label: string; path: string };
  onChange: (modelId: string) => void;
}) {
  const navigate = useNavigate();
  const language = useLocaleStore((s) => s.language);
  const m = messages(language).chat;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const settingsShellLayer = useSettingsShellPopoverLayer();
  const portalContainer = useSettingsShellPopoverPortalContainer();
  const settingsShellPopoverZ = settingsShellPopoverZClass(settingsShellLayer);
  const footerLink = settingsFooterLink ?? (showProviderSettingsFooter
    ? { label: m.modelProviderSettingsLink, path: '/settings/capabilities/models' }
    : undefined);

  const registry = useSWR(suppliedModels ? null : CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached, {
    revalidateOnFocus: false,
  });
  const models = suppliedModels ?? registry.data ?? [];
  const isLoading = suppliedModels ? Boolean(modelsLoading) : registry.isLoading;
  const error = suppliedModels ? modelsError : registry.error;

  const valueTrimmed = value.trim();
  const pickerModels = useMemo(
    () => buildPickerModels(models, capabilitiesFilter, valueTrimmed),
    [models, capabilitiesFilter, valueTrimmed],
  );

  const filtered = useMemo(() => modelsMatchingQuery(pickerModels, query), [pickerModels, query]);
  const selected = useMemo(
    () => models.find((m) => m.id === value) ?? pickerModels.find((m) => m.id === value),
    [models, pickerModels, value],
  );
  const label = selected
    ? showProviderInTrigger
      ? `${selected.name} (${selected.provider})`
      : selected.name
    : value || placeholder;

  const showRegistryEmpty = !error && capabilitiesFilter === 'vision' && pickerModels.length === 0;

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
          <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle opacity-70" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer ?? undefined}>
        <Popover.Content
          className={cn(
            settingsShellPopoverZ,
            'w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-edge-subtle bg-surface-panel p-1 shadow-elevated dark:border-edge-subtle',
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
              <div className="p-2 text-xs text-red-600 dark:text-red-400">
                {error instanceof Error ? error.message : 'Failed to load models'}
              </div>
            ) : null}
            {!error && showRegistryEmpty ? (
              <div className="px-2 py-3 text-center text-xs text-fg-muted">
                {registryEmptyHint ?? noMatches}
              </div>
            ) : null}
            {!error && !showRegistryEmpty && filtered.length === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-fg-muted">{noMatches}</div>
            ) : null}
            {filtered.map((model) => {
              const showOutOfFilterHint =
                Boolean(outOfFilterNote) &&
                capabilitiesFilter === 'vision' &&
                model.vision !== true &&
                model.id === valueTrimmed;
              return (
                <button
                  key={model.id}
                  type="button"
                  className={cn(
                    'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-surface-hover',
                    model.id === value && 'bg-surface-hover/90 font-medium dark:bg-surface-hover/70',
                  )}
                  onClick={() => {
                    onChange(model.id);
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  <span className="flex w-full min-w-0 items-center gap-2">
                    <Check className={cn('size-4 shrink-0', model.id !== value && 'invisible')} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{model.name}</span>{' '}
                      <span className="text-fg-muted">({model.provider})</span>
                    </span>
                  </span>
                  {showOutOfFilterHint ? (
                    <span className="pl-6 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
                      {outOfFilterNote}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {footerLink ? (
            <div className="mt-1 border-t border-edge-subtle pt-1">
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-md p-2 text-left text-sm font-medium text-accent',
                  interaction.transition,
                  'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                )}
                onClick={() => {
                  navigate(footerLink.path);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <Settings2 className="size-4 shrink-0 opacity-90" aria-hidden />
                <span className="min-w-0">{footerLink.label}</span>
              </button>
            </div>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
