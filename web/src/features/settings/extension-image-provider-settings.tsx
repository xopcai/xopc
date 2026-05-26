import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import useSWR from 'swr';

import { fetchImageProvidersList } from '@/features/settings/fetch-image-providers';
import {
  ImageProviderCredentialsPanel,
  type ImageProviderCredentialsPanelMessages,
} from '@/features/settings/image-provider-credentials-panel';
import { IMAGE_PROVIDERS_SWR_KEY } from '@/features/settings/image-providers-swr-key';
import { useImageProviderCredentials } from '@/features/settings/use-image-provider-credentials';
import { apiUrl } from '@/lib/url';
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

export function ExtensionImageProviderSettings({ extensionId }: { extensionId: string }) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.imageModelsSettings;
  const hasToken = useGatewayStore((s) => Boolean(s.token));

  const { data: all = [], isLoading } = useSWR(
    hasToken ? imageProvidersSwrKey() : null,
    fetchImageProvidersList,
    { revalidateOnFocus: false },
  );

  const summaries = useMemo(
    () => all.filter((p) => p.id === extensionId),
    [all, extensionId],
  );

  const cred = useImageProviderCredentials(summaries);
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
    return null;
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-fg-muted">
        <Loader2 className="size-4 animate-spin" />
        …
      </div>
    );
  }

  if (summaries.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        {language === 'zh'
          ? '网关未注册该图像 Provider，或扩展已被禁用。'
          : 'This image provider is not registered on the gateway, or the extension is disabled.'}
      </p>
    );
  }

  return (
    <ImageProviderCredentialsPanel
      summaries={summaries}
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
      extensionIds={new Set()}
      showExtensionLinks={false}
      showImageModelsLink={false}
      language={language}
      apiKeyLinkLabels={apiKeyLinkLabels}
      messages={panelMsg}
    />
  );
}
