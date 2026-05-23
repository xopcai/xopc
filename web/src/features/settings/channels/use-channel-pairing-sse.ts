import { useEffect } from 'react';

const PAIRING_SSE_EVENTS = [
  'channels-pairing-requested',
  'channels-pairing-approved',
  'channels-pairing-revoked',
] as const;

/** Revalidate pairing SWR keys when gateway broadcasts pairing SSE events. */
export function useChannelPairingSseRefresh(onRefresh: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = () => onRefresh();
    for (const name of PAIRING_SSE_EVENTS) {
      window.addEventListener(name, handler);
    }
    return () => {
      for (const name of PAIRING_SSE_EVENTS) {
        window.removeEventListener(name, handler);
      }
    };
  }, [enabled, onRefresh]);
}

export const CHANNEL_PAIRING_SUMMARY_SWR_KEY = 'channel-pairing-summary';
