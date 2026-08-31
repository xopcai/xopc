import {
  RealtimeClient,
  type RealtimeConnectionState,
  type RealtimeEndpointBinding,
  type RealtimeWebSocket,
} from '@xopcai/realtime-client';
import type { ClientEndpointMessage } from '@xopcai/endpoint-tools-protocol';
import type { RealtimeEventPayload } from '@xopcai/realtime-protocol';

import { dispatchGatewayRealtimeEvent } from '@/features/gateway/dispatch-realtime-event';
import { apiUrl } from '@/lib/url';
import { setRealtimeConnectionState } from '@/stores/gateway-realtime-store';

type TopicListener = {
  onEvent: (event: RealtimeEventPayload) => void;
  onGap?: (gap: { topic: string; requestedSeq: number; earliestSeq: number; recoverable: boolean }) => void | Promise<void>;
};

type TopicListenerRegistration = {
  listener: TopicListener;
  cursor?: number;
};

const listeners = new Map<string, Set<TopicListenerRegistration>>();
const topicCursors = new Map<string, number | undefined>();
let activeClient: RealtimeClient | undefined;
let endpointBinding: RealtimeEndpointBinding | undefined;

function resolveClientId(): string {
  const key = 'xopc:realtime-client-id';
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(key, created);
  return created;
}

function websocketUrl(): string {
  const url = new URL(apiUrl('/api/realtime/v1/ws'));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function startGatewayRealtime(token?: string): () => void {
  const id = resolveClientId();
  const kind = window.electronAPI ? 'desktop' as const : 'web' as const;
  const client = new RealtimeClient({
    clientId: id,
    clientKind: kind,
    getWebSocketUrl: websocketUrl,
    issueTicket: async (signal) => {
      const response = await fetch(apiUrl('/api/realtime/tickets'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ clientId: id, clientKind: kind }),
        signal,
      });
      const body = await response.json().catch(() => null) as { payload?: { ticket?: string }; error?: { message?: string } } | null;
      if (!response.ok || !body?.payload?.ticket) {
        throw new Error(body?.error?.message ?? `Realtime ticket failed (${response.status})`);
      }
      return body.payload.ticket;
    },
    createWebSocket: (url) => new WebSocket(url) as unknown as RealtimeWebSocket,
    onStateChange: (state: RealtimeConnectionState, error?: string) => {
      setRealtimeConnectionState({ connectionState: state, error: error ?? null });
      if (state === 'connected') window.dispatchEvent(new CustomEvent('gateway-realtime-connected'));
    },
    onEvent: (event) => {
      if (event.topic === 'gateway' || event.topic === 'sessions') {
        dispatchGatewayRealtimeEvent(event.event, event.data);
      }
      const previousTopicCursor = topicCursors.get(event.topic);
      if (previousTopicCursor === undefined || event.seq > previousTopicCursor) {
        topicCursors.set(event.topic, event.seq);
      }
      for (const registration of listeners.get(event.topic) ?? []) {
        if (registration.cursor !== undefined && event.seq <= registration.cursor) continue;
        try {
          registration.listener.onEvent(event);
        } catch (error) {
          console.error('[realtime] topic listener failed:', error);
        } finally {
          registration.cursor = Math.max(registration.cursor ?? 0, event.seq);
        }
      }
    },
    onGap: async (gap) => {
      window.dispatchEvent(new CustomEvent('realtime-gap', { detail: gap }));
      const affected = [...listeners.get(gap.topic) ?? []].filter(
        (registration) =>
          !gap.recoverable
          || registration.cursor === undefined
          || registration.cursor < gap.earliestSeq - 1,
      );
      const results = await Promise.allSettled(
        affected.map((registration) => registration.listener.onGap?.(gap)),
      );
      for (const result of results) {
        if (result.status === 'rejected') {
          console.error('[realtime] topic gap handler failed:', result.reason);
        }
      }
    },
  });
  activeClient?.disconnect();
  activeClient = client;
  if (endpointBinding) client.setEndpoint(endpointBinding);
  client.subscribe('gateway', topicCursors.get('gateway'));
  client.subscribe('sessions', topicCursors.get('sessions'));
  for (const topic of listeners.keys()) client.subscribe(topic, topicCursors.get(topic));
  setRealtimeConnectionState({ connectionState: 'connecting', error: null });
  client.connect();
  return () => {
    if (activeClient !== client) return;
    client.disconnect();
    activeClient = undefined;
  };
}

export function attachGatewayRealtimeEndpoint(binding: RealtimeEndpointBinding): () => void {
  endpointBinding = binding;
  activeClient?.setEndpoint(binding);
  return () => {
    if (endpointBinding !== binding) return;
    endpointBinding = undefined;
    activeClient?.clearEndpoint(binding);
  };
}

export function sendGatewayEndpointMessage(message: ClientEndpointMessage): void {
  activeClient?.sendEndpointMessage(message);
}

export function stopGatewayRealtime(): void {
  activeClient?.disconnect();
  activeClient = undefined;
  setRealtimeConnectionState({ connectionState: 'disconnected', error: null });
}

export function reconnectGatewayRealtime(): void {
  activeClient?.reconnect();
}

export function subscribeRealtimeTopic(topic: string, listener: TopicListener, afterSeq?: number): () => void {
  const topicListeners = listeners.get(topic) ?? new Set<TopicListenerRegistration>();
  const wasEmpty = topicListeners.size === 0;
  const currentTopicCursor = topicCursors.get(topic);
  const registration: TopicListenerRegistration = {
    listener,
    cursor: afterSeq ?? currentTopicCursor,
  };
  topicListeners.add(registration);
  listeners.set(topic, topicListeners);
  if (wasEmpty) {
    const requestedCursor = afterSeq ?? currentTopicCursor;
    topicCursors.set(topic, requestedCursor);
    activeClient?.subscribe(topic, requestedCursor);
  } else if (
    afterSeq !== undefined
    && (currentTopicCursor === undefined || afterSeq < currentTopicCursor)
  ) {
    // A second consumer may join after another listener already replayed the topic.
    // Rewind the shared transport; per-listener cursors suppress duplicates for incumbents.
    activeClient?.subscribe(topic, afterSeq);
  }
  return () => {
    const current = listeners.get(topic);
    current?.delete(registration);
    if (!current || current.size === 0) {
      listeners.delete(topic);
      topicCursors.delete(topic);
      activeClient?.unsubscribe(topic);
    }
  };
}
