import { useEffect } from 'react';

import type { ChannelStatus } from '@/features/settings/channel-recipient-api';

export const CHANNEL_STATUS_SSE_EVENT = 'channels-status';

export type ChannelStatusSsePayload = {
  channels?: ChannelStatus[];
};

export function parseChannelStatusSseDetail(detail: unknown): ChannelStatus[] | null {
  if (!detail || typeof detail !== 'object') return null;
  const channels = (detail as ChannelStatusSsePayload).channels;
  if (!Array.isArray(channels)) return null;
  return channels;
}

/** Subscribe to gateway `channels.status` SSE (dispatched as `channels-status` on window). */
export function subscribeChannelStatusSse(onEvent: (detail: unknown) => void): () => void {
  const handler = (e: Event) => onEvent((e as CustomEvent).detail);
  window.addEventListener(CHANNEL_STATUS_SSE_EVENT, handler);
  return () => window.removeEventListener(CHANNEL_STATUS_SSE_EVENT, handler);
}

export function useChannelStatusSse(onEvent: (detail: unknown) => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    return subscribeChannelStatusSse(onEvent);
  }, [enabled, onEvent]);
}
