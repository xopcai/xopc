import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

type UnreadSnapshot = { conversationId: string; transcriptId: string; lastSeq: number; unreadCount: number };
type Response = { ok: boolean; payload: UnreadSnapshot | null };

export function personalUnreadLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}

export function usePersonalUnread(viewedConversationId?: string | null, enabled = true) {
  const identity = useGatewayStore(state => state.conversationId);
  const { data, mutate } = useSWR(identity && enabled ? ['personal-agent-unread', identity] : null,
    () => fetchJson<Response>(apiUrl('/api/personal-agent/unread')),
    { refreshInterval: 30_000 });
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible' && document.hasFocus());

  useEffect(() => {
    if (!enabled || !identity) return;
    const refresh = () => { void mutate(); };
    const visibility = () => {
      const focused = document.visibilityState === 'visible' && document.hasFocus();
      setVisible(focused);
      if (focused) refresh();
    };
    const events = ['session-transcript-updated', 'session-task-result', 'agent-run-ended',
      'personal-unread-updated', 'gateway-realtime-connected', 'realtime-gap'];
    events.forEach(name => window.addEventListener(name, refresh));
    window.addEventListener('focus', visibility);
    window.addEventListener('blur', visibility);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      events.forEach(name => window.removeEventListener(name, refresh));
      window.removeEventListener('focus', visibility);
      window.removeEventListener('blur', visibility);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [mutate, enabled, identity]);

  const snapshot = data?.payload;
  useEffect(() => {
    if (!visible || !snapshot?.unreadCount || snapshot.conversationId !== viewedConversationId) return;
    let active = true;
    void apiFetch('/api/personal-agent/read', { method: 'POST',
      body: JSON.stringify({ transcriptId: snapshot.transcriptId, lastSeq: snapshot.lastSeq }),
    }).then(async response => {
      if (!response.ok) return;
      const result = await response.json() as Response;
      if (active) await mutate(result, { revalidate: false });
    }).catch(() => { /* Keep unread messages until acknowledgement succeeds. */ });
    return () => { active = false; };
  }, [visible, viewedConversationId, snapshot, mutate]);

  return snapshot?.unreadCount ?? 0;
}
