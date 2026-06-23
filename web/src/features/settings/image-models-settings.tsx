import { Loader2, Save, Server } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer } from 'react';

import { createFormDraftReducer, uiPatchReducer } from '@/lib/settings-form-draft';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { useExtensions } from '@/features/extensions/extension-provider';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { useSaveBarRegistration } from '@/features/settings/save-bar/use-save-bar-registration';
import { SettingsCollapsibleSection } from '@/features/settings/settings-collapsible-section';
import { fetchImageProvidersList } from '@/features/settings/fetch-image-providers';
import {
  ImageProviderCredentialsPanel,
  type ImageProviderCredentialsPanelMessages,
} from '@/features/settings/image-provider-credentials-panel';
import { IMAGE_PROVIDERS_SWR_KEY } from '@/features/settings/image-providers-swr-key';
import {
  ImageModelPrimarySelectors,
  ImageModelFallbackChains,
} from '@/features/settings/agents/agent-defaults-panels/image-model-chains-section';
import {
  fetchAgentDefaults,
  parseParamsJsonForSave,
  patchAgentDefaults,
  type AgentDefaultsState,
} from '@/features/settings/config-api';
import { useImageProviderCredentials } from '@/features/settings/use-image-provider-credentials';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { apiUrl } from '@/lib/url';
import { cn } from '@/lib/cn';
import { showToast } from '@/lib/toast';
import { messages, type MessageBundle } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

function inputClass(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
  );
}

const imageProvidersSwrKey = () => apiUrl(IMAGE_PROVIDERS_SWR_KEY);

function pickImageDefaultsSlice(s: AgentDefaultsState) {
  return {
    imageModel: s.imageModel,
    imageModelFallbacks: s.imageModelFallbacks,
    imageGenerationModel: s.imageGenerationModel,
    imageGenerationModelFallbacks: s.imageGenerationModelFallbacks,
    imageGenerationModelTimeoutMs: s.imageGenerationModelTimeoutMs,
    imageGenerationModelAutoProviderFallback: s.imageGenerationModelAutoProviderFallback,
  };
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

const agentDefaultsFormReducer = createFormDraftReducer<AgentDefaultsState>();

type ImageModelsUi = {
  loading: boolean;
  saving: boolean;
  savedFlash: boolean;
  error: string | undefined;
};

const initialImageModelsUi: ImageModelsUi = {
  loading: true,
  saving: false,
  savedFlash: false,
  error: undefined,
};

/** See `WebSearchSettingsPanel` for the embedded-mode contract. */
export function ImageModelsSettingsPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.imageModelsSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [formDraft, dispatchForm] = useReducer(agentDefaultsFormReducer, { form: null, baseline: null });
  const state = formDraft.form;
  const baseline = formDraft.baseline;
  const [ui, dispatchUi] = useReducer(uiPatchReducer<ImageModelsUi>, initialImageModelsUi);
  const { loading, saving, error } = ui;

  const extensions = useExtensions();
  const extensionIds = useMemo(() => new Set(extensions.map((e) => e.id)), [extensions]);

  const reload = useCallback(async () => {
    if (!hasToken) return;
    dispatchUi({ type: 'patch', patch: { loading: true, error: undefined } });
    try {
      const fresh = await fetchAgentDefaults();
      const snapshot = structuredClone(fresh);
      dispatchForm({ type: 'sync', value: snapshot });
    } catch (err) {
      dispatchUi({
        type: 'patch',
        patch: { error: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      dispatchUi({ type: 'patch', patch: { loading: false } });
    }
  }, [hasToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const patchAgentDefaultsLocal = useCallback((patch: Partial<AgentDefaultsState>) => {
    dispatchForm({ type: 'patch', patch });
  }, []);

  const { data: providers = [] } = useSWR(
    hasToken ? imageProvidersSwrKey() : null,
    fetchImageProvidersList,
    { revalidateOnFocus: false },
  );

  // Drives the default-open state of the credentials collapsible below —
  // expand if the user already has at least one image provider with a key,
  // otherwise stay collapsed to keep the page short for new users.
  const hasConfiguredProvider = providers.some((p) => p.configured);

  const gwSwr = useGatewayConfigSwr(hasToken);

  const cred = useImageProviderCredentials(providers);

  const dirty = useMemo(() => {
    if (!state || !baseline) return false;
    return (
      JSON.stringify(pickImageDefaultsSlice(state)) !== JSON.stringify(pickImageDefaultsSlice(baseline))
    );
  }, [state, baseline]);

  const anyDirty = dirty || cred.credDirty;

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
    if (!state) return;
    dispatchUi({ type: 'patch', patch: { saving: true, error: undefined } });
    try {
      try {
        void parseParamsJsonForSave(state.paramsJson);
      } catch (e) {
        dispatchUi({
          type: 'patch',
          patch: {
            error:
              e instanceof SyntaxError
                ? m.agentSettings.advanced.paramsInvalidJson
                : e instanceof Error
                  ? e.message
                  : m.agentSettings.advanced.paramsInvalidJson,
          },
        });
        return;
      }
      // Save agent defaults + credentials in parallel
      const savePromises: Promise<void>[] = [];
      if (dirty) {
        savePromises.push(
          patchAgentDefaults(state).then(() => {
            dispatchForm({ type: 'saved', value: structuredClone(state) });
            void gwSwr.mutate?.();
          }),
        );
      }
      if (cred.credDirty) {
        savePromises.push(cred.saveCredentials(t.credentialsSaveError));
      }
      await Promise.all(savePromises);
      dispatchUi({ type: 'patch', patch: { savedFlash: true } });
      showToast({ type: 'success', title: t.saved });
    } catch (err) {
      dispatchUi({
        type: 'patch',
        patch: { error: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      dispatchUi({ type: 'patch', patch: { saving: false } });
    }
  }, [state, dirty, gwSwr, m.agentSettings, cred, t.credentialsSaveError]);

  const onDiscard = useCallback(() => {
    if (!baseline) return;
    dispatchForm({ type: 'discard' });
    if (cred.credDirty) cred.onDiscardCredentials();
    dispatchUi({ type: 'patch', patch: { error: undefined, savedFlash: false } });
  }, [baseline, cred]);

  useSaveBarRegistration({
    id: 'image-models',
    dirty: anyDirty,
    saving,
    save: onSave,
    discard: onDiscard,
  });

  const panelMsg = useMemo(() => panelMessagesFromBundle(t), [t]);
  const apiKeyLinkLabels = useMemo(
    () => ({
      getApiKey: m.providersSettings.getApiKey,
      getApiKeyIntl: m.providersSettings.getApiKeyIntl,
      getApiKeyCn: m.providersSettings.getApiKeyCn,
    }),
    [m.providersSettings],
  );

  const outerClass = embedded
    ? 'flex flex-col gap-4'
    : 'mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-8';
  const stubClass = embedded
    ? 'w-full text-sm text-fg-muted'
    : 'mx-auto w-full max-w-app-main px-4 py-8 text-sm text-fg-muted';
  const stubFlexClass = embedded
    ? 'flex w-full items-center gap-2 text-sm text-fg-muted'
    : 'mx-auto flex w-full max-w-app-main items-center gap-2 px-4 py-8 text-sm text-fg-muted';

  if (!hasToken) {
    return (
      <div className={stubClass}>
        {language === 'zh' ? '请先登录网关。' : 'Connect to a gateway to continue.'}
      </div>
    );
  }

  if (loading || !state) {
    return (
      <div className={stubFlexClass}>
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className={outerClass}>
      {embedded ? null : (
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight text-fg">{t.title}</h1>
            <p className="mt-1 text-sm text-fg-muted">{t.subtitle}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onDiscard} disabled={!anyDirty || saving}>
              {t.discard}
            </Button>
            <Button type="button" variant="primary" onClick={() => void onSave()} disabled={!anyDirty || saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              <span className="ml-1.5">{saving ? t.saving : t.save}</span>
            </Button>
          </div>
        </header>
      )}

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {/* Primary model selectors — always visible */}
      <ImageModelPrimarySelectors
        form={state}
        update={patchAgentDefaultsLocal}
        a={m.agentSettings}
        chat={m.chat}
      />

      {/* Fallback chains — collapsed by default */}
      <SettingsCollapsibleSection
        advancedOnly
        showLabel={t.fallbackChainsTitle}
        hideLabel={t.fallbackChainsTitle}
      >
        <ImageModelFallbackChains
          form={state}
          update={patchAgentDefaultsLocal}
          a={m.agentSettings}
          chat={m.chat}
        />
      </SettingsCollapsibleSection>

      {/* Runtime tuning — collapsed by default */}
      <SettingsCollapsibleSection
        advancedOnly
        showLabel={t.runtimeTuningTitle}
        hideLabel={t.runtimeTuningTitle}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-fg">{t.timeoutLabel}</label>
            <input
              type="number"
              min={0}
              step={1000}
              className={cn(inputClass(), 'max-w-48')}
              value={state.imageGenerationModelTimeoutMs ?? ''}
              placeholder="120000"
              onChange={(e) => {
                const raw = e.target.value.trim();
                const next = raw === '' ? null : Math.max(0, Math.floor(Number(raw)));
                patchAgentDefaultsLocal({
                  imageGenerationModelTimeoutMs: next && next > 0 ? next : null,
                });
              }}
            />
            <p className="text-xs text-fg-subtle">{t.timeoutHint}</p>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={state.imageGenerationModelAutoProviderFallback}
              onChange={(e) =>
                patchAgentDefaultsLocal({
                  imageGenerationModelAutoProviderFallback: e.target.checked,
                })
              }
              aria-label={t.autoFallbackLabel}
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-fg">{t.autoFallbackLabel}</span>
              <span className="text-xs text-fg-subtle">{t.autoFallbackHint}</span>
            </span>
          </label>
        </div>
      </SettingsCollapsibleSection>

      {/* Provider credentials — collapsed; expands if user already has configured providers */}
      <SettingsCollapsibleSection
        advancedOnly
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
