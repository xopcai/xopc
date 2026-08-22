import { useEffect } from 'react';
import { randomUUID } from 'expo-crypto';
import { AppState } from 'react-native';

import {
  RealtimeClient,
  type RealtimeEndpointBinding,
  type RealtimeWebSocket,
} from '@xopcai/realtime-client';
import type { ClientEndpointMessage } from '@xopcai/endpoint-tools-protocol';
import type { RealtimeEventPayload } from '@xopcai/realtime-protocol';

import { useGatewayConfigured } from '../../query/sessions';
import { queryClient } from '../../query/query-client';
import { useGatewayStore } from '../../stores/gateway-store';
import { resolveEffectiveGatewayBaseUrl } from '../../stores/gateway-types';

import { recordConnectionEvent } from './connection-log';
import { emitGatewayEvent } from './gateway-event-bus';
import { runProbeRound } from './probe-coordinator';

type TopicListener = {
  onEvent: (event: RealtimeEventPayload) => void;
  onGap?: (gap: { topic: string; requestedSeq: number; earliestSeq: number; recoverable: boolean }) => void | Promise<void>;
};

const topicListeners = new Map<string, Set<TopicListener>>();
const topicCursors = new Map<string, number | undefined>();
let sharedClient: RealtimeClient | null = null;
let sharedConnectionKey = '';
let subscriberCount = 0;
let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectFailures = 0;
let endpointBinding: RealtimeEndpointBinding | undefined;

function websocketUrl(): string {
  const url = new URL(useGatewayStore.getState().apiUrl('/api/realtime/v1/ws'));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function createClient(clientId: string): RealtimeClient {
  return new RealtimeClient({
    clientId,
    clientKind: 'mobile',
    createMessageId: randomUUID,
    getWebSocketUrl: websocketUrl,
    issueTicket: async (signal) => {
      const { apiUrl, token } = useGatewayStore.getState();
      const response = await fetch(apiUrl('/api/realtime/tickets'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ clientId, clientKind: 'mobile' }),
        signal,
      });
      const body = await response.json().catch(() => null) as { payload?: { ticket?: string }; error?: { message?: string } } | null;
      if (!response.ok || !body?.payload?.ticket) {
        throw new Error(body?.error?.message ?? `Realtime ticket failed (${response.status})`);
      }
      return body.payload.ticket;
    },
    createWebSocket: (url) => new WebSocket(url) as unknown as RealtimeWebSocket,
    onStateChange: (state, error) => {
      if (state === 'connected') {
        reconnectFailures = 0;
        recordConnectionEvent({ kind: 'realtime', ok: true, message: 'realtime connected' });
        emitGatewayEvent('gateway.realtime-connected', undefined);
      } else if (state === 'reconnecting') {
        reconnectFailures += 1;
        if (reconnectFailures === 3) void runProbeRound('realtime-degraded', { force: true });
      } else if (state === 'error') {
        recordConnectionEvent({ kind: 'realtime', ok: false, message: error ?? 'realtime failed' });
      }
    },
    onEvent: (event) => {
      if (event.topic === 'gateway' || event.topic === 'sessions') emitGatewayEvent(event.event, event.data);
      for (const listener of topicListeners.get(event.topic) ?? []) listener.onEvent(event);
    },
    onGap: async (gap) => {
      emitGatewayEvent('realtime.gap', gap);
      if (gap.topic === 'gateway' || gap.topic === 'sessions') {
        await queryClient.invalidateQueries();
      }
      await Promise.all([...topicListeners.get(gap.topic) ?? []].map((listener) => listener.onGap?.(gap)));
    },
  });
}

function acquireSharedConnection(connectionKey: string, clientId: string): void {
  subscriberCount += 1;
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
  if (sharedClient && sharedConnectionKey === connectionKey) return;
  sharedClient?.disconnect();
  sharedClient = createClient(clientId);
  if (endpointBinding) sharedClient.setEndpoint(endpointBinding);
  sharedConnectionKey = connectionKey;
  sharedClient.subscribe('gateway');
  sharedClient.subscribe('sessions');
  for (const topic of topicListeners.keys()) sharedClient.subscribe(topic, topicCursors.get(topic));
  sharedClient.connect();
}

function releaseSharedConnection(): void {
  subscriberCount = Math.max(0, subscriberCount - 1);
  if (subscriberCount > 0 || disconnectTimer) return;
  disconnectTimer = setTimeout(() => {
    disconnectTimer = null;
    if (subscriberCount > 0) return;
    sharedClient?.disconnect();
    sharedClient = null;
    sharedConnectionKey = '';
  }, 250);
}

export function useGatewayRealtime(): void {
  const configured = useGatewayConfigured();
  const token = useGatewayStore((state) => state.token);
  const profileId = useGatewayStore((state) => state.activeGatewayId);
  const gatewayEndpoint = useGatewayStore((state) => resolveEffectiveGatewayBaseUrl({
    activeBaseUrl: state.activeBaseUrl,
    baseUrl: state.baseUrl,
    lanUrl: state.lanUrl,
  }));
  useEffect(() => {
    if (!configured || !gatewayEndpoint) {
      releaseSharedConnection();
      return;
    }
    const id = `mobile:${profileId ?? 'default'}`;
    acquireSharedConnection(`${gatewayEndpoint}|${token}`, id);
    return () => releaseSharedConnection();
  }, [configured, token, gatewayEndpoint, profileId]);

  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      const wasActive = previous === 'active';
      previous = next;
      if (wasActive && next !== 'active') {
        sharedClient?.disconnect();
      } else if (!wasActive && next === 'active') {
        void runProbeRound('foreground', { force: true }).finally(() => sharedClient?.reconnect());
      }
    });
    return () => subscription.remove();
  }, []);
}

export function getSharedGatewayRealtimeClient(): RealtimeClient | null {
  return sharedClient;
}

export function requestMobileRealtimeReconnect(): void {
  sharedClient?.reconnect();
}

export function attachMobileRealtimeEndpoint(binding: RealtimeEndpointBinding): () => void {
  endpointBinding = binding;
  sharedClient?.setEndpoint(binding);
  return () => {
    if (endpointBinding !== binding) return;
    endpointBinding = undefined;
    sharedClient?.clearEndpoint(binding);
  };
}

export function sendMobileEndpointMessage(message: ClientEndpointMessage): void {
  sharedClient?.sendEndpointMessage(message);
}

export function subscribeMobileRealtimeTopic(topic: string, listener: TopicListener, afterSeq?: number): () => void {
  const listeners = topicListeners.get(topic) ?? new Set<TopicListener>();
  const wasEmpty = listeners.size === 0;
  listeners.add(listener);
  topicListeners.set(topic, listeners);
  if (wasEmpty) {
    topicCursors.set(topic, afterSeq);
    sharedClient?.subscribe(topic, afterSeq);
  }
  return () => {
    const current = topicListeners.get(topic);
    current?.delete(listener);
    if (!current || current.size === 0) {
      topicListeners.delete(topic);
      topicCursors.delete(topic);
      sharedClient?.unsubscribe(topic);
    }
  };
}
