import { MobilePrivacyDisclosureSchema, type MobilePrivacyDisclosure } from '@xopcai/gateway-contract';
import { AppState, DeviceEventEmitter } from 'react-native';
import { create } from 'zustand';

import { apiFetch } from '../../api/client';
import { messages } from '../../i18n/messages';
import { queryClient } from '../../query/query-client';
import { storage } from '../../storage/mmkv';
import { useGatewayStore } from '../../stores/gateway-store';
import { usePreferencesStore } from '../../stores/preferences-store';
import { createConsentController, DataSharingConsentError, requiresDataSharingConsent } from './consent-controller';

type ConsentPrompt = {
  gatewayId: string;
  disclosure: MobilePrivacyDisclosure;
  finish: (accepted: boolean) => void;
};

export const useDataSharingPrompt = create<{ prompt: ConsentPrompt | null }>(() => ({ prompt: null }));

function copy() {
  return messages(usePreferencesStore.getState().language).privacy;
}

export const dataSharingConsent = createConsentController({
  activeGatewayId: () => useGatewayStore.getState().activeGatewayId,
  read: (key) => storage.getString(key),
  write: (key, value) => storage.set(key, value),
  errorMessage: () => copy().consentRequired,
  loadDisclosure: (gatewayId) => queryClient.fetchQuery({
    queryKey: ['mobile-privacy', gatewayId],
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const response = await apiFetch('/api/mobile/privacy');
      if (!response.ok) throw new DataSharingConsentError(copy().disclosureUnavailable);
      const json = await response.json() as { payload?: unknown };
      const parsed = MobilePrivacyDisclosureSchema.safeParse(json.payload);
      if (!parsed.success) throw new DataSharingConsentError(copy().disclosureUnavailable);
      return parsed.data;
    },
  }),
  confirm: (disclosure, gatewayId) => {
    if (AppState.currentState !== 'active') return Promise.reject(new DataSharingConsentError(copy().consentRequired));
    useDataSharingPrompt.getState().prompt?.finish(false);
    return new Promise<boolean>((resolve) => {
      const prompt: ConsentPrompt = {
        gatewayId,
        disclosure,
        finish: (accepted) => {
          if (useDataSharingPrompt.getState().prompt !== prompt) return;
          useDataSharingPrompt.setState({ prompt: null });
          resolve(accepted);
        },
      };
      useDataSharingPrompt.setState({ prompt });
    });
  },
});

export async function authorizeMobileRequest(path: string, method: string, signal?: AbortSignal | null): Promise<void> {
  if (!requiresDataSharingConsent(path, method)) return;
  if (signal?.aborted) throw new DataSharingConsentError(copy().consentRequired);
  const onAbort = () => useDataSharingPrompt.getState().prompt?.finish(false);
  signal?.addEventListener('abort', onAbort, { once: true });
  try { await dataSharingConsent.ensure(false, signal ?? undefined); }
  finally { signal?.removeEventListener('abort', onAbort); }
  if (signal?.aborted) throw new DataSharingConsentError(copy().consentRequired);
}

export function revokeDataSharingConsent(): void {
  const gatewayId = useGatewayStore.getState().activeGatewayId;
  if (!gatewayId) return;
  dataSharingConsent.revoke(gatewayId);
  DeviceEventEmitter.emit('voice-consent-revoked');
  useDataSharingPrompt.getState().prompt?.finish(false);
}
