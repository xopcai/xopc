import { MobilePrivacyDisclosureSchema, type MobilePrivacyDisclosure } from '@xopcai/gateway-contract';
import { AppState, DeviceEventEmitter } from 'react-native';
import { create } from 'zustand';

import { apiFetch } from '../../api/client';
import { messages } from '../../i18n/messages';
import { queryClient } from '../../query/query-client';
import { useGatewayStore } from '../../stores/gateway-store';
import { usePreferencesStore } from '../../stores/preferences-store';
import { consentDecisionStorage } from './consent-storage';
import {
  createConsentController,
  type ConsentDecision,
  DataSharingConsentError,
  requiresDataSharingConsent,
  waitForConsentDecision,
} from './consent-controller';

type ConsentPrompt = {
  gatewayId: string;
  disclosure: MobilePrivacyDisclosure;
  finish: (decision: ConsentDecision) => void;
};

export const useDataSharingPrompt = create<{ prompt: ConsentPrompt | null }>(() => ({ prompt: null }));

function copy() {
  return messages(usePreferencesStore.getState().language).privacy;
}

export const dataSharingConsent = createConsentController({
  activeGatewayId: () => useGatewayStore.getState().activeGatewayId,
  read: (key) => consentDecisionStorage.getString(key),
  write: (key, value) => consentDecisionStorage.set(key, value),
  errorMessage: () => copy().consentRequired,
  loadDisclosure: (gatewayId) => queryClient.fetchQuery({
    queryKey: ['mobile-privacy', gatewayId],
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const response = await apiFetch('/api/mobile/privacy');
      if (!response.ok) {
        throw new DataSharingConsentError(copy().disclosureUnavailable, 'disclosure-unavailable');
      }
      const json = await response.json() as { payload?: unknown };
      const parsed = MobilePrivacyDisclosureSchema.safeParse(json.payload);
      if (!parsed.success) {
        throw new DataSharingConsentError(copy().disclosureUnavailable, 'disclosure-unavailable');
      }
      return parsed.data;
    },
  }),
  confirm: (disclosure, gatewayId) => {
    if (AppState.currentState !== 'active') return Promise.reject(new DataSharingConsentError(copy().consentRequired));
    useDataSharingPrompt.getState().prompt?.finish('cancelled');
    return new Promise<ConsentDecision>((resolve) => {
      const prompt: ConsentPrompt = {
        gatewayId,
        disclosure,
        finish: (decision) => {
          if (useDataSharingPrompt.getState().prompt !== prompt) return;
          useDataSharingPrompt.setState({ prompt: null });
          resolve(decision);
        },
      };
      useDataSharingPrompt.setState({ prompt });
    });
  },
});

export async function authorizeMobileRequest(path: string, method: string, signal?: AbortSignal | null): Promise<void> {
  if (!requiresDataSharingConsent(path, method)) return;
  await waitForConsentDecision(
    () => dataSharingConsent.ensure(),
    signal,
    () => copy().consentRequired,
  );
}

export function revokeDataSharingConsent(): void {
  const gatewayId = useGatewayStore.getState().activeGatewayId;
  if (!gatewayId) return;
  dataSharingConsent.revoke(gatewayId);
  DeviceEventEmitter.emit('voice-consent-revoked');
  useDataSharingPrompt.getState().prompt?.finish('cancelled');
}

/** Opens the global disclosure dialog even when the current revision was already approved. */
export async function reviewDataSharingConsent(): Promise<void> {
  await dataSharingConsent.ensure(true);
}
