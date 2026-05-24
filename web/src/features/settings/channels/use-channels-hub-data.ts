import useSWR from 'swr';
import { useCallback, useMemo } from 'react';

import type { ChannelsSettingsState } from '@/features/settings/channels-config-api';
import { channelsStatusSwrKey, fetchChannelsStatusSwr } from '@/features/settings/channels-status-swr';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import type { ChannelsSettingsMessages } from '@/i18n/messages';

import {
  buildChannelHubCardsForCatalog,
  type ChannelHubCardVm,
} from './channel-hub-view-model';
import { parseChannelStatusSseDetail, useChannelStatusSse } from './use-channel-status-sse';
import { useChannelPairingSummary } from './use-channel-pairing-summary';
import { useChannelCatalog } from './use-channel-catalog';

const STATUS_POLL_MS = 30_000;

export function useChannelsHubData(params: {
  hasToken: boolean;
  form: ChannelsSettingsState | null;
  ch: ChannelsSettingsMessages;
}): {
  cards: ChannelHubCardVm[];
  refreshAll: () => void;
} {
  const { hasToken, form, ch } = params;

  const { data: cfgData, mutate: mutateConfig } = useGatewayConfigSwr(hasToken);
  const { entries: catalogEntries, mutate: mutateCatalog } = useChannelCatalog(hasToken, ch);

  const { data: statuses = [], mutate: mutateStatus } = useSWR(
    hasToken ? channelsStatusSwrKey() : null,
    fetchChannelsStatusSwr,
    { revalidateOnFocus: true, refreshInterval: STATUS_POLL_MS },
  );

  const applyStatusFromSse = useCallback(
    (detail: unknown) => {
      const next = parseChannelStatusSseDetail(detail);
      if (next) {
        void mutateStatus(next, { revalidate: false });
        return;
      }
      void mutateStatus();
    },
    [mutateStatus],
  );

  useChannelStatusSse(applyStatusFromSse, hasToken);

  const { summary: pairingSummary, refresh: refreshPairing } = useChannelPairingSummary(hasToken);

  const catalogIds = useMemo(() => catalogEntries.map((e) => e.id), [catalogEntries]);
  const configRoot = cfgData?.payload?.config;

  const cards = useMemo(() => {
    if (!form || catalogIds.length === 0) return [];
    return buildChannelHubCardsForCatalog({
      catalogIds,
      form,
      config: configRoot,
      statuses,
      pairingSummary,
      ch,
    });
  }, [form, catalogIds, configRoot, statuses, pairingSummary, ch]);

  const refreshAll = useCallback(() => {
    void mutateStatus();
    void mutateCatalog();
    void mutateConfig();
    refreshPairing();
  }, [mutateCatalog, mutateConfig, mutateStatus, refreshPairing]);

  return { cards, refreshAll };
}
