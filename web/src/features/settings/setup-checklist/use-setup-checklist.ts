import { useMemo } from 'react';
import useSWR from 'swr';

import { CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached } from '@/features/chat/api/registry-api';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { fetchProviderMetaList } from '@/features/settings/providers-api';
import { getSkills } from '@/features/skills/skill-list-api';
import { messages } from '@/i18n/messages';
import { useGatewayRealtimeStore } from '@/stores/gateway-realtime-store';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import {
  buildSetupStatusSnapshot,
  readOverviewBrowserDiagnosticsInput,
  type SetupStatusSnapshot,
} from './setup-checklist-state';
import {
  browserDiagnosticsSwrKey,
  fetchBrowserDiagnostics,
  fetchLogsHealth,
  fetchSetupDoctorChecks,
  logsHealthSwrKey,
  setupDoctorSwrKey,
} from './setup-diagnostics-api';

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
  const realtimeConnected = useGatewayRealtimeStore((s) => s.connectionState === 'connected');

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
    data: doctorChecks,
    error: doctorError,
    isLoading: doctorLoading,
    mutate: mutateDoctor,
  } = useSWR(Boolean(token) ? setupDoctorSwrKey() : null, fetchSetupDoctorChecks, {
    revalidateOnFocus: false,
  });

  const {
    data: logsHealth,
    isLoading: logsLoading,
    mutate: mutateLogs,
  } = useSWR(Boolean(token) ? logsHealthSwrKey() : null, fetchLogsHealth, {
    revalidateOnFocus: false,
  });

  const browserDiagnosticsInput = useMemo(
    () => readOverviewBrowserDiagnosticsInput(configData?.payload?.config),
    [configData?.payload?.config],
  );

  const {
    data: browserDiagnostics,
    isLoading: browserDiagnosticsLoading,
    mutate: mutateBrowserDiagnostics,
  } = useSWR(browserDiagnosticsSwrKey(Boolean(token) ? browserDiagnosticsInput : null), ([, input]) =>
    fetchBrowserDiagnostics(input),
  {
    revalidateOnFocus: false,
  });

  // Warm models cache for other panels; not required for checklist itself.
  useSWR(Boolean(token) ? CONFIGURED_MODELS_SWR_KEY : null, fetchConfiguredModelsCached, {
    revalidateOnFocus: false,
  });

  const ready = !token || (
    !configLoading &&
    !skillsLoading &&
    !providerMetaLoading &&
    !doctorLoading &&
    !logsLoading &&
    !browserDiagnosticsLoading
  );
  const error = Boolean(
    configError ||
    skillsError ||
    providerMetaError ||
    doctorError,
  );

  const snapshot = useMemo(() => {
    if (!token || !ready) return null;
    const skillCount = skillsData?.catalog?.length ?? 0;
    const metaConfigured = providerMeta?.filter((p) => p.configured).length ?? 0;
    const metaTotal = providerMeta?.length ?? 0;

    return buildSetupStatusSnapshot({
      hasToken: Boolean(token),
      realtimeConnected,
      config: configData?.payload?.config,
      skillCount,
      providerMeta: metaTotal > 0 ? { configured: metaConfigured, total: metaTotal } : null,
      doctorChecks,
      logsHealth,
      browserDiagnostics,
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
        readyToChat: m.setupStatus.requiredCompleteMessage,
      },
    });
  }, [token, ready, realtimeConnected, configData, skillsData, providerMeta, doctorChecks, logsHealth, browserDiagnostics, l, m.setupStatus.requiredCompleteMessage]);

  const refresh = async () => {
    await Promise.all([
      mutateConfig(),
      mutateSkills(),
      mutateProviderMeta(),
      mutateDoctor(),
      mutateLogs(),
      mutateBrowserDiagnostics(),
    ]);
  };

  return { ready, error, snapshot, refresh };
}
