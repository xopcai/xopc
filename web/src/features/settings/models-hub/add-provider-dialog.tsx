import {
  CheckCircle2,
  ChevronRight,
  Globe,
  Loader2,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import * as Dialog from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import { SecretInput } from '@/components/ui/secret-input';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import {
  cancelOAuth,
  cleanupOAuthSession,
  fetchOAuthSessionStatus,
  startAsyncOAuthLogin,
  submitOAuthCode,
} from '@/features/settings/oauth-api';
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

import { XopcCloudConnect } from './xopc-cloud-connect';

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
  | { type: 'xopcCloud' }
  | { type: 'builtin'; providerId: string }
  | { type: 'custom'; presetKey?: string };

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

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        window.setTimeout(() => {
          setStep({ type: 'pick' });
          setSearchQuery('');
        }, 200);
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const handleSaved = useCallback(() => {
    onSaved();
    handleOpenChange(false);
  }, [onSaved, handleOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
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
        >
          {step.type === 'pick' ? (
            <PickProviderStep
              builtinRows={builtinRows}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              labels={labels}
              onPickBuiltin={(id) => {
                if (id === 'xopc-cloud') {
                  setStep({ type: 'xopcCloud' });
                  return;
                }
                const presetKey = modelsJsonPresetKeyForProviderId(id);
                setStep(presetKey ? { type: 'custom', presetKey } : { type: 'builtin', providerId: id });
              }}
              onPickCustom={() => setStep({ type: 'custom' })}
            />
          ) : step.type === 'xopcCloud' ? (
            <ConfigureXopcCloudStep
              connected={builtinRows.some((row) => row.id === 'xopc-cloud' && row.configured)}
              labels={labels}
              onBack={() => setStep({ type: 'pick' })}
              onConnected={handleSaved}
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
              initialPresetKey={step.presetKey}
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

function ConfigureXopcCloudStep({
  connected,
  labels,
  onBack,
  onConnected,
}: {
  connected: boolean;
  labels: AddProviderDialogMessages;
  onBack: () => void;
  onConnected: () => void;
}) {
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
        <Dialog.Title className="min-w-0 flex-1 text-base font-semibold text-fg">
          XOPC Model Service
        </Dialog.Title>
        <DialogCloseButton label={labels.close} />
      </div>

      <div className="px-5 py-4">
        <XopcCloudConnect connected={connected} onConnected={onConnected} />
      </div>
    </>
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
      <div className="flex items-center justify-between gap-2 border-b border-edge-subtle px-5 py-4">
        <Dialog.Title className="min-w-0 flex-1 text-base font-semibold text-fg">{labels.step1Title}</Dialog.Title>
        <DialogCloseButton label={labels.close} />
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
  const providerLabels = messages(language).providersSettings;
  const secretLabels = secretInputLabelsFromChannels(providerLabels);
  const apiKeyLinks = useMemo(
    () => getOrderedApiKeyLinks(providerId, language),
    [providerId, language],
  );
  const supportsApiKey = row?.supportsApiKey !== false;
  const supportsOAuth = row?.supportsOAuth === true;

  const [oauthSessionId, setOAuthSessionId] = useState<string | null>(null);
  const [oauthMessage, setOAuthMessage] = useState<string | null>(null);
  const [oauthStatus, setOAuthStatus] = useState<'idle' | 'waiting' | 'waiting_code' | 'success' | 'error'>('idle');
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const oauthLoading = oauthStatus === 'waiting' || oauthStatus === 'waiting_code';

  useEffect(() => {
    if (!oauthSessionId || !oauthLoading) return;
    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          const status = await fetchOAuthSessionStatus(oauthSessionId);
          if (status.status === 'waiting_auth' || status.status === 'waiting_code') {
            setOAuthStatus(status.status === 'waiting_code' ? 'waiting_code' : 'waiting');
            setOAuthMessage(status.message ?? null);
            setAuthUrl(status.authUrl ?? null);
            setInstructions(status.instructions ?? null);
          } else if (status.status === 'completed') {
            window.clearInterval(intervalId);
            setOAuthStatus('success');
            setOAuthMessage(status.message ?? providerLabels.saved);
            window.setTimeout(onSaved, 600);
          } else if (status.status === 'failed' || status.status === 'cancelled') {
            window.clearInterval(intervalId);
            setOAuthStatus('error');
            setOAuthMessage(status.error ?? status.message ?? providerLabels.revokeFailed);
          }
        } catch {
          // Keep polling; transient gateway reloads should not kill the flow.
        }
      })();
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [oauthSessionId, oauthLoading, onSaved, providerLabels.revokeFailed, providerLabels.saved]);

  useEffect(() => {
    return () => {
      if (oauthSessionId) {
        void cleanupOAuthSession(oauthSessionId).catch(() => {});
      }
    };
  }, [oauthSessionId]);

  const startOAuth = async () => {
    setOAuthStatus('waiting');
    setOAuthMessage(providerLabels.oauthStarting);
    setError(null);
    try {
      const result = await startAsyncOAuthLogin(providerId);
      setOAuthSessionId(result.sessionId);
    } catch (e) {
      setOAuthStatus('error');
      setOAuthMessage(e instanceof Error ? e.message : providerLabels.revokeFailed);
    }
  };

  const cancelFlow = async () => {
    if (!oauthSessionId) return;
    try {
      await cancelOAuth(oauthSessionId);
    } catch {
      // Best effort cancellation.
    }
    setOAuthStatus('idle');
    setOAuthMessage(null);
    setOAuthSessionId(null);
    setAuthUrl(null);
    setInstructions(null);
  };

  const submitCode = async () => {
    if (!oauthSessionId || !codeInput.trim()) return;
    try {
      await submitOAuthCode(oauthSessionId, codeInput.trim());
      setCodeInput('');
      setOAuthMessage(providerLabels.oauthProcessingCode);
    } catch (e) {
      setOAuthStatus('error');
      setOAuthMessage(e instanceof Error ? e.message : providerLabels.revokeFailed);
    }
  };

  const handleSave = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed || !supportsApiKey) return;
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
        <Dialog.Title className="min-w-0 flex-1 text-base font-semibold text-fg">
          {row?.name ?? providerId}
        </Dialog.Title>
        <DialogCloseButton label={labels.close} />
      </div>

      <div className="flex flex-col gap-4 px-5 py-4">
        {enrichment?.description ? (
          <p className="text-sm text-fg-muted">{enrichment.description}</p>
        ) : null}

        {supportsApiKey ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="builtin-api-key" className="text-sm font-medium text-fg">
              {labels.apiKeyLabel}
            </label>
            <SecretInput
              id="builtin-api-key"
              value={apiKey}
              onChange={setApiKey}
              placeholder={labels.apiKeyPlaceholder}
              labels={secretLabels}
              inputRef={inputRef}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSave();
              }}
            />
          </div>
        ) : null}

        {supportsOAuth ? (
          <div className="flex flex-col gap-2 rounded-lg border border-edge-subtle bg-surface-panel/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">{providerLabels.oauth}</p>
                <p className="mt-0.5 text-xs text-fg-muted">{providerLabels.oauthHint}</p>
              </div>
              <Button
                type="button"
                variant="primary"
                className="gap-1.5"
                disabled={oauthLoading}
                onClick={() => void startOAuth()}
              >
                {oauthLoading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                {providerLabels.oauth}
              </Button>
            </div>
            {oauthMessage ? (
              <p className={cn('text-xs', oauthStatus === 'error' ? 'text-red-600 dark:text-red-400' : 'text-fg-muted')}>
                {oauthMessage}
              </p>
            ) : null}
            {(oauthStatus === 'waiting' || oauthStatus === 'waiting_code') ? (
              <div className="flex flex-wrap gap-2">
                {authUrl ? (
                  <a
                    href={authUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
                  >
                    {providerLabels.openAuthPage}
                    <span className="size-3" aria-hidden>↗</span>
                  </a>
                ) : null}
                <Button type="button" variant="secondary" onClick={() => void cancelFlow()}>
                  {providerLabels.cancelOAuth}
                </Button>
              </div>
            ) : null}
            {instructions ? <p className="text-xs text-fg-muted">{instructions}</p> : null}
            {oauthStatus === 'waiting_code' ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={codeInput}
                  onChange={(event) => setCodeInput(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && void submitCode()}
                  placeholder={providerLabels.pasteRedirectUrl}
                  className={cn(
                    'min-w-0 flex-1 rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle',
                    settingsInputFocusClass,
                  )}
                />
                <Button type="button" variant="primary" onClick={() => void submitCode()}>
                  {providerLabels.submitCode}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {apiKeyLinks.length > 0 && supportsApiKey ? (
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
          {supportsApiKey ? (
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
          ) : null}
        </div>
      </div>
    </>
  );
}

/* ── Step 2b: Configure custom provider (preset + base URL + API type + key + models) ── */

type CustomProviderFormState = {
  preset: string;
  providerId: string;
  baseUrl: string;
  api: ApiType;
  apiKey: string;
  modelIds: string[];
  error: string | null;
};

function customFormFromPreset(presetKey = 'custom'): CustomProviderFormState {
  if (presetKey !== 'custom' && PROVIDER_PRESETS[presetKey]) {
    const p = PROVIDER_PRESETS[presetKey].config;
    return {
      preset: presetKey,
      providerId: providerIdForPreset(presetKey),
      baseUrl: p.baseUrl ?? '',
      api: (p.api as ApiType) ?? 'openai-completions',
      apiKey: p.apiKey ?? '',
      modelIds: p.models?.map((model) => model.id) ?? [''],
      error: null,
    };
  }
  return {
    preset: 'custom',
    providerId: '',
    baseUrl: '',
    api: 'openai-completions',
    apiKey: '',
    modelIds: [''],
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
      return { ...state, modelIds: [...state.modelIds, ''] };
    case 'updateModelId':
      return {
        ...state,
        modelIds: state.modelIds.map((m, i) => (i === action.index ? action.value : m)),
      };
    case 'setModelIds':
      return { ...state, modelIds: action.values.length > 0 ? action.values : [''] };
    case 'removeModelSlot':
      return { ...state, modelIds: state.modelIds.filter((_, i) => i !== action.index) };
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
  onSaved: () => void;
}) {
  const [form, dispatch] = useReducer(customFormReducer, undefined as never, () =>
    customFormFromPreset(initialPresetKey),
  );
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const secretLabels = secretInputLabelsFromChannels(messages(language).providersSettings);

  const { preset, providerId, baseUrl, api, apiKey, modelIds, error } = form;

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
      onSaved();
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
      <div className="flex items-center gap-2 border-b border-edge-subtle px-5 py-4">
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

      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-5 py-4">
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
            <div key={modelId || `model-slot-${index}`} className="flex items-center gap-2">
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
