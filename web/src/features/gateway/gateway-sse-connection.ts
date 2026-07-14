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
  private _abort?: AbortController;
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
    if (this._abort) return;
    const abort = new AbortController();
    this._abort = abort;
    void this._consume(abort);
  }

  private async _consume(abort: AbortController): Promise<void> {
    try {
      const headers = new Headers({ Accept: 'text/event-stream' });
      if (this._config.credential) headers.set('Authorization', `Bearer ${this._config.credential}`);
      const response = await fetch(apiUrl('/api/events'), { headers, signal: abort.signal });
      if (!response.ok || !response.body) throw new Error(`Gateway event stream failed: ${response.status}`);
      this._reconnectCount = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!abort.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          this._dispatchChunk(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) this._callbacks.onReconnecting();
      if (!abort.signal.aborted && error instanceof Error) this._callbacks.onError(error.message);
    } finally {
      if (this._abort === abort) this._abort = undefined;
      if (!abort.signal.aborted) this._handlePermanentDisconnect();
    }
  }

  private _dispatchChunk(chunk: string): void {
    let event = 'message';
    const data: string[] = [];
    for (const line of chunk.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (event === 'connected') this._callbacks.onConnected();
    else if (data.length > 0) this._callbacks.onEvent(event, data.join('\n'));
  }

  private _handlePermanentDisconnect(): void {
    this._callbacks.onDisconnected();
    if (!this._shouldReconnect || !this.autoReconnect) return;
    this._reconnectCount++;
    if (this._reconnectCount > this.maxReconnectAttempts) {
      this._callbacks.onError('Connection failed after max retries');
      return;
    }
    this._callbacks.onReconnecting();
    setTimeout(() => this.connect(), Math.min(1000 * this._reconnectCount, 5000));
  }

  disconnect(): void {
    this._shouldReconnect = false;
    this._abort?.abort();
    this._abort = undefined;
  }

  reconnect(): void {
    this._shouldReconnect = true;
    this._reconnectCount = 0;
    this.disconnect();
    this._shouldReconnect = true;
    setTimeout(() => this.connect(), 100);
  }
}
