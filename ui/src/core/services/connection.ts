/**
 * Gateway Connection Service
 * Handles SSE connection, reconnection, and message streaming
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('GatewayConnection');

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';

export interface ConnectionConfig {
  url: string;
  token?: string;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
}

export interface ConnectionEvents {
  onStateChange: (state: ConnectionState) => void;
  onMessage: (data: unknown) => void;
  onError: (error: string) => void;
}

export class GatewayConnection {
  private _eventSource?: EventSource;
  private _config: Required<ConnectionConfig>;
  private _events: ConnectionEvents;
  private _reconnectAttempts = 0;
  private _reconnectTimer?: number;
  private _isDisposed = false;

  constructor(config: ConnectionConfig, events: ConnectionEvents) {
    this._config = {
      autoReconnect: true,
      maxReconnectAttempts: 5,
      reconnectDelay: 3000,
      ...config,
    };
    this._events = events;
  }

  connect(): void {
    if (this._isDisposed) return;
    
    this._events.onStateChange('connecting');
    
    try {
      const url = new URL('/api/events', this._config.url);
      if (this._config.token) {
        url.searchParams.set('token', this._config.token);
      }

      this._eventSource = new EventSource(url.toString());

      this._eventSource.onopen = () => {
        this._reconnectAttempts = 0;
        this._events.onStateChange('connected');
        log.info('Connected to gateway');
      };

      this._eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._events.onMessage(data);
        } catch (err) {
          log.warn({ err }, 'Failed to parse message');
        }
      };

      this._eventSource.onerror = () => {
        this._events.onStateChange('error');
        this._events.onError('Connection error');
        this._scheduleReconnect();
      };
    } catch (err) {
      log.error({ err }, 'Failed to connect');
      this._events.onStateChange('error');
      this._events.onError('Failed to connect');
    }
  }

  private _scheduleReconnect(): void {
    if (!this._config.autoReconnect || this._isDisposed) return;
    if (this._reconnectAttempts >= this._config.maxReconnectAttempts) {
      log.error('Max reconnection attempts reached');
      this._events.onError('Connection lost');
      return;
    }

    this._reconnectAttempts++;
    this._events.onStateChange('reconnecting');

    log.info({ attempt: this._reconnectAttempts }, 'Reconnecting...');

    this._reconnectTimer = window.setTimeout(() => {
      this.connect();
    }, this._config.reconnectDelay);
  }

  disconnect(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
    }
    this._eventSource?.close();
    this._eventSource = undefined;
    this._events.onStateChange('disconnected');
  }

  dispose(): void {
    this._isDisposed = true;
    this.disconnect();
  }
}

export function createConnection(config: ConnectionConfig, events: ConnectionEvents): GatewayConnection {
  return new GatewayConnection(config, events);
}
