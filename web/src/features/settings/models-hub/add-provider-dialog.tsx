import type { ModelSetupUse } from '@xopcai/gateway-contract';
import {
  CheckCircle2,
  ChevronRight,
  Globe,
  Loader2,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import * as Dialog from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import { SecretInput } from '@/components/ui/secret-input';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import {
  type ProviderRowModel,
} from '@/features/settings/providers-api';
import {
  PROVIDER_ENRICHMENT,
} from '@/features/settings/provider-enrichment';
import { CATEGORY_ORDER, groupByCategory } from '@/features/settings/providers/providers-settings-lib';
import {
  API_TYPE_OPTIONS,
  discoverModels,
  saveModelsJson,
  type ApiType,
  type ModelsJsonConfig,
  type ProviderConfig,
} from '@/features/settings/models-json-api';
import {
  PROVIDER_PRESET_OPTIONS,
  PROVIDER_PRESETS,
  modelsJsonPresetKeyForProviderId,
  providerIdForPreset,
  selectClassName,
} from '@/features/settings/models/models-settings-lib';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { messages } from '@/i18n/messages';
import { secretInputLabelsFromChannels } from '@/lib/secret-input-labels';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import type { StoredLanguage } from '@/lib/storage';
import { Select, SelectOption } from '@/components/ui/popover-select';

import { type DefaultModelTarget } from './default-model-candidates';
import { DefaultModelSuccessStep } from './default-model-success-step';
import { ProviderSetupPanel } from './provider-setup-panel';


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
  close: string;
  back: string;
  getApiKey: string;
  getApiKeyIntl: string;
  getApiKeyCn: string;
  saveError: string;
  addModel: string;
  modelIdLabel: string;
  modelIdPlaceholder: string;
  discoverModels: string;
  discoveringModels: string;
  discoverModelsHint: string;
  noResults: string;
  recommended: string;
  connected: string;
  quickStart: string;
  connectedSection: string;
  searchResults: string;
  step1Subtitle: string;
  step1Title: string;
  step2BuiltinTitle: string;
  step2CustomTitle: string;
  presetLabel: string;
  presetCustom: string;
  presetOllama: string;
  presetLmStudio: string;
  presetOpenRouter: string;
  presetZhipuCn: string;
  presetZaiGeneral: string;
  apiTypeLabel: string;
  providerIdRequired: string;
  baseUrlRequired: string;
  categories: Record<string, string>;
}

type DialogStep =
  | { type: 'pick' }
  | { type: 'builtin'; providerId: string }
  | { type: 'custom'; presetKey?: string }
  | { type: 'success'; target: DefaultModelTarget };


interface AddProviderDialogProps {
  open: boolean;
  initialProviderId?: string;
  initialUse?: ModelSetupUse;
  connectOnly?: boolean;
  onOpenChange: (open: boolean) => void;
  builtinRows: ProviderRowModel[];
  customConfig: ModelsJsonConfig | null;
  labels: AddProviderDialogMessages;
  language: StoredLanguage;
  onSaved: (providerId: string, modelIds?: string[]) => void;
}

export function AddProviderDialog({
  open,
  initialProviderId,
  initialUse,
  connectOnly = false,
  onOpenChange,
  builtinRows,
  customConfig,
  labels,
  language,
  onSaved,
}: AddProviderDialogProps) {
  const [step, setStep] = useState<DialogStep>({ type: 'pick' });
  const [searchQuery, setSearchQuery] = useState('');
  const activeStep = step.type === 'pick' && initialProviderId ? { type: 'builtin' as const, providerId: initialProviderId } : step;
  const pickScrollTopRef = useRef(0);
  const selectedBrand = activeStep.type === 'builtin' ? builtinRows.find(row => row.id === activeStep.providerId)?.setupProfile?.brand : undefined;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        window.setTimeout(() => {
          setStep({ type: 'pick' });
          setSearchQuery('');
          pickScrollTopRef.current = 0;
        }, 200);
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const handleSaved = useCallback((providerId: string, modelIds?: string[]) => {
    const existing = builtinRows.some(row => row.id === providerId && row.configured);
    if (connectOnly || modelIds?.length === 0 || (modelIds === undefined && existing)) {
      onSaved(providerId);
      handleOpenChange(false);
    } else {
      setStep({ type: 'success', target: { providerId, modelIds } });
    }
  }, [onSaved, handleOpenChange, builtinRows, connectOnly]);

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'xopc-dialog-overlay fixed inset-0 bg-scrim',
            SETTINGS_SHELL_OVERLAY_Z,
          )}
        />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 flex h-[min(40rem,calc(100vh-3rem))] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay',
            SETTINGS_SHELL_CONTENT_Z,
          )}
        >
          {activeStep.type === 'success' ? (
            <DefaultModelSuccessStep target={activeStep.target} targetUse={initialUse} zh={language === 'zh'} onApplied={() => onSaved(activeStep.target.providerId)} onDone={() => handleOpenChange(false)} />
          ) : activeStep.type === 'pick' ? (
            <PickProviderStep
              builtinRows={builtinRows}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              labels={labels}
              language={language}
              scrollTopRef={pickScrollTopRef}
              onPickBuiltin={(id) => {
                const presetKey = modelsJsonPresetKeyForProviderId(id);
                setStep(presetKey ? { type: 'custom', presetKey } : { type: 'builtin', providerId: id });
              }}
              onPickCustom={() => setStep({ type: 'custom' })}
            />
          ) : activeStep.type === 'builtin' ? (
            <ProviderSetupPanel
              key={activeStep.providerId}
              providerId={activeStep.providerId}
              targetUse={initialUse}
              connectOnly={connectOnly}
              row={builtinRows.find(row => row.id === activeStep.providerId)}
              language={language}
              alternatives={selectedBrand ? builtinRows.filter(row => row.setupProfile?.brand === selectedBrand) : []}
              onChooseProvider={id => {
                const presetKey = modelsJsonPresetKeyForProviderId(id);
                setStep(presetKey ? { type: 'custom', presetKey } : { type: 'builtin', providerId: id });
              }}
              onBack={initialProviderId ? undefined : () => setStep({ type: 'pick' })}
              onApplied={() => { onSaved(activeStep.providerId); if (connectOnly) handleOpenChange(false); }}
              onDone={() => handleOpenChange(false)}
            />
          ) : (
            <ConfigureCustomStep
              initialPresetKey={activeStep.presetKey}
              customConfig={customConfig}
              labels={labels}
              language={language}
              onBack={() => setStep({ type: 'pick' })}
              onSaved={handleSaved}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DialogCloseButton({ label }: { label: string }) {
  return (
    <Dialog.Close asChild>
      <button
        type="button"
        className={cn('rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg', interaction.press)}
        aria-label={label}
      >
        <X className="size-4" aria-hidden />
      </button>
    </Dialog.Close>
  );
}

/* ── Step 1: Pick a provider ── */

function PickProviderStep({
  builtinRows,
  searchQuery,
  onSearchChange,
  labels,
  language,
  scrollTopRef,
  onPickBuiltin,
  onPickCustom,
}: {
  builtinRows: ProviderRowModel[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  labels: AddProviderDialogMessages;
  language: StoredLanguage;
  scrollTopRef: { current: number };
  onPickBuiltin: (id: string) => void;
  onPickCustom: () => void;
}) {
  const query = searchQuery.trim().toLowerCase();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (container && scrollTopRef.current > 0) {
      container.scrollTop = scrollTopRef.current;
    }
  }, [scrollTopRef]);

  const matchedRows = useMemo(() => {
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

  const filteredRows = useMemo(() => {
    const brands = new Set<string>();
    return matchedRows.filter(row => {
      const brand = row.setupProfile?.brand ?? row.id;
      if (brands.has(brand)) return false;
      brands.add(brand);
      return true;
    });
  }, [matchedRows]);
  const quickStartRows = filteredRows.filter(row => row.onboardingFeatured && ['subscription', 'account'].includes(row.setupProfile?.access ?? '')).slice(0, 6);
  const quickStartIds = quickStartRows.map(row => row.id);
  const connectedRows = filteredRows.filter(
    (row) => row.configured && !quickStartIds.includes(row.id),
  );
  const groups = useMemo(
    () => groupByCategory(filteredRows.filter(
      (row) => !quickStartIds.includes(row.id) && !row.configured,
    )),
    [filteredRows, quickStartIds],
  );
  const providerDescription = (row: ProviderRowModel) => {
    const enrichment = PROVIDER_ENRICHMENT[row.id];
    return language === 'zh'
      ? enrichment?.descriptionZh ?? enrichment?.description
      : enrichment?.description;
  };

  return (
    <>
      <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <Dialog.Title className="text-base font-semibold text-fg">{labels.step1Title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-fg-muted">{labels.step1Subtitle}</Dialog.Description>
        </div>
        <DialogCloseButton label={labels.close} />
      </div>

      <div className="px-5 pb-3">
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
            className={cn(
              'h-10 w-full rounded-xl border border-edge bg-surface-base py-2 pl-10 pr-3 text-sm text-fg placeholder:text-fg-subtle',
              settingsInputFocusClass,
            )}
          />
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={(event) => {
          scrollTopRef.current = event.currentTarget.scrollTop;
        }}
        className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-5 pb-5"
      >
        {query && filteredRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">{labels.noResults}</p>
        ) : query ? (
          <ProviderSection title={labels.searchResults}>
            {filteredRows.map((row) => (
              <ProviderPickButton
                key={row.id}
                row={row}
                description={providerDescription(row)}
                labels={labels}
                onPick={onPickBuiltin}
              />
            ))}
          </ProviderSection>
        ) : (
          <div className="flex flex-col gap-4">
            {quickStartRows.length > 0 ? (
              <ProviderSection title={labels.quickStart}>
                {quickStartRows.map(row => <ProviderPickButton
                  key={row.id}
                  row={row}
                  description={providerDescription(row)}
                  labels={labels}
                  prominent
                  onPick={onPickBuiltin}
                />)}
              </ProviderSection>
            ) : null}

            {connectedRows.length > 0 ? (
              <ProviderSection title={labels.connectedSection}>
                {connectedRows.map((row) => (
                  <ProviderPickButton
                    key={row.id}
                    row={row}
                    description={providerDescription(row)}
                    labels={labels}
                    onPick={onPickBuiltin}
                  />
                ))}
              </ProviderSection>
            ) : null}

            {CATEGORY_ORDER.map((cat) => {
              const list = groups.get(cat) ?? [];
              if (list.length === 0) return null;
              return (
                <ProviderSection key={cat} title={labels.categories[cat] ?? cat}>
                  {list.map((row) => (
                    <ProviderPickButton
                      key={row.id}
                      row={row}
                      description={providerDescription(row)}
                      labels={labels}
                      onPick={onPickBuiltin}
                    />
                  ))}
                </ProviderSection>
              );
            })}

            <button
              type="button"
              onClick={onPickCustom}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl bg-surface-hover/25 px-4 py-3 text-left transition-colors',
                'hover:bg-surface-hover/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-base/60 text-fg-muted">
                <Globe className="size-4" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg">{labels.addCustom}</span>
                <span className="mt-0.5 block text-xs text-fg-muted">{labels.customDescription}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function ProviderSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 px-1 text-xs font-semibold text-fg-muted">{title}</h3>
      <div className="flex flex-col gap-1 rounded-xl bg-surface-hover/20 p-1">{children}</div>
    </section>
  );
}

function ProviderPickButton({
  row,
  description,
  labels,
  prominent = false,
  onPick,
}: {
  row: ProviderRowModel;
  description?: string;
  labels: AddProviderDialogMessages;
  prominent?: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(row.id)}
      className={cn(
        'flex min-h-12 w-full items-center gap-3 rounded-lg bg-surface-base/55 px-3 py-2.5 text-left transition-colors',
        'hover:bg-surface-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        prominent && 'bg-surface-base/80',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-fg">{row.name}</span>
          {prominent ? (
            <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-fg">
              {labels.recommended}
            </span>
          ) : null}
        </span>
        {description ? <span className="mt-0.5 block truncate text-xs text-fg-muted">{description}</span> : null}
      </span>
      {row.configured ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-3.5" aria-hidden />
          {labels.connected}
        </span>
      ) : null}
      <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
    </button>
  );
}

/* ── Step 2b: Configure custom provider (preset + base URL + API type + key + models) ── */

type CustomProviderFormState = {
  preset: string;
  providerId: string;
  baseUrl: string;
  api: ApiType;
  apiKey: string;
  modelSlots: { clientKey: string; value: string }[];
  error: string | null;
};

function createModelSlot(value: string) {
  return { clientKey: crypto.randomUUID(), value };
}

function customFormFromPreset(presetKey = 'custom'): CustomProviderFormState {
  if (presetKey !== 'custom' && PROVIDER_PRESETS[presetKey]) {
    const p = PROVIDER_PRESETS[presetKey].config;
    return {
      preset: presetKey,
      providerId: providerIdForPreset(presetKey),
      baseUrl: p.baseUrl ?? '',
      api: (p.api as ApiType) ?? 'openai-completions',
      apiKey: p.apiKey ?? '',
      modelSlots: (p.models?.map((model) => model.id) ?? ['']).map(createModelSlot),
      error: null,
    };
  }
  return {
    preset: 'custom',
    providerId: '',
    baseUrl: '',
    api: 'openai-completions',
    apiKey: '',
    modelSlots: [createModelSlot('')],
    error: null,
  };
}

type CustomFormAction =
  | { type: 'applyPreset'; key: string }
  | { type: 'setProviderId'; value: string }
  | { type: 'setBaseUrl'; value: string }
  | { type: 'setApi'; value: ApiType }
  | { type: 'setApiKey'; value: string }
  | { type: 'addModelSlot' }
  | { type: 'updateModelId'; index: number; value: string }
  | { type: 'setModelIds'; values: string[] }
  | { type: 'removeModelSlot'; index: number }
  | { type: 'setError'; value: string | null };

function customFormReducer(state: CustomProviderFormState, action: CustomFormAction): CustomProviderFormState {
  switch (action.type) {
    case 'applyPreset':
      if (action.key === 'custom') {
        return { ...state, preset: 'custom', error: null };
      }
      if (!PROVIDER_PRESETS[action.key]) return state;
      return customFormFromPreset(action.key);
    case 'setProviderId':
      return { ...state, providerId: action.value };
    case 'setBaseUrl':
      return { ...state, baseUrl: action.value };
    case 'setApi':
      return { ...state, api: action.value };
    case 'setApiKey':
      return { ...state, apiKey: action.value };
    case 'addModelSlot':
      return { ...state, modelSlots: [...state.modelSlots, createModelSlot('')] };
    case 'updateModelId':
      return {
        ...state,
        modelSlots: state.modelSlots.map((slot, i) => (i === action.index ? { ...slot, value: action.value } : slot)),
      };
    case 'setModelIds':
      return { ...state, modelSlots: (action.values.length > 0 ? action.values : ['']).map(createModelSlot) };
    case 'removeModelSlot':
      return { ...state, modelSlots: state.modelSlots.filter((_, i) => i !== action.index) };
    case 'setError':
      return { ...state, error: action.value };
  }
}

function ConfigureCustomStep({
  initialPresetKey,
  customConfig,
  labels,
  language,
  onBack,
  onSaved,
}: {
  initialPresetKey?: string;
  customConfig: ModelsJsonConfig | null;
  labels: AddProviderDialogMessages;
  language: StoredLanguage;
  onBack: () => void;
  onSaved: (providerId: string, modelIds?: string[]) => void;
}) {
  const [form, dispatch] = useReducer(customFormReducer, undefined as never, () =>
    customFormFromPreset(initialPresetKey),
  );
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const secretLabels = secretInputLabelsFromChannels(messages(language).providersSettings);

  const { preset, providerId, baseUrl, api, apiKey, modelSlots, error } = form;
  const modelIds = modelSlots.map((slot) => slot.value);

  const handleSave = async () => {
    const trimmedId = providerId.trim();
    const trimmedUrl = baseUrl.trim();
    if (!trimmedId) {
      dispatch({ type: 'setError', value: labels.providerIdRequired });
      return;
    }
    if (!trimmedUrl) {
      dispatch({ type: 'setError', value: labels.baseUrlRequired });
      return;
    }

    const validModels = modelIds.map((m) => m.trim()).filter(Boolean);

    setSaving(true);
    dispatch({ type: 'setError', value: null });
    try {
      const existingProviders = customConfig?.providers ?? {};
      const presetConfig = preset === 'custom' ? undefined : PROVIDER_PRESETS[preset]?.config;
      const newProvider: ProviderConfig = {
        ...(presetConfig ?? {}),
        baseUrl: trimmedUrl,
        api,
        apiKey: apiKey.trim() || undefined,
        models: validModels.map((id) => presetConfig?.models?.find((model) => model.id === id) ?? { id }),
      };

      const updatedConfig: ModelsJsonConfig = {
        providers: {
          ...existingProviders,
          [trimmedId]: newProvider,
        },
      };

      await saveModelsJson(updatedConfig);
      const previousIds = new Set(existingProviders[trimmedId]?.models?.map(model => model.id) ?? []);
      onSaved(trimmedId, newProvider.models?.filter(model => !previousIds.has(model.id) && !model.computerUse).map(model => model.id) ?? []);
    } catch (e) {
      dispatch({ type: 'setError', value: e instanceof Error ? e.message : labels.saveError });
    } finally {
      setSaving(false);
    }
  };

  const handleDiscoverModels = async () => {
    const trimmedId = providerId.trim() || providerIdForPreset(preset) || 'custom';
    const trimmedUrl = baseUrl.trim();
    if (!trimmedUrl) {
      dispatch({ type: 'setError', value: labels.baseUrlRequired });
      return;
    }
    setDiscovering(true);
    dispatch({ type: 'setError', value: null });
    try {
      const presetConfig = preset === 'custom' ? undefined : PROVIDER_PRESETS[preset]?.config;
      const models = await discoverModels({
        providerId: trimmedId,
        baseUrl: trimmedUrl,
        apiKey: apiKey.trim() || undefined,
        api,
        headers: presetConfig?.headers,
      });
      const ids = models.map((model) => model.id).filter((id) => id && !id.includes('/'));
      dispatch({ type: 'setModelIds', values: ids });
      if (ids.length === 0) {
        dispatch({ type: 'setError', value: labels.discoverModelsHint });
      }
    } catch (e) {
      dispatch({ type: 'setError', value: e instanceof Error ? e.message : labels.discoverModelsHint });
    } finally {
      setDiscovering(false);
    }
  };

  const canSave = providerId.trim() && baseUrl.trim();
  const canDiscover = (api === 'openai-completions' || api === 'openai-responses') && baseUrl.trim();

  return (
    <>
      <div className="flex items-center gap-2 px-5 pb-3 pt-5">
        <button
          type="button"
          onClick={onBack}
          className={cn('rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg', interaction.press)}
          aria-label={labels.back}
        >
          <ChevronRight className="size-4 rotate-180" aria-hidden />
        </button>
        <Dialog.Title className="min-w-0 flex-1 text-base font-semibold text-fg">
          {labels.step2CustomTitle}
        </Dialog.Title>
        <DialogCloseButton label={labels.close} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        <div className="flex flex-col gap-4 rounded-xl bg-surface-hover/20 p-4">
        <p className="text-sm text-fg-muted">{labels.customDescription}</p>

        {/* Preset */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="custom-preset" className="text-sm font-medium text-fg">
            {labels.presetLabel}
          </label>
          <Select
            id="custom-preset"
            value={preset}
            onChange={(e) => dispatch({ type: 'applyPreset', key: e.target.value })}
            className={selectClassName()}
          >
            <SelectOption value="custom">{labels.presetCustom}</SelectOption>
            {PROVIDER_PRESET_OPTIONS.map((option) => (
              <SelectOption key={option.key} value={option.key}>
                {option.label}
              </SelectOption>
            ))}
          </Select>
        </div>

        {/* Provider ID */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="custom-provider-id" className="text-sm font-medium text-fg">
            {labels.providerIdLabel}
          </label>
          <input
            id="custom-provider-id"
            type="text"
            autoComplete="off"
            value={providerId}
            onChange={(e) => dispatch({ type: 'setProviderId', value: e.target.value })}
            placeholder={labels.providerIdPlaceholder}
            className={cn(
              'rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle',
              settingsInputFocusClass,
            )}
          />
        </div>

        {/* Base URL + API type */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="custom-base-url" className="text-sm font-medium text-fg">
              {labels.baseUrlLabel}
            </label>
            <input
              id="custom-base-url"
              type="url"
              autoComplete="off"
              value={baseUrl}
              onChange={(e) => dispatch({ type: 'setBaseUrl', value: e.target.value })}
              placeholder={labels.baseUrlPlaceholder}
              className={cn(
                'rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle',
                settingsInputFocusClass,
              )}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="custom-api-type" className="text-sm font-medium text-fg">
              {labels.apiTypeLabel}
            </label>
            <Select
              id="custom-api-type"
              value={api}
              onChange={(e) => dispatch({ type: 'setApi', value: e.target.value as ApiType })}
              className={selectClassName()}
            >
              {API_TYPE_OPTIONS.map((opt) => (
                <SelectOption key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectOption>
              ))}
            </Select>
          </div>
        </div>

        {/* API Key (optional) */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="custom-api-key" className="text-sm font-medium text-fg">
            {labels.apiKeyLabel}
          </label>
          <SecretInput
            id="custom-api-key"
            value={apiKey}
            onChange={(next) => dispatch({ type: 'setApiKey', value: next })}
            placeholder={labels.apiKeyPlaceholder}
            labels={secretLabels}
          />
        </div>

        {/* Model IDs */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-fg">{labels.modelIdLabel}</span>
            <Button
              type="button"
              variant="secondary"
              className="gap-1.5"
              disabled={!canDiscover || discovering}
              onClick={() => void handleDiscoverModels()}
            >
              {discovering ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Search className="size-3.5" aria-hidden />}
              {discovering ? labels.discoveringModels : labels.discoverModels}
            </Button>
          </div>
          {modelIds.map((modelId, index) => (
            <div key={modelSlots[index].clientKey} className="flex items-center gap-2">
              <input
                type="text"
                autoComplete="off"
                value={modelId}
                onChange={(e) => dispatch({ type: 'updateModelId', index, value: e.target.value })}
                placeholder={labels.modelIdPlaceholder}
                className={cn(
                  'flex-1 rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle',
                  settingsInputFocusClass,
                )}
              />
              {modelIds.length > 1 ? (
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'removeModelSlot', index })}
                  className={cn('rounded-lg p-1.5 text-fg-subtle hover:bg-surface-hover hover:text-fg', interaction.press)}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            className="w-fit gap-1.5 text-fg-muted"
            onClick={() => dispatch({ type: 'addModelSlot' })}
          >
            <Plus className="size-3.5" aria-hidden />
            {labels.addModel}
          </Button>
        </div>

        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 bg-surface-hover/15 px-5 py-3">
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
