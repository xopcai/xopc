import { useEffect } from 'react';
import { subscribeRealtimeTopic } from '@/features/gateway/gateway-realtime';
import type { ConversationOrigin } from '@xopcai/gateway-contract';
import { MessageSquareText } from 'lucide-react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useGatewayStore } from '@/stores/gateway-store';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export function ConversationOriginLabel({ origin, conversationId }: { origin: ConversationOrigin; conversationId: string }) {
  const language = useLocaleStore(state => state.language);
  const identity = useGatewayStore(state => state.conversationId);
  const labels = messages(language).chat.conversationLaunch;
  const { data, mutate } = useSWR(['conversation-origin', identity, conversationId, origin.launchId], () =>
    fetchJson<{ available: boolean; title?: string }>(apiUrl(`/api/sessions/${encodeURIComponent(conversationId)}/launch-origin?launchId=${encodeURIComponent(origin.launchId)}`)));
  useEffect(() => {
    const refresh = () => { void mutate(); };
    const stop = subscribeRealtimeTopic('sessions', {
      onEvent: event => {
        const data = event.data as { conversationId?: string } | null;
        if (data?.conversationId === origin.conversationId || data?.conversationId === conversationId) refresh();
      },
      onGap: refresh,
    });
    window.addEventListener('gateway-realtime-connected', refresh);
    return () => { stop(); window.removeEventListener('gateway-realtime-connected', refresh); };
  }, [origin.conversationId, conversationId, mutate]);
  const text = labels.origin.replace('{{agent}}', origin.agentId);
  return (
    <div className="mb-1 flex min-h-11 max-w-full items-center gap-1.5 text-xs text-fg-muted" data-conversation-origin>
      <MessageSquareText className="size-3.5 shrink-0" aria-hidden />
      {data?.available ? (
        <Link to={`/chat/${encodeURIComponent(origin.conversationId)}`} title={data.title ?? labels.openSource}
          className="inline-flex min-h-11 min-w-0 items-center rounded px-1 text-accent-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <span className="truncate">{text}</span>
        </Link>
      ) : <span title={labels.sourceUnavailable}>{text}</span>}
    </div>
  );
}
