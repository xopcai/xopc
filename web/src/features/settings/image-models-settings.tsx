import { Image as ImageIcon, Loader2, RefreshCw, Save, Server } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { useExtensions } from '@/features/extensions/extension-provider';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { fetchImageProvidersList } from '@/features/settings/fetch-image-providers';
import {
  ImageProviderCredentialsPanel,
  type ImageProviderCredentialsPanelMessages,
} from '@/features/settings/image-provider-credentials-panel';
import { IMAGE_PROVIDERS_SWR_KEY } from '@/features/settings/image-providers-swr-key';
import { AgentDefaultsImageModelChainsSection } from '@/features/settings/agents/agent-defaults-panels/image-model-chains-section';
import {
  fetchAgentDefaults,
  parseParamsJsonForSave,
  patchAgentDefaults,
  type AgentDefaultsState,
} from '@/features/settings/config-api';
import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import { useImageProviderCredentials } from '@/features/settings/use-image-provider-credentials';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { apiUrl } from '@/lib/url';
import { cn } from '@/lib/cn';
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
    defaultModel: t.defaultModel,
    modelsLabel: t.modelsLabel,
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

export function ImageModelsSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.imageModelsSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [state, setState] = useState<AgentDefaultsState | null>(null);
  const [baseline, setBaseline] = useState<AgentDefaultsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const extensions = useExtensions();
  const extensionIds = useMemo(() => new Set(extensions.map((e) => e.id)), [extensions]);

  const reload = useCallback(async () => {
    if (!hasToken) return;
    setLoading(true);
    setError(undefined);
    try {
      const fresh = await fetchAgentDefaults();
      const snapshot = structuredClone(fresh);
      setState(snapshot);
      setBaseline(structuredClone(snapshot));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [hasToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const patchAgentDefaultsLocal = useCallback((patch: Partial<AgentDefaultsState>) => {
    setState((s) => (s ? { ...s, ...patch } : null));
  }, []);

  const { data: providers = [], mutate: refreshProviders } = useSWR(
    hasToken ? imageProvidersSwrKey() : null,
    fetchImageProvidersList,
    { revalidateOnFocus: false },
  );

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
    setSaving(true);
    setError(undefined);
    try {
      try {
        void parseParamsJsonForSave(state.paramsJson);
      } catch (e) {
        setError(
          e instanceof SyntaxError
            ? m.agentSettings.advanced.paramsInvalidJson
            : e instanceof Error
              ? e.message
              : m.agentSettings.advanced.paramsInvalidJson,
        );
        return;
      }
      await patchAgentDefaults(state);
      setBaseline(structuredClone(state));
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
      void gwSwr.mutate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [state, gwSwr, m.agentSettings]);

  const onDiscard = useCallback(() => {
    if (!baseline) return;
    setState(structuredClone(baseline));
    setError(undefined);
    setSavedFlash(false);
  }, [baseline]);

  const panelMsg = useMemo(() => panelMessagesFromBundle(t), [t]);
  const apiKeyLinkLabels = useMemo(
    () => ({
      getApiKey: m.providersSettings.getApiKey,
      getApiKeyIntl: m.providersSettings.getApiKeyIntl,
      getApiKeyCn: m.providersSettings.getApiKeyCn,
    }),
    [m.providersSettings],
  );

  if (!hasToken) {
    return (
      <div className="mx-auto w-full max-w-app-main px-4 py-8 text-sm text-fg-muted">
        {language === 'zh' ? '请先登录网关。' : 'Connect to a gateway to continue.'}
      </div>
    );
  }

  if (loading || !state) {
    return (
      <div className="mx-auto flex w-full max-w-app-main items-center gap-2 px-4 py-8 text-sm text-fg-muted">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-fg">{t.title}</h1>
          <p className="mt-1 text-sm text-fg-muted">{t.subtitle}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              void reload();
              void refreshProviders();
              void gwSwr.mutate?.();
            }}
          >
            <RefreshCw className="size-3.5" />
            <span className="ml-1.5">{t.refresh}</span>
          </Button>
          {savedFlash ? <span className="text-sm text-fg-muted">{t.saved}</span> : null}
          <Button type="button" variant="secondary" onClick={onDiscard} disabled={!dirty || saving}>
            {t.discard}
          </Button>
          <Button type="button" variant="primary" onClick={() => void onSave()} disabled={!dirty || saving}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            <span className="ml-1.5">{saving ? t.saving : t.save}</span>
          </Button>
        </div>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <AgentDefaultsImageModelChainsSection
        form={state}
        update={patchAgentDefaultsLocal}
        a={m.agentSettings}
        chat={m.chat}
      />

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={ImageIcon} title={t.title} subtitle={t.subtitle} />
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-edge-subtle bg-surface-base px-3 py-2.5 text-xs leading-relaxed text-fg-muted">
            {t.crossLinkHint}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-fg">{t.timeoutLabel}</label>
            <input
              type="number"
              min={0}
              step={1000}
              className={cn(inputClass(), 'max-w-[12rem]')}
              value={state.imageGenerationModelTimeoutMs ?? ''}
              placeholder="120000"
              onChange={(e) => {
                const raw = e.target.value.trim();
                const next = raw === '' ? null : Math.max(0, Math.floor(Number(raw)));
                setState((prev) =>
                  prev
                    ? {
                        ...prev,
                        imageGenerationModelTimeoutMs: next && next > 0 ? next : null,
                      }
                    : null,
                );
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
                setState((prev) =>
                  prev
                    ? { ...prev, imageGenerationModelAutoProviderFallback: e.target.checked }
                    : null,
                )
              }
              aria-label={t.autoFallbackLabel}
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-fg">{t.autoFallbackLabel}</span>
              <span className="text-xs text-fg-subtle">{t.autoFallbackHint}</span>
            </span>
          </label>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Server} title={t.providersTitle} subtitle="" />
        {providers.length === 0 ? (
          <p className="text-sm text-fg-muted">{t.providersEmpty}</p>
        ) : (
          <ImageProviderCredentialsPanel
            summaries={providers}
            credDraft={cred.credDraft}
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
            language={language}
            apiKeyLinkLabels={apiKeyLinkLabels}
            messages={panelMsg}
          />
        )}
      </SettingsFormSection>
    </div>
  );
}
