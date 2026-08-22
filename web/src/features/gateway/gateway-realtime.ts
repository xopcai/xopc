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

const listeners = new Map<string, Set<TopicListener>>();
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
      for (const listener of listeners.get(event.topic) ?? []) listener.onEvent(event);
    },
    onGap: async (gap) => {
      window.dispatchEvent(new CustomEvent('realtime-gap', { detail: gap }));
      await Promise.all([...listeners.get(gap.topic) ?? []].map((listener) => listener.onGap?.(gap)));
    },
  });
  activeClient?.disconnect();
  activeClient = client;
  if (endpointBinding) client.setEndpoint(endpointBinding);
  client.subscribe('gateway');
  client.subscribe('sessions');
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
  const topicListeners = listeners.get(topic) ?? new Set<TopicListener>();
  const wasEmpty = topicListeners.size === 0;
  topicListeners.add(listener);
  listeners.set(topic, topicListeners);
  if (wasEmpty) {
    topicCursors.set(topic, afterSeq);
    activeClient?.subscribe(topic, afterSeq);
  }
  return () => {
    const current = listeners.get(topic);
    current?.delete(listener);
    if (!current || current.size === 0) {
      listeners.delete(topic);
      topicCursors.delete(topic);
      activeClient?.unsubscribe(topic);
    }
  };
}
