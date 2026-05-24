import { useMemo } from 'react';
import useSWR from 'swr';

import { CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached } from '@/features/chat/registry-api';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { getSkills } from '@/features/skills/skill-api';
import { messages } from '@/i18n/messages';
import { useGatewaySseStore } from '@/stores/gateway-sse-store';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { buildSetupStatusSnapshot, type SetupStatusSnapshot } from './setup-checklist-state';

export function useSetupChecklist(): {
  ready: boolean;
  error: boolean;
  snapshot: SetupStatusSnapshot | null;
  refresh: () => Promise<void>;
} {
  const token = useGatewayStore((s) => s.token);
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const l = m.setupStatus.labels;
  const sseConnected = useGatewaySseStore((s) => s.connectionState === 'connected');

  const {
    data: configData,
    error: configError,
    isLoading: configLoading,
    mutate: mutateConfig,
  } = useGatewayConfigSwr(Boolean(token));

  const {
    data: skillsData,
    error: skillsError,
    isLoading: skillsLoading,
    mutate: mutateSkills,
  } = useSWR(Boolean(token) ? ['setup-checklist-skills', language] : null, () => getSkills(language), {
    revalidateOnFocus: false,
  });

  // Warm models cache for other panels; not required for checklist itself.
  useSWR(Boolean(token) ? CONFIGURED_MODELS_SWR_KEY : null, fetchConfiguredModelsCached, {
    revalidateOnFocus: false,
  });

  const ready = !token || (!configLoading && !skillsLoading);
  const error = Boolean(configError || skillsError);

  const snapshot = useMemo(() => {
    if (!token || !ready) return null;
    const skillCount = skillsData?.catalog?.length ?? 0;
    return buildSetupStatusSnapshot({
      hasToken: Boolean(token),
      sseConnected,
      config: configData?.payload?.config,
      skillCount,
      labels: {
        gatewayOnline: l.gatewayOnline,
        gatewayOffline: l.gatewayOffline,
        providersConfigured: (count) => l.providersConfigured.replace('{{count}}', String(count)),
        providersMissing: l.providersMissing,
        modelConfigured: (model) => l.modelConfigured.replace('{{model}}', model),
        modelMissing: l.modelMissing,
        channelConfigured: l.channelConfigured,
        channelMissing: l.channelMissing,
        skillsConfigured: (count) => l.skillsConfigured.replace('{{count}}', String(count)),
        skillsMissing: l.skillsMissing,
      },
    });
  }, [token, ready, sseConnected, configData, skillsData, l]);

  const refresh = async () => {
    await Promise.all([mutateConfig(), mutateSkills()]);
  };

  return { ready, error, snapshot, refresh };
}
