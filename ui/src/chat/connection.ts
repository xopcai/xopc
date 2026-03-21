import type { ConnectionState, GatewayClientConfig } from './types.js';
import { apiUrl } from './helpers.js';

export type ConnectionCallbacks = {
  onConnected: () => void;
  onReconnecting: () => void;
  onDisconnected: () => void;
  onError: (msg: string) => void;
  onEvent: (event: string, data: string) => void;
};

export class ChatConnection {
  private _eventSource?: EventSource;
  private _shouldReconnect = true;
  private _reconnectCount = 0;

  constructor(
    private _config: GatewayClientConfig,
    private _callbacks: ConnectionCallbacks,
  ) {}

  get maxReconnectAttempts() { return this._config.maxReconnectAttempts ?? 10; }
  get autoReconnect() { return this._config.autoReconnect ?? true; }

  connect(): void {
    if (this._eventSource) return;

    const url = new URL(apiUrl('/api/events'));
    if (this._config.token) url.searchParams.set('token', this._config.token);

    this._eventSource = new EventSource(url.toString());

    // onopen and the server's first SSE `connected` event both fire on connect; only run once.
    this._eventSource.onopen = () => {
      this._reconnectCount = 0;
    };

    this._eventSource.addEventListener('connected', () => {
      this._callbacks.onConnected();
    });

    for (const evt of ['config.reload', 'channels.status', 'message.sent']) {
      this._eventSource.addEventListener(evt, (e: MessageEvent) => {
        this._callbacks.onEvent(evt, e.data);
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
