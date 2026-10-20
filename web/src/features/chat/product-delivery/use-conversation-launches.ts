import { useEffect } from 'react';
import useSWR from 'swr';
import type { ConversationLaunchView } from '@xopcai/gateway-contract';

import { subscribeRealtimeTopic } from '@/features/gateway/gateway-realtime';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

/** One snapshot per visible result group, shared by all session cards in that group. */
export function useConversationLaunches(sourceId: string | null | undefined, targetIds: string[]) {
  const identity = useGatewayStore(state => state.conversationId);
  const ids = [...new Set(targetIds)].sort().join(',');
  const query = useSWR(sourceId && ids ? ['conversation-launches', identity, sourceId, ids] : null,
    () => fetchJson<{ items: ConversationLaunchView[] }>(apiUrl(`/api/sessions/${encodeURIComponent(sourceId!)}/launched-conversations?ids=${encodeURIComponent(ids)}`)), {
      revalidateOnFocus: true,
      refreshInterval: data => data?.items.some(item => ['preparing', 'queued', 'running'].includes(item.status)) ? 5000 : 0,
    });
  const { mutate } = query;
  useEffect(() => {
    if (!sourceId || !ids) return;
    const refresh = () => { void mutate(); };
    const targets = new Set(ids.split(','));
    const stop = subscribeRealtimeTopic('sessions', {
      onEvent: event => {
        const data = event.data as { conversationId?: string; key?: string } | null;
        if (data && targets.has(data.conversationId ?? data.key ?? '')) refresh();
      },
      onGap: refresh,
    });
    window.addEventListener('gateway-realtime-connected', refresh);
    return () => { stop(); window.removeEventListener('gateway-realtime-connected', refresh); };
  }, [sourceId, ids, mutate]);
  return query;
}
