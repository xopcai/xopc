import {
  CheckCircle2,
  ChevronRight,
  Globe,
  Loader2,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import * as Dialog from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import {
  patchProviderApiKeys,
  type ProviderRowModel,
} from '@/features/settings/providers-api';
import {
  PROVIDER_ENRICHMENT,
  getOrderedApiKeyLinks,
  providerApiKeyLinkLabel,
} from '@/features/settings/provider-enrichment';
import { CATEGORY_ORDER, groupByCategory } from '@/features/settings/providers/providers-settings-lib';
import {
  saveModelsJson,
  type ModelsJsonConfig,
  type ProviderConfig,
} from '@/features/settings/models-json-api';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import type { StoredLanguage } from '@/lib/storage';

export interface AddProviderDialogMessages {
  title: string;
  searchPlaceholder: string;
  builtinSection: string;
  customSection: string;
  customDescription: string;
  addCustom: string;
  configured: string;
  notConfigured: string;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  baseUrlLabel: string;
  baseUrlPlaceholder: string;
  providerIdLabel: string;
  providerIdPlaceholder: string;
  save: string;
  saving: string;
  saved: string;
  cancel: string;
  back: string;
  getApiKey: string;
  getApiKeyIntl: string;
  getApiKeyCn: string;
  saveError: string;
  addModel: string;
  modelIdLabel: string;
  modelIdPlaceholder: string;
  noResults: string;
  step1Title: string;
  step2BuiltinTitle: string;
  step2CustomTitle: string;
  categories: Record<string, string>;
}

type DialogStep =
  | { type: 'pick' }
  | { type: 'builtin'; providerId: string }
  | { type: 'custom' };

interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  builtinRows: ProviderRowModel[];
  customConfig: ModelsJsonConfig | null;
  labels: AddProviderDialogMessages;
  language: StoredLanguage;
  onSaved: () => void;
}

export function AddProviderDialog({
  open,
  onOpenChange,
  builtinRows,
  customConfig,
  labels,
  language,
  onSaved,
}: AddProviderDialogProps) {
  const [step, setStep] = useState<DialogStep>({ type: 'pick' });
  const [searchQuery, setSearchQuery] = useState('');

  const handleClose = useCallback(() => {
    onOpenChange(false);
    // Reset after close animation
    window.setTimeout(() => {
      setStep({ type: 'pick' });
      setSearchQuery('');
    }, 200);
  }, [onOpenChange]);

  const handleSaved = useCallback(() => {
    onSaved();
    handleClose();
  }, [onSaved, handleClose]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'xopc-dialog-overlay fixed inset-0 bg-scrim backdrop-blur-[1px]',
            SETTINGS_SHELL_OVERLAY_Z,
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 flex max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge-subtle bg-surface-base shadow-xl',
            SETTINGS_SHELL_CONTENT_Z,
          )}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          {step.type === 'pick' ? (
            <PickProviderStep
              builtinRows={builtinRows}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              labels={labels}
              onPickBuiltin={(id) => setStep({ type: 'builtin', providerId: id })}
              onPickCustom={() => setStep({ type: 'custom' })}
            />
          ) : step.type === 'builtin' ? (
            <ConfigureBuiltinStep
              providerId={step.providerId}
              builtinRows={builtinRows}
              labels={labels}
              language={language}
              onBack={() => setStep({ type: 'pick' })}
              onSaved={handleSaved}
            />
          ) : (
            <ConfigureCustomStep
              customConfig={customConfig}
              labels={labels}
              onBack={() => setStep({ type: 'pick' })}
              onSaved={handleSaved}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ── Step 1: Pick a provider ── */

function PickProviderStep({
  builtinRows,
  searchQuery,
  onSearchChange,
  labels,
  onPickBuiltin,
  onPickCustom,
}: {
  builtinRows: ProviderRowModel[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  labels: AddProviderDialogMessages;
  onPickBuiltin: (id: string) => void;
  onPickCustom: () => void;
}) {
  const query = searchQuery.trim().toLowerCase();

  const filteredRows = useMemo(() => {
    if (!query) return builtinRows;
    return builtinRows.filter((r) => {
      const enrichment = PROVIDER_ENRICHMENT[r.id];
      const aliases = enrichment?.aliases ?? [];
      return (
        r.id.toLowerCase().includes(query) ||
        r.name.toLowerCase().includes(query) ||
        aliases.some((a) => a.toLowerCase().includes(query))
      );
    });
  }, [builtinRows, query]);

  const groups = useMemo(() => groupByCategory(filteredRows), [filteredRows]);

  return (
    <>
      <div className="flex items-center justify-between border-b border-edge-subtle px-5 py-4">
        <Dialog.Title className="text-base font-semibold text-fg">{labels.step1Title}</Dialog.Title>
      </div>

      <div className="px-5 pt-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={labels.searchPlaceholder}
            autoComplete="off"
            autoFocus
            className={cn(
              'w-full rounded-lg border border-edge bg-surface-panel py-2 pl-10 pr-3 text-sm text-fg placeholder:text-fg-subtle',
              settingsInputFocusClass,
            )}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-3">
        {/* Custom provider entry */}
        {!query ? (
          <button
            type="button"
            onClick={onPickCustom}
            className={cn(
              'mb-3 flex w-full items-center gap-3 rounded-xl border border-dashed border-edge-subtle bg-surface-panel/40 px-4 py-3 text-left transition-colors',
              'hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              interaction.press,
            )}
          >
            <Globe className="size-5 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden />
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-fg">{labels.addCustom}</span>
              <p className="mt-0.5 text-xs text-fg-muted">{labels.customDescription}</p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          </button>
        ) : null}

        {/* Built-in provider list */}
        {filteredRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">{labels.noResults}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {CATEGORY_ORDER.map((cat) => {
              const list = groups.get(cat) ?? [];
              if (list.length === 0) return null;
              return (
                <div key={cat}>
                  <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                    {labels.categories[cat] ?? cat}
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {list.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => onPickBuiltin(row.id)}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors',
                          'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                          interaction.press,
                        )}
                      >
                        <span className="truncate text-sm text-fg">{row.name}</span>
                        {row.configured ? (
                          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

/* ── Step 2a: Configure built-in provider (just API key) ── */

function ConfigureBuiltinStep({
  providerId,
  builtinRows,
  labels,
  language,
  onBack,
  onSaved,
}: {
  providerId: string;
  builtinRows: ProviderRowModel[];
  labels: AddProviderDialogMessages;
  language: StoredLanguage;
  onBack: () => void;
  onSaved: () => void;
}) {
  const row = builtinRows.find((r) => r.id === providerId);
  const enrichment = PROVIDER_ENRICHMENT[providerId];
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const apiKeyLinks = useMemo(
    () => getOrderedApiKeyLinks(providerId, language),
    [providerId, language],
  );

  const handleSave = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await patchProviderApiKeys({ [providerId]: trimmed });
      setSaved(true);
      window.setTimeout(onSaved, 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.saveError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-edge-subtle px-5 py-4">
        <button
          type="button"
          onClick={onBack}
          className={cn('rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg', interaction.press)}
          aria-label={labels.back}
        >
          <ChevronRight className="size-4 rotate-180" aria-hidden />
        </button>
        <Dialog.Title className="text-base font-semibold text-fg">
          {row?.name ?? providerId}
        </Dialog.Title>
      </div>

      <div className="flex flex-col gap-4 px-5 py-4">
        {enrichment?.description ? (
          <p className="text-sm text-fg-muted">{enrichment.description}</p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="builtin-api-key" className="text-sm font-medium text-fg">
            {labels.apiKeyLabel}
          </label>
          <input
            ref={inputRef}
            id="builtin-api-key"
            type="password"
            autoComplete="off"
            autoFocus
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={labels.apiKeyPlaceholder}
            className={cn(
              'rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle',
              settingsInputFocusClass,
            )}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSave();
            }}
          />
        </div>

        {apiKeyLinks.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {apiKeyLinks.map(({ kind, href }) => (
              <a
                key={kind}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                {providerApiKeyLinkLabel(kind, labels)}
                <span className="size-3" aria-hidden>↗</span>
              </a>
            ))}
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onBack}>
            {labels.cancel}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!apiKey.trim() || saving || saved}
            onClick={() => void handleSave()}
          >
            {saved ? (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" aria-hidden />
                {labels.saved}
              </span>
            ) : saving ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {labels.saving}
              </span>
            ) : (
              labels.save
            )}
          </Button>
        </div>
      </div>
    </>
  );
}

/* ── Step 2b: Configure custom provider (base URL + key + models) ── */

function ConfigureCustomStep({
  customConfig,
  labels,
  onBack,
  onSaved,
}: {
  customConfig: ModelsJsonConfig | null;
  labels: AddProviderDialogMessages;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [providerId, setProviderId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelIds, setModelIds] = useState<string[]>(['']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addModelSlot = () => setModelIds((prev) => [...prev, '']);
  const updateModelId = (index: number, value: string) => {
    setModelIds((prev) => prev.map((m, i) => (i === index ? value : m)));
  };
  const removeModelSlot = (index: number) => {
    setModelIds((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    const trimmedId = providerId.trim();
    const trimmedUrl = baseUrl.trim();
    if (!trimmedId || !trimmedUrl) return;

    const validModels = modelIds.map((m) => m.trim()).filter(Boolean);

    setSaving(true);
    setError(null);
    try {
      const existingProviders = customConfig?.providers ?? {};
      const newProvider: ProviderConfig = {
        baseUrl: trimmedUrl,
        apiKey: apiKey.trim() || undefined,
        models: validModels.map((id) => ({ id })),
      };

      const updatedConfig: ModelsJsonConfig = {
        providers: {
          ...existingProviders,
          [trimmedId]: newProvider,
        },
      };

      await saveModelsJson(updatedConfig);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.saveError);
    } finally {
      setSaving(false);
    }
  };

  const canSave = providerId.trim() && baseUrl.trim();

  return (
    <>
      <div className="flex items-center gap-2 border-b border-edge-subtle px-5 py-4">
        <button
          type="button"
          onClick={onBack}
          className={cn('rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg', interaction.press)}
          aria-label={labels.back}
        >
          <ChevronRight className="size-4 rotate-180" aria-hidden />
        </button>
        <Dialog.Title className="text-base font-semibold text-fg">
          {labels.step2CustomTitle}
        </Dialog.Title>
      </div>

      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-5 py-4">
        <p className="text-sm text-fg-muted">{labels.customDescription}</p>

        {/* Provider ID */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="custom-provider-id" className="text-sm font-medium text-fg">
            {labels.providerIdLabel}
          </label>
          <input
            id="custom-provider-id"
            type="text"
            autoComplete="off"
            autoFocus
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            placeholder={labels.providerIdPlaceholder}
            className={cn(
              'rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle',
              settingsInputFocusClass,
            )}
          />
        </div>

        {/* Base URL */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="custom-base-url" className="text-sm font-medium text-fg">
            {labels.baseUrlLabel}
          </label>
          <input
            id="custom-base-url"
            type="url"
            autoComplete="off"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={labels.baseUrlPlaceholder}
            className={cn(
              'rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle',
              settingsInputFocusClass,
            )}
          />
        </div>

        {/* API Key (optional) */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="custom-api-key" className="text-sm font-medium text-fg">
            {labels.apiKeyLabel}
          </label>
          <input
            id="custom-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={labels.apiKeyPlaceholder}
            className={cn(
              'rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle',
              settingsInputFocusClass,
            )}
          />
        </div>

        {/* Model IDs */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-fg">{labels.modelIdLabel}</span>
          {modelIds.map((modelId, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                autoComplete="off"
                value={modelId}
                onChange={(e) => updateModelId(index, e.target.value)}
                placeholder={labels.modelIdPlaceholder}
                className={cn(
                  'flex-1 rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle',
                  settingsInputFocusClass,
                )}
              />
              {modelIds.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeModelSlot(index)}
                  className={cn('rounded-lg p-1.5 text-fg-subtle hover:bg-surface-hover hover:text-fg', interaction.press)}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
          ))}
          <Button type="button" variant="ghost" className="w-fit gap-1.5 text-fg-muted" onClick={addModelSlot}>
            <Plus className="size-3.5" aria-hidden />
            {labels.addModel}
          </Button>
        </div>

        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-edge-subtle px-5 py-3">
        <Button type="button" variant="secondary" onClick={onBack}>
          {labels.cancel}
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={!canSave || saving}
          onClick={() => void handleSave()}
        >
          {saving ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {labels.saving}
            </span>
          ) : (
            labels.save
          )}
        </Button>
      </div>
    </>
  );
}
