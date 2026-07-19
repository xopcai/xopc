import { Plus, Server, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import { uiPatchReducer } from '@/lib/settings-form-draft';
import useSWR from 'swr';

import { PopoverSelect, type PopoverSelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useExtensions } from '@/features/extensions/extension-provider';
import { fetchGatewayAgents } from '@/features/settings/agents-admin-api';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import { useSaveBarRegistration } from '@/features/settings/save-bar/use-save-bar-registration';
import { SettingsCollapsibleSection } from '@/features/settings/settings-collapsible-section';
import { fetchImageProvidersList } from '@/features/settings/fetch-image-providers';
import {
  fetchGlobalDefaults,
  updateGlobalDefaultModels,
  type GlobalDefaultModels,
} from '@/features/settings/global-defaults-api';
import {
  ImageProviderCredentialsPanel,
  type ImageProviderCredentialsPanelMessages,
} from '@/features/settings/image-provider-credentials-panel';
import { IMAGE_PROVIDERS_SWR_KEY } from '@/features/settings/image-providers-swr-key';
import { useImageProviderCredentials } from '@/features/settings/use-image-provider-credentials';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { messages, type MessageBundle } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const imageProvidersSwrKey = () => apiUrl(IMAGE_PROVIDERS_SWR_KEY);
const imageCapabilitiesSwrKey = (agentId?: string) => {
  const trimmed = agentId?.trim();
  return apiUrl(trimmed ? `/api/image/capabilities?agentId=${encodeURIComponent(trimmed)}` : '/api/image/capabilities');
};
const globalDefaultsSwrKey = () => apiUrl('/api/global-defaults');
const agentsSwrKey = () => 'image-models-agents';

type ImageCapabilityModel = {
  id: string;
  name: string;
  ref: string;
};

type ImageProviderCapability = {
  provider: string;
  configured: boolean;
  models: ImageCapabilityModel[];
};

type ImageModelResolutionSource = 'explicit' | 'auto-role' | 'auto-provider' | 'none';

type ImageCapabilitiesPayload = {
  current: {
    imageModel: string | null;
    imageModelFallbacks: string[];
    effectiveImageModel: string | null;
    effectiveImageModelFallbacks: string[];
    imageModelSource: ImageModelResolutionSource;
    imageModelRoleId?: string;
    imageModelRoleDescription?: string;
    imageGenerationModel: string | null;
    imageGenerationModelFallbacks: string[];
    imageGenerationModelTimeoutMs: number | null;
    imageGenerationModelAutoProviderFallback: boolean;
  };
  imageUnderstanding: { providers: ImageProviderCapability[] };
  imageGeneration: { providers: ImageProviderCapability[] };
};

type ImageModelDraft = {
  imageModel: string;
  imageModelFallbacks: string[];
  imageGenerationModel: string;
  imageGenerationModelFallbacks: string[];
  imageGenerationModelTimeoutMs: string;
  imageGenerationModelAutoProviderFallback: boolean;
};

const EMPTY_DRAFT: ImageModelDraft = {
  imageModel: '',
  imageModelFallbacks: [],
  imageGenerationModel: '',
  imageGenerationModelFallbacks: [],
  imageGenerationModelTimeoutMs: '',
  imageGenerationModelAutoProviderFallback: false,
};

async function fetchImageCapabilities(url: string): Promise<ImageCapabilitiesPayload> {
  const res = await fetchJson<{ ok?: boolean; payload?: ImageCapabilitiesPayload }>(url);
  if (!res.payload) {
    throw new Error('Invalid image capabilities response');
  }
  return res.payload;
}

function modelDraftFromDefaults(models?: GlobalDefaultModels): ImageModelDraft {
  return {
    imageModel: models?.imageModel?.primary ?? '',
    imageModelFallbacks: models?.imageModel?.fallbacks ?? [],
    imageGenerationModel: models?.imageGenerationModel?.primary ?? '',
    imageGenerationModelFallbacks: models?.imageGenerationModel?.fallbacks ?? [],
    imageGenerationModelTimeoutMs: models?.imageGenerationModel?.timeoutMs
      ? String(models.imageGenerationModel.timeoutMs)
      : '',
    imageGenerationModelAutoProviderFallback: models?.imageGenerationModel?.autoProviderFallback === true,
  };
}

function cleanFallbacks(values: string[]): string[] {
  return values.map((entry) => entry.trim()).filter(Boolean);
}

function applyModelDraft(models: GlobalDefaultModels, draft: ImageModelDraft): GlobalDefaultModels {
  const next: GlobalDefaultModels = {
    ...models,
    roles: { ...models.roles },
  };
  const imageModel = draft.imageModel.trim();
  if (imageModel) {
    const fallbacks = cleanFallbacks(draft.imageModelFallbacks);
    next.imageModel = {
      primary: imageModel,
      ...(fallbacks.length > 0 ? { fallbacks } : {}),
    };
  } else {
    delete next.imageModel;
  }

  const imageGenerationModel = draft.imageGenerationModel.trim();
  if (imageGenerationModel) {
    const fallbacks = cleanFallbacks(draft.imageGenerationModelFallbacks);
    const timeoutRaw = draft.imageGenerationModelTimeoutMs.trim();
    const timeoutMs = timeoutRaw ? Number(timeoutRaw) : undefined;
    next.imageGenerationModel = {
      primary: imageGenerationModel,
      ...(fallbacks.length > 0 ? { fallbacks } : {}),
      ...(Number.isFinite(timeoutMs) && timeoutMs && timeoutMs > 0
        ? { timeoutMs: Math.floor(timeoutMs) }
        : {}),
      ...(draft.imageGenerationModelAutoProviderFallback ? { autoProviderFallback: true } : {}),
    };
  } else {
    delete next.imageGenerationModel;
  }

  return next;
}

function flattenModelOptions(providers: ImageProviderCapability[]): Array<{
  value: string;
  label: string;
  configured: boolean;
}> {
  return providers
    .filter((provider) => provider.configured)
    .flatMap((provider) =>
      provider.models.map((model) => ({
        value: model.ref,
        label: `${model.name || model.id} · ${model.ref}`,
        configured: provider.configured,
      })),
    )
    .sort((a, b) => Number(b.configured) - Number(a.configured) || a.value.localeCompare(b.value));
}

function formatTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template,
  );
}

function panelMessagesFromBundle(t: MessageBundle['imageModelsSettings']): ImageProviderCredentialsPanelMessages {
  return {
    credentialsIntro: t.credentialsIntro,
    regionHint: t.regionHint,
    endpointPresetsHint: t.endpointPresetsHint,
    apiKeyLabel: t.apiKeyLabel,
    optionalPlaceholder: t.optionalPlaceholder,
    regionLabel: t.regionLabel,
    baseUrlLabel: t.baseUrlLabel,
    imageBaseUrlLabel: t.imageBaseUrlLabel,
    saveCredentials: t.saveCredentials,
    savingCredentials: t.savingCredentials,
    credentialsSaved: t.credentialsSaved,
    discardCredentials: t.discardCredentials,
    credentialsNothingToSave: t.credentialsNothingToSave,
    credentialsSaveError: t.credentialsSaveError,
    regionPresetDefault: t.regionPresetDefault,
    regionPresetCustom: t.regionPresetCustom,
    baseUrlPresetDefault: t.baseUrlPresetDefault,
    baseUrlPresetCustom: t.baseUrlPresetCustom,
    openExtensionSettings: t.openExtensionSettings,
    openImageModelsPage: t.openImageModelsPage,
    extensionSettingsLinkTitle: t.extensionSettingsLinkTitle,
    imageModelsLinkTitle: t.imageModelsLinkTitle,
    configured: t.configured,
    missingKey: t.missingKey,
    unsavedChanges: t.unsavedChanges,
    expandProvider: t.expandProvider,
    collapseProvider: t.collapseProvider,
    defaultModel: t.defaultModel,
    modelsLabel: t.modelsLabel,
    modelCountOne: t.modelCountOne,
    modelCountMany: t.modelCountMany,
    imageBaseUrlPresetHint: t.imageBaseUrlPresetHint,
    dashscopeRegion_beijing: t.dashscopeRegion_beijing,
    dashscopeRegion_singapore: t.dashscopeRegion_singapore,
    dashscopeRegion_us: t.dashscopeRegion_us,
    apiKeyMaskedHelp: t.apiKeyMaskedHelp,
    apiKeyCopy: t.apiKeyCopy,
    apiKeyCopied: t.apiKeyCopied,
    apiKeyShow: t.apiKeyShow,
    apiKeyHide: t.apiKeyHide,
    apiKeyNotInConfigFile: t.apiKeyNotInConfigFile,
    apiKeyRevealFailed: t.apiKeyRevealFailed,
    minimaxClusterLabel: t.minimaxClusterLabel,
    minimaxClusterHint: t.minimaxClusterHint,
    falQueueBaseLabel: t.falQueueBaseLabel,
    falQueueBaseHint: t.falQueueBaseHint,
  };
}

type ImageModelsUi = {
  saving: boolean;
  savedFlash: boolean;
  error: string | undefined;
};

const initialImageModelsUi: ImageModelsUi = {
  saving: false,
  savedFlash: false,
  error: undefined,
};

function RuntimeImageUnderstandingStatus({
  current,
  agentId,
  agentOptions,
  t,
  onAgentIdChange,
}: {
  current: ImageCapabilitiesPayload['current'] | undefined;
  agentId: string;
  agentOptions: PopoverSelectOption[];
  t: MessageBundle['imageModelsSettings'];
  onAgentIdChange: (agentId: string) => void;
}) {
  const effectiveModel = current?.effectiveImageModel ?? null;
  const source = current?.imageModelSource ?? 'none';
  const roleLabel = current?.imageModelRoleId ?? current?.imageModelRoleDescription ?? '';
  const detail =
    source === 'explicit'
      ? t.runtimeUnderstandingExplicit
      : source === 'auto-role'
        ? formatTemplate(t.runtimeUnderstandingAutoRole, { role: roleLabel || 'unknown' })
        : source === 'auto-provider'
          ? t.runtimeUnderstandingAutoProvider
          : t.runtimeUnderstandingNone;
  const fallbackText = current?.effectiveImageModelFallbacks?.length
    ? formatTemplate(t.runtimeUnderstandingFallbacks, {
        models: current.effectiveImageModelFallbacks.join(', '),
      })
    : t.runtimeUnderstandingNoFallbacks;

  return (
    <section className="rounded-lg border border-edge bg-surface-base p-4">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{t.runtimeUnderstandingTitle}</h3>
          <p className="mt-1 max-w-[72ch] text-xs leading-relaxed text-fg-muted">{detail}</p>
        </div>
        {agentOptions.length > 0 ? (
          <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-fg-muted sm:w-56">
            {t.runtimeAgentLabel}
            <PopoverSelect
              value={agentId}
              options={agentOptions}
              placeholder={t.runtimeAgentLabel}
              allowEmpty={false}
              triggerClassName="bg-surface-panel"
              onChange={onAgentIdChange}
            />
          </label>
        ) : null}
      </div>
      <div className="rounded-lg bg-surface-subtle px-3 py-2 shadow-surface">
        <div className="text-sm font-medium text-fg">{effectiveModel ?? t.noModelSelected}</div>
        <div className="mt-1 text-xs text-fg-muted">{fallbackText}</div>
      </div>
      {agentOptions.length > 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">{t.runtimeAgentHint}</p>
      ) : null}
    </section>
  );
}

function ImageModelSelectSection({
  title,
  description,
  primaryLabel,
  fallbackLabel,
  fallbackPlaceholder,
  value,
  fallbackValues,
  options,
  emptyLabel,
  onValueChange,
  onFallbackValuesChange,
}: {
  title: string;
  description: string;
  primaryLabel: string;
  fallbackLabel: string;
  fallbackPlaceholder: string;
  value: string;
  fallbackValues: string[];
  options: PopoverSelectOption[];
  emptyLabel: string;
  onValueChange: (value: string) => void;
  onFallbackValuesChange: (value: string[]) => void;
}) {
  const selected = new Set([value, ...fallbackValues].filter(Boolean));
  const nextFallbackValue = value ? (options.find((option) => !selected.has(option.value))?.value ?? '') : '';
  const addFallback = () => {
    if (!nextFallbackValue) return;
    onFallbackValuesChange([...fallbackValues, nextFallbackValue]);
  };
  const updateFallback = (index: number, nextValue: string) => {
    const next = [...fallbackValues];
    next[index] = nextValue;
    onFallbackValuesChange(next);
  };
  const removeFallback = (index: number) => {
    onFallbackValuesChange(fallbackValues.filter((_, i) => i !== index));
  };

  return (
    <section className="rounded-lg bg-surface-base p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">{description}</p>
      </div>
      <div className="grid gap-3">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-muted">
          {primaryLabel}
          <PopoverSelect
            value={value}
            options={options}
            placeholder={emptyLabel}
            emptyLabel={emptyLabel}
            disabledValues={new Set(fallbackValues)}
            onChange={onValueChange}
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-medium text-fg-muted">{fallbackLabel}</div>
          <div className="flex flex-col gap-2">
            {fallbackValues.length === 0 ? (
              <div className="flex min-h-10 items-center rounded-lg bg-surface-subtle px-3 text-sm font-normal text-fg-subtle shadow-surface">
                {fallbackPlaceholder}
              </div>
            ) : (
              fallbackValues.map((fallback, index) => (
                <div key={`${index}:${fallback}`} className="grid h-10 grid-cols-[minmax(0,1fr)_2.5rem] gap-2">
                  <PopoverSelect
                    value={fallback}
                    options={options}
                    placeholder={emptyLabel}
                    emptyLabel={emptyLabel}
                    allowEmpty={false}
                    disabledValues={selected}
                    onChange={(nextValue) => updateFallback(index, nextValue)}
                  />
                  <button
                    type="button"
                    onClick={() => removeFallback(index)}
                    className="box-border inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface-subtle text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:border-edge-strong"
                    aria-label={fallbackLabel}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
              ))
            )}
            <button
              type="button"
              onClick={addFallback}
              disabled={!nextFallbackValue}
              className="box-border inline-flex h-9 w-fit min-w-[7.5rem] items-center justify-center gap-2 rounded-lg border border-edge bg-surface-base px-3 text-sm text-fg disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:border-edge-strong"
            >
              <Plus className="size-4" aria-hidden="true" />
              {fallbackLabel}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ImageModelsSettingsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      {Array.from({ length: 2 }).map((_, i) => (
        <section key={i} className="rounded-lg bg-surface-base p-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-72 max-w-full" />
          <div className="mt-4 grid gap-3">
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-9 w-36 rounded-lg" />
          </div>
        </section>
      ))}
      <section className="rounded-lg bg-surface-base p-4">
        <Skeleton className="h-4 w-36" />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
        </div>
      </section>
    </div>
  );
}

export function ImageModelsSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.imageModelsSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [ui, dispatchUi] = useReducer(uiPatchReducer<ImageModelsUi>, initialImageModelsUi);
  const { saving, error } = ui;

  const extensions = useExtensions();
  const extensionIds = useMemo(() => new Set(extensions.map((e) => e.id)), [extensions]);

  const { data: providers = [], isLoading: providersLoading } = useSWR(
    hasToken ? imageProvidersSwrKey() : null,
    fetchImageProvidersList,
    { revalidateOnFocus: false },
  );
  const { data: agentsData, isLoading: agentsLoading } = useSWR(
    hasToken ? agentsSwrKey() : null,
    fetchGatewayAgents,
    { revalidateOnFocus: false },
  );
  const [selectedRuntimeAgentId, setSelectedRuntimeAgentId] = useState('');
  useEffect(() => {
    if (!agentsData) return;
    setSelectedRuntimeAgentId((prev) => {
      if (prev && agentsData.agents.some((agent) => agent.id === prev)) {
        return prev;
      }
      return agentsData.defaultId || agentsData.agents[0]?.id || '';
    });
  }, [agentsData]);
  const { data: imageCapabilities, isLoading: capabilitiesLoading, mutate: mutateImageCapabilities } = useSWR(
    hasToken ? imageCapabilitiesSwrKey(selectedRuntimeAgentId) : null,
    fetchImageCapabilities,
    { revalidateOnFocus: false },
  );
  const { data: globalDefaults, isLoading: defaultsLoading, mutate: mutateGlobalDefaults } = useSWR(
    hasToken ? globalDefaultsSwrKey() : null,
    fetchGlobalDefaults,
    { revalidateOnFocus: false },
  );

  // Drives the default-open state of the credentials collapsible below —
  // expand if the user already has at least one image provider with a key,
  // otherwise stay collapsed to keep the page short for new users.
  const hasConfiguredProvider = providers.some((p) => p.configured);

  const cred = useImageProviderCredentials(providers);

  const [modelDraft, setModelDraft] = useState<ImageModelDraft>(EMPTY_DRAFT);
  const [modelBaseline, setModelBaseline] = useState<ImageModelDraft>(EMPTY_DRAFT);

  useEffect(() => {
    if (!globalDefaults?.models) return;
    const next = modelDraftFromDefaults(globalDefaults.models);
    setModelDraft(next);
    setModelBaseline(next);
  }, [globalDefaults?.models]);

  const modelDirty = JSON.stringify(modelDraft) !== JSON.stringify(modelBaseline);
  const anyDirty = cred.credDirty || modelDirty;

  useEffect(() => {
    if (!anyDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [anyDirty]);

  const onSave = useCallback(async () => {
    dispatchUi({ type: 'patch', patch: { saving: true, error: undefined } });
    try {
      if (modelDirty) {
        if (!globalDefaults?.models) {
          throw new Error(t.loadError);
        }
        const updated = await updateGlobalDefaultModels(applyModelDraft(globalDefaults.models, modelDraft));
        await mutateGlobalDefaults(updated, false);
        await mutateImageCapabilities();
        const next = modelDraftFromDefaults(updated.models);
        setModelDraft(next);
        setModelBaseline(next);
      }
      if (cred.credDirty) {
        await cred.saveCredentials(t.credentialsSaveError);
        await mutateImageCapabilities();
      }
      dispatchUi({ type: 'patch', patch: { savedFlash: true } });
    } catch (err) {
      dispatchUi({
        type: 'patch',
        patch: { error: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      dispatchUi({ type: 'patch', patch: { saving: false } });
    }
  }, [
    cred,
    globalDefaults?.models,
    modelDirty,
    modelDraft,
    mutateGlobalDefaults,
    mutateImageCapabilities,
    t.credentialsSaveError,
    t.loadError,
    t.saved,
  ]);

  const onDiscard = useCallback(() => {
    if (cred.credDirty) cred.onDiscardCredentials();
    if (modelDirty) setModelDraft(modelBaseline);
    dispatchUi({ type: 'patch', patch: { error: undefined, savedFlash: false } });
  }, [cred, modelBaseline, modelDirty]);

  useSaveBarRegistration({
    id: 'image-models',
    dirty: anyDirty,
    saving,
    save: onSave,
    discard: onDiscard,
  });

  const panelMsg = useMemo(() => panelMessagesFromBundle(t), [t]);
  const understandingOptions = useMemo(
    () => flattenModelOptions(imageCapabilities?.imageUnderstanding.providers ?? []),
    [imageCapabilities?.imageUnderstanding.providers],
  );
  const generationOptions = useMemo(
    () => flattenModelOptions(imageCapabilities?.imageGeneration.providers ?? []),
    [imageCapabilities?.imageGeneration.providers],
  );
  const apiKeyLinkLabels = useMemo(
    () => ({
      getApiKey: m.providersSettings.getApiKey,
      getApiKeyIntl: m.providersSettings.getApiKeyIntl,
      getApiKeyCn: m.providersSettings.getApiKeyCn,
    }),
    [m.providersSettings],
  );
  const runtimeAgentOptions = useMemo(
    () =>
      (agentsData?.agents ?? []).map((agent) => ({
        value: agent.id,
        label: agentListDisplayName(agent, m.agentsSettings),
      })),
    [agentsData?.agents, m.agentsSettings],
  );

  if (!hasToken) {
    return (
      <div className="w-full text-sm text-fg-muted">
        {language === 'zh' ? '请先登录网关。' : 'Connect to a gateway to continue.'}
      </div>
    );
  }

  if (providersLoading || capabilitiesLoading || defaultsLoading || agentsLoading) {
    return <ImageModelsSettingsSkeleton />;
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <RuntimeImageUnderstandingStatus
        current={imageCapabilities?.current}
        agentId={selectedRuntimeAgentId}
        agentOptions={runtimeAgentOptions}
        t={t}
        onAgentIdChange={setSelectedRuntimeAgentId}
      />

      <ImageModelSelectSection
        title={t.understandingTitle}
        description={t.understandingDescription}
        primaryLabel={t.primaryModelLabel}
        fallbackLabel={t.fallbackModelsLabel}
        fallbackPlaceholder={t.fallbackModelsPlaceholder}
        value={modelDraft.imageModel}
        fallbackValues={modelDraft.imageModelFallbacks}
        options={understandingOptions}
        emptyLabel={t.noModelSelected}
        onValueChange={(imageModel) =>
          setModelDraft((draft) => ({
            ...draft,
            imageModel,
            imageModelFallbacks: imageModel
              ? draft.imageModelFallbacks.filter((fallback) => fallback !== imageModel)
              : [],
          }))
        }
        onFallbackValuesChange={(imageModelFallbacks) =>
          setModelDraft((draft) => ({ ...draft, imageModelFallbacks }))
        }
      />

      <ImageModelSelectSection
        title={t.generationTitle}
        description={t.generationDescription}
        primaryLabel={t.primaryModelLabel}
        fallbackLabel={t.fallbackModelsLabel}
        fallbackPlaceholder={t.fallbackModelsPlaceholder}
        value={modelDraft.imageGenerationModel}
        fallbackValues={modelDraft.imageGenerationModelFallbacks}
        options={generationOptions}
        emptyLabel={t.noModelSelected}
        onValueChange={(imageGenerationModel) =>
          setModelDraft((draft) => ({
            ...draft,
            imageGenerationModel,
            imageGenerationModelFallbacks: imageGenerationModel
              ? draft.imageGenerationModelFallbacks.filter((fallback) => fallback !== imageGenerationModel)
              : [],
          }))
        }
        onFallbackValuesChange={(imageGenerationModelFallbacks) =>
          setModelDraft((draft) => ({ ...draft, imageGenerationModelFallbacks }))
        }
      />

      <section className="rounded-lg bg-surface-base p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-fg">{t.runtimeTuningTitle}</h3>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">{t.runtimeTuningHint}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-muted">
            {t.timeoutLabel}
            <input
              type="number"
              min={1}
              value={modelDraft.imageGenerationModelTimeoutMs}
              onChange={(event) =>
                setModelDraft((draft) => ({
                  ...draft,
                  imageGenerationModelTimeoutMs: event.target.value,
                }))
              }
              placeholder="120000"
              className="h-10 rounded-lg border border-edge bg-surface-subtle px-3 text-sm font-normal text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <label className="flex items-start gap-3 rounded-lg border border-edge bg-surface-subtle px-3 py-2.5 text-sm text-fg">
            <input
              type="checkbox"
              checked={modelDraft.imageGenerationModelAutoProviderFallback}
              onChange={(event) =>
                setModelDraft((draft) => ({
                  ...draft,
                  imageGenerationModelAutoProviderFallback: event.target.checked,
                }))
              }
              className="mt-0.5 size-4 rounded border-edge accent-accent"
            />
            <span>
              <span className="block font-medium">{t.autoFallbackLabel}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">
                {t.autoFallbackHint}
              </span>
            </span>
          </label>
        </div>
      </section>

      {/* Provider credentials — collapsed; expands if user already has configured providers */}
      <SettingsCollapsibleSection
        icon={Server}
        showLabel={t.providersTitle}
        hideLabel={t.providersTitle}
        defaultOpen={hasConfiguredProvider}
      >
        {providers.length === 0 ? (
          <p className="text-sm text-fg-muted">{t.providersEmpty}</p>
        ) : (
          <ImageProviderCredentialsPanel
            summaries={providers}
            credDraft={cred.credDraft}
            credBaseline={cred.credBaseline}
            credDirty={cred.credDirty}
            credSaving={cred.credSaving}
            credError={cred.credError}
            credSavedFlash={cred.credSavedFlash}
            credNoopFlash={cred.credNoopFlash}
            updateCredRow={cred.updateCredRow}
            onDiscardCredentials={cred.onDiscardCredentials}
            onSaveCredentials={() => void cred.saveCredentials(t.credentialsSaveError)}
            extensionIds={extensionIds}
            showExtensionLinks
            showImageModelsLink={false}
            hideActions
            language={language}
            apiKeyLinkLabels={apiKeyLinkLabels}
            messages={panelMsg}
          />
        )}
      </SettingsCollapsibleSection>
    </div>
  );
}
