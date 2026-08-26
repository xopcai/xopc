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
  createMessageId?: () => string;
  getWebSocketUrl: () => string;
  issueTicket: (signal?: AbortSignal) => Promise<string>;
  createWebSocket: (url: string) => RealtimeWebSocket;
  maxReconnectAttempts?: number;
  connectionTimeoutMs?: number;
  onStateChange?: (state: RealtimeConnectionState, error?: string) => void;
  onEvent?: (event: RealtimeEventPayload) => void;
  onGap?: (gap: { topic: string; requestedSeq: number; earliestSeq: number; recoverable: boolean }) => void | Promise<void>;
  onEndpointMessage?: (message: ServerEndpointMessage) => void;
}

export interface RealtimeEndpointBinding {
  createHello: () => Promise<EndpointHelloPayload>;
  onReady: (endpoint: { endpointId: string; turnToken: string }) => void;
  onMessage: (message: ServerEndpointMessage) => void;
  onDisconnected?: () => void;
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

function isNonRetryableCloseCode(code: number | undefined): boolean {
  return code === 1009 || code === 4400 || code === 4401 || code === 4413;
}

export class RealtimeClient {
  private readonly desiredSubscriptions = new Map<string, number | undefined>();
  private readonly cursors = new Map<string, number>();
  private socket?: RealtimeWebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private connectionTimer?: ReturnType<typeof setTimeout>;
  private ticketAbort?: AbortController;
  private generation = 0;
  private reconnectAttempts = 0;
  private shouldReconnect = false;
  private ready = false;
  private lastServerMessageAt = 0;
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
    if (afterSeq !== undefined) this.cursors.set(topic, afterSeq);
    if (this.ready) {
      this.sendSubscriptions([{ topic, afterSeq: this.cursors.get(topic) ?? afterSeq }]);
    }
  }

  unsubscribe(topic: string): void {
    this.desiredSubscriptions.delete(topic);
    if (this.ready) this.send(this.clientMessage('realtime.unsubscribe', { topics: [topic] }));
  }

  sendEndpointMessage(message: ClientEndpointMessage): void {
    if (!this.ready) throw new Error('Realtime connection is not ready');
    this.send(this.clientMessage('endpoint.message', message));
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
    const timeoutMs = this.options.connectionTimeoutMs ?? 15_000;
    const ticketAbort = new AbortController();
    this.ticketAbort?.abort();
    this.ticketAbort = ticketAbort;
    let socket: RealtimeWebSocket | undefined;
    let closed = false;
    let messageQueue: Promise<void> | undefined;
    const failAttempt = (error: string, retry = true) => {
      if (closed || generation !== this.generation) return;
      closed = true;
      this.clearConnectionTimer();
      ticketAbort.abort();
      if (this.ticketAbort === ticketAbort) this.ticketAbort = undefined;
      this.ready = false;
      this.endpointBinding?.onDisconnected?.();
      this.clearHeartbeat();
      if (this.socket === socket) this.socket = undefined;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close(4000, error.slice(0, 120));
      }
      if (this.shouldReconnect && retry) this.scheduleReconnect(error);
      else if (this.shouldReconnect) {
        this.shouldReconnect = false;
        this.options.onStateChange?.('error', error);
      } else this.options.onStateChange?.('disconnected');
    };
    this.connectionTimer = setTimeout(() => failAttempt('Realtime connection timed out'), timeoutMs);
    this.options.onStateChange?.(reconnecting ? 'reconnecting' : 'connecting');
    try {
      const [ticket, endpoint] = await Promise.all([
        this.options.issueTicket(ticketAbort.signal),
        this.endpointBinding?.createHello(),
      ]);
      if (closed || !this.shouldReconnect || generation !== this.generation) return;
      socket = this.options.createWebSocket(this.options.getWebSocketUrl());
      this.socket = socket;
      socket.onopen = () => {
        if (generation !== this.generation) return;
        const subscriptions: RealtimeSubscription[] = [...this.desiredSubscriptions].map(([topic, afterSeq]) => ({
          topic,
          afterSeq: this.cursors.get(topic) ?? afterSeq,
        }));
        this.send(this.clientMessage('realtime.hello', {
          ticket,
          clientId: this.options.clientId,
          clientKind: this.options.clientKind,
          subscriptions,
          ...(endpoint ? { endpoint } : {}),
        }));
      };
      socket.onmessage = (event) => {
        if (generation !== this.generation) return;
        const process = () => {
          if (closed || generation !== this.generation) return;
          return this.handleServerMessage(frameText(event.data));
        };
        if (!messageQueue) {
          try {
            const pending = process();
            if (!pending) return;
            const current = pending
              .catch((error) => failAttempt(error instanceof Error ? error.message : 'Invalid realtime server message'))
              .then(() => undefined);
            messageQueue = current;
            void current.finally(() => {
              if (messageQueue === current) messageQueue = undefined;
            });
          } catch (error) {
            failAttempt(error instanceof Error ? error.message : 'Invalid realtime server message');
          }
          return;
        }
        const current = messageQueue
          .then(process)
          .catch((error) => failAttempt(error instanceof Error ? error.message : 'Invalid realtime server message'))
          .then(() => undefined);
        messageQueue = current;
        void current.finally(() => {
          if (messageQueue === current) messageQueue = undefined;
        });
      };
      // Browsers report `error` immediately before `close`. Wait for `close` so
      // its code and reason can decide whether reconnecting is safe.
      socket.onerror = () => {};
      socket.onclose = (event) => {
        failAttempt(
          event.reason || `WebSocket closed (${event.code ?? 0})`,
          !isNonRetryableCloseCode(event.code),
        );
      };
    } catch (error) {
      failAttempt(error instanceof Error ? error.message : 'Realtime connection failed');
    }
  }

  private handleServerMessage(text: string): void | Promise<void> {
    const message = parseServerRealtimeMessage(JSON.parse(text));
    this.lastServerMessageAt = Date.now();
    if (message.kind === 'realtime.ready') {
      this.ready = true;
      this.reconnectAttempts = 0;
      this.clearConnectionTimer();
      this.ticketAbort = undefined;
      this.options.onStateChange?.('connected');
      if (message.payload.endpoint) this.endpointBinding?.onReady(message.payload.endpoint);
      this.clearHeartbeat();
      this.heartbeatTimer = setInterval(() => {
        if (!this.ready) return;
        if (Date.now() - this.lastServerMessageAt >= message.payload.heartbeatTimeoutMs) {
          this.reconnect();
          return;
        }
        this.send(this.clientMessage('realtime.ping', {}));
      }, message.payload.heartbeatIntervalMs);
    } else if (message.kind === 'realtime.event') {
      const cursor = this.cursors.get(message.payload.topic);
      if (cursor !== undefined && message.payload.seq <= cursor) return;
      this.options.onEvent?.(message.payload);
      this.cursors.set(message.payload.topic, message.payload.seq);
    } else if (message.kind === 'realtime.subscribed') {
      this.cursors.set(message.payload.topic, message.payload.cursor);
    } else if (message.kind === 'realtime.gap') {
      this.cursors.set(message.payload.topic, message.payload.earliestSeq - 1);
      return this.options.onGap?.(message.payload);
    } else if (message.kind === 'realtime.error') {
      this.options.onStateChange?.('error', message.payload.message);
    } else if (message.kind === 'endpoint.message') {
      this.endpointBinding?.onMessage(message.payload);
      this.options.onEndpointMessage?.(message.payload);
    }
  }

  private sendSubscriptions(subscriptions: RealtimeSubscription[]): void {
    this.send(this.clientMessage('realtime.subscribe', { subscriptions }));
  }

  private clientMessage<T extends ClientRealtimeMessage['kind']>(
    kind: T,
    payload: Extract<ClientRealtimeMessage, { kind: T }>['payload'],
  ): Extract<ClientRealtimeMessage, { kind: T }> {
    const messageId = this.options.createMessageId?.() ?? globalThis.crypto?.randomUUID?.();
    if (!messageId) throw new Error('RealtimeClient requires createMessageId when crypto.randomUUID is unavailable');
    return {
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      messageId,
      kind,
      sentAt: Date.now(),
      payload,
    } as Extract<ClientRealtimeMessage, { kind: T }>;
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
    const cap = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempts - 1, 5));
    const delay = Math.round(cap * (0.5 + Math.random() * 0.5));
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.open(true);
    }, delay);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.clearConnectionTimer();
    this.ticketAbort?.abort();
    this.ticketAbort = undefined;
    this.clearHeartbeat();
  }

  private clearConnectionTimer(): void {
    if (this.connectionTimer) clearTimeout(this.connectionTimer);
    this.connectionTimer = undefined;
  }
}
