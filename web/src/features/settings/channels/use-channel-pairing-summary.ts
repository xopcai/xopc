import useSWR from 'swr';
import { useCallback } from 'react';

import {
  fetchChannelPairingSummary,
  type ChannelPairingSummaryPayload,
} from '@/features/settings/channels-config-api';

import {
  CHANNEL_PAIRING_SUMMARY_SWR_KEY,
  useChannelPairingSseRefresh,
} from './use-channel-pairing-sse';

const EMPTY_SUMMARY: ChannelPairingSummaryPayload = {
  telegram: { pending: 0, stale: 0, atCapacity: false },
  feishu: { pending: 0, stale: 0, atCapacity: false },
  weixin: { pending: 0, stale: 0, atCapacity: false },
};

export function useChannelPairingSummary(enabled: boolean) {
  const { data, mutate, isLoading, error } = useSWR(
    enabled ? CHANNEL_PAIRING_SUMMARY_SWR_KEY : null,
    fetchChannelPairingSummary,
    { revalidateOnFocus: true },
  );

  const refresh = useCallback(() => {
    void mutate();
  }, [mutate]);

  useChannelPairingSseRefresh(refresh, enabled);

  return {
    summary: data ?? EMPTY_SUMMARY,
    isLoading,
    error,
    refresh,
  };
}
