import { useEffect } from 'react';

import type { ChannelStatus } from '@/features/settings/channel-recipient-api';

export const CHANNEL_STATUS_REALTIME_EVENT = 'channels-status';

export type ChannelStatusRealtimePayload = {
  channels?: ChannelStatus[];
};

export function parseChannelStatusRealtimeDetail(detail: unknown): ChannelStatus[] | null {
  if (!detail || typeof detail !== 'object') return null;
  const channels = (detail as ChannelStatusRealtimePayload).channels;
  return Array.isArray(channels) ? channels : null;
}

export function subscribeChannelStatusRealtime(onEvent: (detail: unknown) => void): () => void {
  const handler = (event: Event) => onEvent((event as CustomEvent).detail);
  window.addEventListener(CHANNEL_STATUS_REALTIME_EVENT, handler);
  return () => window.removeEventListener(CHANNEL_STATUS_REALTIME_EVENT, handler);
}

export function useChannelStatusRealtime(onEvent: (detail: unknown) => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    return subscribeChannelStatusRealtime(onEvent);
  }, [enabled, onEvent]);
}
