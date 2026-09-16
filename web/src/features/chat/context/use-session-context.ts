import type { SessionContextSummary } from '@xopcai/gateway-contract';
import { useEffect } from 'react';
import useSWR from 'swr';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

export function useSessionContext(conversationId: string | null, open: boolean) {
  const token = useGatewayStore((state) => state.conversationId);
  const baseUrl = useGatewayStore((state) => state.baseUrl);
  const result = useSWR(
    conversationId ? ['session-context', baseUrl, token, conversationId] : null,
    async () => (await fetchJson<{ summary: SessionContextSummary }>(
      apiUrl(`/api/sessions/${encodeURIComponent(conversationId!)}/context-summary`),
    )).summary,
    { keepPreviousData: false, revalidateOnFocus: open, revalidateOnReconnect: open, shouldRetryOnError: false },
  );
  const { mutate } = result;
  useEffect(() => {
    if (!open || !conversationId) return;
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
  }, [open, conversationId, mutate]);
  return result;
}
