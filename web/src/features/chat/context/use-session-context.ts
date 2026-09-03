import type { SessionContextSummary } from '@xopcai/gateway-contract';
import { useEffect } from 'react';
import useSWR from 'swr';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

export function useSessionContext(sessionKey: string | null, open: boolean) {
  const token = useGatewayStore((state) => state.token);
  const baseUrl = useGatewayStore((state) => state.baseUrl);
  const result = useSWR(
    sessionKey ? ['session-context', baseUrl, token, sessionKey] : null,
    async () => (await fetchJson<{ summary: SessionContextSummary }>(
      apiUrl(`/api/sessions/${encodeURIComponent(sessionKey!)}/context-summary`),
    )).summary,
    { keepPreviousData: false, revalidateOnFocus: open, revalidateOnReconnect: open, shouldRetryOnError: false },
  );
  const { mutate } = result;
  useEffect(() => {
    if (!open || !sessionKey) return;
    void mutate();
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void mutate(); }, 150);
    };
    const events = ['session-updated', 'run-completed', 'agent-run-ended', 'note-updated', 'task-changed-v2', 'gateway-realtime-connected'];
    for (const event of events) window.addEventListener(event, refresh);
    return () => {
      window.clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, refresh);
    };
  }, [open, sessionKey, mutate]);
  return result;
}
