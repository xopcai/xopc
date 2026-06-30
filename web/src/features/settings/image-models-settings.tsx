import { Loader2, Save, Server } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer } from 'react';

import { uiPatchReducer } from '@/lib/settings-form-draft';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { useExtensions } from '@/features/extensions/extension-provider';
import { useSaveBarRegistration } from '@/features/settings/save-bar/use-save-bar-registration';
import { SettingsCollapsibleSection } from '@/features/settings/settings-collapsible-section';
import { fetchImageProvidersList } from '@/features/settings/fetch-image-providers';
import {
  ImageProviderCredentialsPanel,
  type ImageProviderCredentialsPanelMessages,
} from '@/features/settings/image-provider-credentials-panel';
import { IMAGE_PROVIDERS_SWR_KEY } from '@/features/settings/image-providers-swr-key';
import { useImageProviderCredentials } from '@/features/settings/use-image-provider-credentials';
import { apiUrl } from '@/lib/url';
import { showToast } from '@/lib/toast';
import { messages, type MessageBundle } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const imageProvidersSwrKey = () => apiUrl(IMAGE_PROVIDERS_SWR_KEY);

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

/** See `WebSearchSettingsPanel` for the embedded-mode contract. */
export function ImageModelsSettingsPanel({ embedded = false }: { embedded?: boolean } = {}) {
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

  // Drives the default-open state of the credentials collapsible below —
  // expand if the user already has at least one image provider with a key,
  // otherwise stay collapsed to keep the page short for new users.
  const hasConfiguredProvider = providers.some((p) => p.configured);

  const cred = useImageProviderCredentials(providers);

  const anyDirty = cred.credDirty;

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
      if (cred.credDirty) {
        await cred.saveCredentials(t.credentialsSaveError);
      }
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
  }, [cred, t.credentialsSaveError, t.saved]);

  const onDiscard = useCallback(() => {
    if (cred.credDirty) cred.onDiscardCredentials();
    dispatchUi({ type: 'patch', patch: { error: undefined, savedFlash: false } });
  }, [cred]);

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

  if (providersLoading) {
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
