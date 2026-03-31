import { apiUrl } from '@/lib/url';

import type { GatewaySseConfig } from '@/features/gateway/types';

export type GatewaySseCallbacks = {
  onConnected: () => void;
  onReconnecting: () => void;
  onDisconnected: () => void;
  onError: (msg: string) => void;
  onEvent: (event: string, data: string) => void;
};

/**
 * Server-Sent Events client for `/api/events`.
 */
export class GatewaySseConnection {
  private _eventSource?: EventSource;
  private _shouldReconnect = true;
  private _reconnectCount = 0;

  constructor(
    private readonly _config: GatewaySseConfig,
    private readonly _callbacks: GatewaySseCallbacks,
  ) {}

  get maxReconnectAttempts() {
    return this._config.maxReconnectAttempts ?? 10;
  }

  get autoReconnect() {
    return this._config.autoReconnect ?? true;
  }

  connect(): void {
    if (this._eventSource) return;

    const url = new URL(apiUrl('/api/events'));
    if (this._config.token) url.searchParams.set('token', this._config.token);

    this._eventSource = new EventSource(url.toString());

    this._eventSource.onopen = () => {
      this._reconnectCount = 0;
    };

    this._eventSource.addEventListener('connected', () => {
      this._callbacks.onConnected();
    });

    for (const evt of [
      'config.reload',
      'channels.status',
      'message.sent',
      'session.updated',
      'session.created',
    ]) {
      this._eventSource.addEventListener(evt, (e: MessageEvent) => {
        this._callbacks.onEvent(evt, e.data as string);
      });
    }

    this._eventSource.onerror = () => {
      if (this._eventSource?.readyState === EventSource.CLOSED) {
        this._handlePermanentDisconnect();
      } else {
        this._callbacks.onReconnecting();
      }
    };
  }

  private _handlePermanentDisconnect(): void {
    this._callbacks.onDisconnected();
    if (!this._shouldReconnect || !this.autoReconnect) return;
    this._reconnectCount++;
    if (this._reconnectCount > this.maxReconnectAttempts) {
      this._callbacks.onError('Connection failed after max retries');
    }
  }

  disconnect(): void {
    this._shouldReconnect = false;
    this._eventSource?.close();
    this._eventSource = undefined;
  }

  reconnect(): void {
    this._shouldReconnect = true;
    this._reconnectCount = 0;
    this.disconnect();
    this._shouldReconnect = true;
    setTimeout(() => this.connect(), 100);
  }
}
