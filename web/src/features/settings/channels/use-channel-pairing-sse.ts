import { useEffect } from 'react';

export const CHANNEL_PAIRING_SSE_EVENTS = [
  'channels-pairing-requested',
  'channels-pairing-refreshed',
  'channels-pairing-approved',
  'channels-pairing-revoked',
  'channels-pairing-dismissed',
] as const;

export const CHANNEL_PAIRING_SUMMARY_SWR_KEY = 'channel-pairing-summary';

/** Subscribe to gateway pairing SSE window events; returns unsubscribe. */
export function subscribeChannelPairingSse(onRefresh: () => void): () => void {
  const handler = () => onRefresh();
  for (const name of CHANNEL_PAIRING_SSE_EVENTS) {
    window.addEventListener(name, handler);
  }
  return () => {
    for (const name of CHANNEL_PAIRING_SSE_EVENTS) {
      window.removeEventListener(name, handler);
    }
  };
}

/** Revalidate pairing SWR keys when gateway broadcasts pairing SSE events. */
export function useChannelPairingSseRefresh(onRefresh: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    return subscribeChannelPairingSse(onRefresh);
  }, [enabled, onRefresh]);
}
