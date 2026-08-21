import type {
  ClientEndpointMessage,
  EndpointHelloPayload,
  ServerEndpointMessage,
} from '@xopcai/endpoint-tools-protocol';
import {
  REALTIME_PROTOCOL_VERSION,
  parseServerRealtimeMessage,
  type ClientRealtimeMessage,
  type RealtimeClientKind,
  type RealtimeEventPayload,
  type RealtimeSubscription,
} from '@xopcai/realtime-protocol';

export type RealtimeConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface RealtimeWebSocket {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RealtimeClientOptions {
  clientId: string;
  clientKind: RealtimeClientKind;
  getWebSocketUrl: () => string;
  issueTicket: () => Promise<string>;
  createWebSocket: (url: string) => RealtimeWebSocket;
  maxReconnectAttempts?: number;
  onStateChange?: (state: RealtimeConnectionState, error?: string) => void;
  onEvent?: (event: RealtimeEventPayload) => void;
  onGap?: (gap: { topic: string; requestedSeq: number; earliestSeq: number }) => void;
  onEndpointMessage?: (message: ServerEndpointMessage) => void;
}

export interface RealtimeEndpointBinding {
  createHello: () => Promise<EndpointHelloPayload>;
  onReady: (endpoint: { endpointId: string; turnToken: string }) => void;
  onMessage: (message: ServerEndpointMessage) => void;
  onDisconnected?: () => void;
}

function clientMessage<T extends ClientRealtimeMessage['kind']>(
  kind: T,
  payload: Extract<ClientRealtimeMessage, { kind: T }>['payload'],
): Extract<ClientRealtimeMessage, { kind: T }> {
  return {
    protocolVersion: REALTIME_PROTOCOL_VERSION,
    messageId: crypto.randomUUID(),
    kind,
    sentAt: Date.now(),
    payload,
  } as Extract<ClientRealtimeMessage, { kind: T }>;
}

function frameText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    const bytes = Uint8Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return new TextDecoder().decode(bytes);
  }
  throw new Error('Realtime server sent a non-text frame');
}

export class RealtimeClient {
  private readonly desiredSubscriptions = new Map<string, number | undefined>();
  private readonly cursors = new Map<string, number>();
  private socket?: RealtimeWebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private reconnectAttempts = 0;
  private shouldReconnect = false;
  private ready = false;
  private endpointBinding?: RealtimeEndpointBinding;

  constructor(private readonly options: RealtimeClientOptions) {}

  connect(): void {
    if (this.shouldReconnect) return;
    this.shouldReconnect = true;
    void this.open(false);
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.generation += 1;
    this.clearTimers();
    this.ready = false;
    this.endpointBinding?.onDisconnected?.();
    this.socket?.close(1000, 'Client disconnected');
    this.socket = undefined;
    this.options.onStateChange?.('disconnected');
  }

  reconnect(): void {
    this.generation += 1;
    this.clearTimers();
    this.ready = false;
    this.endpointBinding?.onDisconnected?.();
    this.socket?.close(1000, 'Client reconnecting');
    this.socket = undefined;
    this.reconnectAttempts = 0;
    this.shouldReconnect = true;
    void this.open(true);
  }

  subscribe(topic: string, afterSeq?: number): void {
    this.desiredSubscriptions.set(topic, afterSeq);
    if (this.ready) {
      this.sendSubscriptions([{ topic, afterSeq: afterSeq ?? this.cursors.get(topic) }]);
      this.desiredSubscriptions.set(topic, undefined);
    }
  }

  unsubscribe(topic: string): void {
    this.desiredSubscriptions.delete(topic);
    if (this.ready) this.send(clientMessage('realtime.unsubscribe', { topics: [topic] }));
  }

  sendEndpointMessage(message: ClientEndpointMessage): void {
    if (!this.ready) throw new Error('Realtime connection is not ready');
    this.send(clientMessage('endpoint.message', message));
  }

  setEndpoint(binding: RealtimeEndpointBinding): void {
    this.endpointBinding = binding;
    if (this.shouldReconnect) this.reconnect();
  }

  clearEndpoint(binding?: RealtimeEndpointBinding): void {
    if (binding && this.endpointBinding !== binding) return;
    const previous = this.endpointBinding;
    this.endpointBinding = undefined;
    previous?.onDisconnected?.();
    if (this.shouldReconnect) this.reconnect();
  }

  private async open(reconnecting: boolean): Promise<void> {
    const generation = ++this.generation;
    this.options.onStateChange?.(reconnecting ? 'reconnecting' : 'connecting');
    try {
      const [ticket, endpoint] = await Promise.all([
        this.options.issueTicket(),
        this.endpointBinding?.createHello(),
      ]);
      if (!this.shouldReconnect || generation !== this.generation) return;
      const socket = this.options.createWebSocket(this.options.getWebSocketUrl());
      this.socket = socket;
      socket.onopen = () => {
        if (generation !== this.generation) return;
        const subscriptions: RealtimeSubscription[] = [...this.desiredSubscriptions].map(([topic, afterSeq]) => ({
          topic,
          afterSeq: afterSeq ?? this.cursors.get(topic),
        }));
        for (const topic of this.desiredSubscriptions.keys()) this.desiredSubscriptions.set(topic, undefined);
        this.send(clientMessage('realtime.hello', {
          ticket,
          clientId: this.options.clientId,
          clientKind: this.options.clientKind,
          subscriptions,
          ...(endpoint ? { endpoint } : {}),
        }));
      };
      socket.onmessage = (event) => {
        if (generation !== this.generation) return;
        try {
          this.handleServerMessage(frameText(event.data));
        } catch (error) {
          this.fail(error instanceof Error ? error.message : 'Invalid realtime server message');
        }
      };
      socket.onerror = () => {
        if (generation === this.generation) this.options.onStateChange?.('reconnecting');
      };
      socket.onclose = (event) => {
        if (generation !== this.generation) return;
        this.ready = false;
        this.endpointBinding?.onDisconnected?.();
        this.socket = undefined;
        this.clearHeartbeat();
        if (this.shouldReconnect) this.scheduleReconnect(event.reason || `WebSocket closed (${event.code ?? 0})`);
        else this.options.onStateChange?.('disconnected');
      };
    } catch (error) {
      if (generation !== this.generation) return;
      this.scheduleReconnect(error instanceof Error ? error.message : 'Realtime connection failed');
    }
  }

  private handleServerMessage(text: string): void {
    const message = parseServerRealtimeMessage(JSON.parse(text));
    if (message.kind === 'realtime.ready') {
      this.ready = true;
      this.reconnectAttempts = 0;
      this.options.onStateChange?.('connected');
      if (message.payload.endpoint) this.endpointBinding?.onReady(message.payload.endpoint);
      this.clearHeartbeat();
      this.heartbeatTimer = setInterval(() => {
        if (this.ready) this.send(clientMessage('realtime.ping', {}));
      }, message.payload.heartbeatIntervalMs);
    } else if (message.kind === 'realtime.event') {
      this.cursors.set(message.payload.topic, message.payload.seq);
      this.options.onEvent?.(message.payload);
    } else if (message.kind === 'realtime.gap') {
      this.cursors.set(message.payload.topic, message.payload.earliestSeq - 1);
      this.options.onGap?.(message.payload);
    } else if (message.kind === 'realtime.error') {
      this.options.onStateChange?.('error', message.payload.message);
    } else if (message.kind === 'endpoint.message') {
      this.endpointBinding?.onMessage(message.payload);
      this.options.onEndpointMessage?.(message.payload);
    }
  }

  private sendSubscriptions(subscriptions: RealtimeSubscription[]): void {
    this.send(clientMessage('realtime.subscribe', { subscriptions }));
  }

  private send(message: ClientRealtimeMessage): void {
    if (!this.socket || this.socket.readyState !== 1) return;
    this.socket.send(JSON.stringify(message));
  }

  private scheduleReconnect(error: string): void {
    if (!this.shouldReconnect) return;
    this.reconnectAttempts += 1;
    const max = this.options.maxReconnectAttempts;
    if (max !== undefined && this.reconnectAttempts > max) {
      this.shouldReconnect = false;
      this.options.onStateChange?.('error', error);
      return;
    }
    this.options.onStateChange?.('reconnecting', error);
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempts - 1, 5));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.open(true);
    }, delay);
  }

  private fail(message: string): void {
    this.options.onStateChange?.('error', message);
    this.socket?.close(4400, 'Invalid server message');
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.clearHeartbeat();
  }
}
