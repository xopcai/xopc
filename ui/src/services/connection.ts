// ConnectionService - Manages SSE connection and events

import { getStore } from '../core/store.js';
import type { ConnectionStatus } from '../core/store.js';

const store = getStore();

export interface ConnectionConfig {
  url: string;
  token?: string | undefined;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
}

export interface ConnectionEvents {
  onConfigReload?: (data: unknown) => void;
  onChannelsStatus?: (data: unknown) => void;
  onMessageSent?: (data: unknown) => void;
  onError?: (error: string) => void;
}

export class ConnectionService {
  private _eventSource?: EventSource;
  private _config: Required<ConnectionConfig>;
  private _events: ConnectionEvents;
  private _reconnectTimer?: number;
  private _shouldReconnect = true;

  constructor(config: ConnectionConfig, events: ConnectionEvents = {}) {
    this._config = {
      autoReconnect: true,
      maxReconnectAttempts: 10,
      reconnectDelay: 3000,
      ...config,
    };
    this._events = events;
  }

  get isConnected(): boolean {
    return store.getState().connection.status === 'connected';
  }

  get status(): ConnectionStatus {
    return store.getState().connection.status;
  }

  connect(): void {
    if (store.getState().connection.status === 'connecting') {
      console.log('[ConnectionService] Already connecting');
      return;
    }

    store.getState().setConnectionStatus('connecting');
    store.getState().setConnectionError(null);

    try {
      const url = new URL('/api/events', this._config.url);
      if (this._config.token) {
        url.searchParams.set('token', this._config.token);
      }

      this._eventSource = new EventSource(url.toString());

      this._eventSource.onopen = () => {
        store.getState().resetReconnect();
        store.getState().setConnectionStatus('connected');
        store.getState().setConnectionError(null);
        console.log('[ConnectionService] Connected');
      };

      this._eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._handleMessage(data);
        } catch (err) {
          console.warn('[ConnectionService] Failed to parse message:', err);
        }
      };

      this._eventSource.addEventListener('connected', () => {
        store.getState().setConnectionStatus('connected');
        store.getState().setConnectionError(null);
      });

      this._eventSource.addEventListener('config.reload', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          this._events.onConfigReload?.(data);
        } catch { /* ignore */ }
      });

      this._eventSource.addEventListener('channels.status', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          this._events.onChannelsStatus?.(data);
        } catch { /* ignore */ }
      });

      this._eventSource.addEventListener('message.sent', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          this._events.onMessageSent?.(data);
        } catch { /* ignore */ }
      });

      this._eventSource.onerror = () => {
        if (this._eventSource?.readyState === EventSource.CLOSED) {
          this._handleDisconnect();
        } else {
          store.getState().setConnectionStatus('reconnecting');
        }
      };
    } catch (err) {
      console.error('[ConnectionService] Failed to connect:', err);
      store.getState().setConnectionStatus('error');
      store.getState().setConnectionError('Failed to create connection');
      this._events.onError?.('Failed to create connection');
    }
  }

  disconnect(): void {
    this._shouldReconnect = false;
    this._clearReconnectTimer();
    this._eventSource?.close();
    this._eventSource = undefined;
    store.getState().setConnectionStatus('disconnected');
  }

  reconnect(): void {
    this._shouldReconnect = true;
    store.getState().resetReconnect();
    this.disconnect();
    setTimeout(() => this.connect(), 100);
  }

  private _handleMessage(data: unknown): void {
    if (typeof data === 'object' && data !== null) {
      const msg = data as Record<string, unknown>;
      
      if (msg.type === 'error' && typeof msg.message === 'string') {
        store.getState().setConnectionError(msg.message);
        this._events.onError?.(msg.message);
      }
    }
  }

  private _handleDisconnect(): void {
    store.getState().setConnectionStatus('disconnected');

    if (!this._shouldReconnect || !this._config.autoReconnect) {
      return;
    }

    const reconnectCount = store.getState().connection.reconnectCount;
    if (reconnectCount >= this._config.maxReconnectAttempts) {
      console.error('[ConnectionService] Max reconnection attempts reached');
      store.getState().setConnectionStatus('error');
      store.getState().setConnectionError('Connection lost - max retries exceeded');
      this._events.onError?.('Connection lost');
      return;
    }

    store.getState().incrementReconnect();
    store.getState().setConnectionStatus('reconnecting');

    console.log(`[ConnectionService] Reconnecting... (attempt ${reconnectCount + 1})`);

    this._reconnectTimer = window.setTimeout(() => {
      this.connect();
    }, this._config.reconnectDelay);
  }

  private _clearReconnectTimer(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = undefined;
    }
  }

  dispose(): void {
    this.disconnect();
    this._events = {};
  }
}

let connectionServiceInstance: ConnectionService | null = null;

export function getConnectionService(
  config?: ConnectionConfig, 
  events?: ConnectionEvents
): ConnectionService {
  if (!connectionServiceInstance && config) {
    connectionServiceInstance = new ConnectionService(config, events);
  }
  return connectionServiceInstance!;
}

export function resetConnectionService(): void {
  connectionServiceInstance?.dispose();
  connectionServiceInstance = null;
}
