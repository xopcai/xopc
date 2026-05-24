import useSWR from 'swr';

import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { fetchImageProvidersList } from '@/features/settings/fetch-image-providers';
import { fetchProviderMetaList } from '@/features/settings/providers-api';
import { normalizeVoiceSettings } from '@/features/settings/voice-config-api';
import { normalizeWebSearchSettingsFromConfig } from '@/features/settings/web-search-config-api';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import {
  buildCredentialsHubSnapshot,
  type CredentialDomainSummary,
} from './credentials-hub-state';

export function useCredentialsHub(): {
  ready: boolean;
  error: boolean;
  domains: CredentialDomainSummary[] | null;
  refresh: () => Promise<void>;
} {
  const token = useGatewayStore((s) => s.token);
  const hasToken = Boolean(token);
  const language = useLocaleStore((s) => s.language);
  const h = messages(language).credentialsHub.labels;

  const {
    data: configData,
    error: configError,
    isLoading: configLoading,
    mutate: mutateConfig,
  } = useGatewayConfigSwr(hasToken);

  const {
    data: providerMeta,
    error: metaError,
    isLoading: metaLoading,
    mutate: mutateMeta,
  } = useSWR(hasToken ? 'credentials-hub-provider-meta' : null, fetchProviderMetaList, {
    revalidateOnFocus: false,
  });

  const {
    data: imageProviders,
    error: imageError,
    isLoading: imageLoading,
    mutate: mutateImage,
  } = useSWR(hasToken ? 'credentials-hub-image-providers' : null, fetchImageProvidersList, {
    revalidateOnFocus: false,
  });

  const ready = !hasToken || (!configLoading && !metaLoading && !imageLoading);
  const error = Boolean(configError || metaError || imageError);

  const domains =
    !hasToken || !ready
      ? null
      : buildCredentialsHubSnapshot({
          providerMeta: providerMeta ?? [],
          webSearch:
            configData?.payload?.config !== undefined
              ? normalizeWebSearchSettingsFromConfig(configData.payload.config)
              : null,
          imageProviders: imageProviders ?? [],
          voice:
            configData?.payload?.config !== undefined
              ? normalizeVoiceSettings(configData.payload.config)
              : null,
          labels: {
            llmMetaReady: (configured, total) =>
              h.llmMetaReady
                .replace('{{configured}}', String(configured))
                .replace('{{total}}', String(total)),
            llmConfigured: (count) => h.llmConfigured.replace('{{count}}', String(count)),
            llmMissing: h.llmMissing,
            webSearchDisabled: h.webSearchDisabled,
            webSearchReady: (configured, total) =>
              h.webSearchReady
                .replace('{{configured}}', String(configured))
                .replace('{{total}}', String(total)),
            webSearchNoProviders: h.webSearchNoProviders,
            imageReady: (configured, total) =>
              h.imageReady
                .replace('{{configured}}', String(configured))
                .replace('{{total}}', String(total)),
            imageNoProviders: h.imageNoProviders,
            voiceDisabled: h.voiceDisabled,
            voiceReadyNoKeys: h.voiceReadyNoKeys,
            voiceKeysReady: (configured, total) =>
              h.voiceKeysReady
                .replace('{{configured}}', String(configured))
                .replace('{{total}}', String(total)),
            voiceMissing: h.voiceMissing,
          },
        });

  const refresh = async () => {
    await Promise.all([mutateConfig(), mutateMeta(), mutateImage()]);
  };

  return { ready, error, domains, refresh };
}
