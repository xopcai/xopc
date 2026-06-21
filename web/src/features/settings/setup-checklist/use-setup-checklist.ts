import { useMemo } from 'react';
import useSWR from 'swr';

import { CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached } from '@/features/chat/api/registry-api';
import { fetchGatewayAgents } from '@/features/settings/agents-admin-api';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { fetchProviderMetaList } from '@/features/settings/providers-api';
import { getSkills } from '@/features/skills/skill-list-api';
import { messages } from '@/i18n/messages';
import { useGatewaySseStore } from '@/stores/gateway-sse-store';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { buildSetupStatusSnapshot, type SetupStatusSnapshot } from './setup-checklist-state';

function computePresetsDone(agents: { id: string }[] | undefined): boolean {
  return Boolean(agents && agents.length > 1);
}

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
  } = useSWR(Boolean(token) ? 'setup-checklist-skills' : null, () => getSkills(), {
    revalidateOnFocus: false,
  });

  const {
    data: providerMeta,
    error: providerMetaError,
    isLoading: providerMetaLoading,
    mutate: mutateProviderMeta,
  } = useSWR(Boolean(token) ? 'setup-checklist-provider-meta' : null, fetchProviderMetaList, {
    revalidateOnFocus: false,
  });

  const {
    data: agentsData,
    error: agentsError,
    isLoading: agentsLoading,
    mutate: mutateAgents,
  } = useSWR(Boolean(token) ? 'setup-checklist-agents' : null, fetchGatewayAgents, {
    revalidateOnFocus: false,
  });

  // Warm models cache for other panels; not required for checklist itself.
  useSWR(Boolean(token) ? CONFIGURED_MODELS_SWR_KEY : null, fetchConfiguredModelsCached, {
    revalidateOnFocus: false,
  });

  const ready = !token || (!configLoading && !skillsLoading && !providerMetaLoading && !agentsLoading);
  const error = Boolean(configError || skillsError || providerMetaError || agentsError);

  const snapshot = useMemo(() => {
    if (!token || !ready) return null;
    const skillCount = skillsData?.catalog?.length ?? 0;
    const metaConfigured = providerMeta?.filter((p) => p.configured).length ?? 0;
    const metaTotal = providerMeta?.length ?? 0;
    const agentCount = agentsData?.agents.length ?? 0;
    const presetsDone = computePresetsDone(agentsData?.agents);

    return buildSetupStatusSnapshot({
      hasToken: Boolean(token),
      sseConnected,
      config: configData?.payload?.config,
      skillCount,
      providerMeta: metaTotal > 0 ? { configured: metaConfigured, total: metaTotal } : null,
      presetsDone,
      agentCount,
      labels: {
        gatewayOnline: l.gatewayOnline,
        gatewayOffline: l.gatewayOffline,
        providersConfigured: (count) => l.providersConfigured.replace('{{count}}', String(count)),
        providersMetaReady: (configured, total) =>
          l.providersMetaReady
            .replace('{{configured}}', String(configured))
            .replace('{{total}}', String(total)),
        providersMissing: l.providersMissing,
        modelConfigured: (model) => l.modelConfigured.replace('{{model}}', model),
        modelMissing: l.modelMissing,
        channelConfigured: l.channelConfigured,
        channelMissing: l.channelMissing,
        skillsConfigured: (count) => l.skillsConfigured.replace('{{count}}', String(count)),
        skillsMissing: l.skillsMissing,
        presetsConfigured: l.presetsConfigured.replace('{{count}}', String(agentCount)),
        presetsMissing: l.presetsMissing,
      },
    });
  }, [token, ready, sseConnected, configData, skillsData, providerMeta, agentsData, l]);

  const refresh = async () => {
    await Promise.all([mutateConfig(), mutateSkills(), mutateProviderMeta(), mutateAgents()]);
  };

  return { ready, error, snapshot, refresh };
}
