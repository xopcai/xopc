import { notifyUnauthorizedIfNeeded } from '../../api/notify-unauthorized';
import { useGatewayStore } from '../../stores/gateway-store';

import { dispatchGatewaySseEvent } from './dispatch-gateway-sse-event';
import { runProbeRound } from './probe-coordinator';

export type GatewaySseCallbacks = {
  onConnected: () => void;
  onReconnecting: () => void;
  onDisconnected: () => void;
  onError: (msg: string) => void;
};

const GATEWAY_SSE_EVENTS = [
  'agent.stream',
  'config.reload',
  'channels.status',
  'message.sent',
  'session.updated',
  'session.transcript_updated',
  'session.created',
] as const;

/** Incremental SSE line parser for long-lived GET streams. */
class GatewaySseLineParser {
  private buf = '';
  private evtType = '';
  private evtData = '';

  constructor(private readonly onEvent: (event: string, data: string) => void) {}

  feed(chunk: string): void {
    if (!chunk) return;
    this.buf += chunk.replace(/\r\n/g, '\n');
    while (this.buf.includes('\n')) {
      const idx = this.buf.indexOf('\n');
      let line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      line = line.replace(/\r$/, '');
      this.processLine(line);
    }
  }

  flush(): void {
    while (this.buf.includes('\n')) {
      const idx = this.buf.indexOf('\n');
      let line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      line = line.replace(/\r$/, '');
      this.processLine(line);
    }
    if (this.evtData) {
      this.onEvent(this.evtType || 'message', this.evtData);
      this.evtType = '';
      this.evtData = '';
    }
  }

  private processLine(line: string): void {
    if (line.startsWith('event:')) {
      this.evtData = '';
      this.evtType = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      const payload = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
      this.evtData += (this.evtData ? '\n' : '') + payload;
    } else if (line === '' && this.evtData) {
      this.onEvent(this.evtType || 'message', this.evtData);
      this.evtType = '';
      this.evtData = '';
    }
  }
}

type Transport = { close: () => void };

/**
 * Long-lived SSE to `GET /api/events` (parity with web `GatewaySseConnection`).
 * Uses `EventSource` on web when available; XHR incremental parse on React Native.
 */
/** Re-probe LAN/tunnel and pick the new winner after this many consecutive
 * reconnect failures on the current route. Tied to wall-clock cap of about
 * 1+2+4 seconds of backoff before the first re-route attempt. */
const SSE_REPROBE_AFTER_FAILURES = 3;

export class GatewaySseConnection {
  private transport?: Transport;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private _shouldReconnect = true;
  private _reconnectCount = 0;
  private _closed = false;
  /** Counts consecutive reconnect attempts that fail before resetting after
   * a successful 'connected' event. Drives the route-swap heuristic. */
  private _failureStreak = 0;
  private _reprobeInFlight = false;

  constructor(
    private readonly callbacks: GatewaySseCallbacks,
    private readonly maxReconnectAttempts = 10,
  ) {}

  connect(): void {
    this._closed = false;
    this.openTransport();
  }

  disconnect(): void {
    this._shouldReconnect = false;
    this._closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.transport?.close();
    this.transport = undefined;
    this.callbacks.onDisconnected();
  }

  reconnect(): void {
    this.disconnect();
    this._shouldReconnect = true;
    this._reconnectCount = 0;
    this._closed = false;
    setTimeout(() => this.openTransport(), 100);
  }

  private buildUrl(): string {
    const { apiUrl } = useGatewayStore.getState();
    const url = new URL(apiUrl('/api/events'));
    return url.toString();
  }

  private tryBuildUrl(): string | null {
    try {
      return this.buildUrl();
    } catch (error) {
      if (error instanceof Error && error.message === 'Gateway base URL is not configured') {
        return null;
      }
      throw error;
    }
  }

  private openTransport(): void {
    if (this._closed) return;
    this.transport?.close();
    const url = this.tryBuildUrl();
    if (!url) {
      this._shouldReconnect = false;
      this.transport = undefined;
      this.callbacks.onDisconnected();
      return;
    }

    const { token } = useGatewayStore.getState();
    if (!token && typeof EventSource !== 'undefined' && typeof document !== 'undefined') {
      this.transport = this.openEventSource(url);
      return;
    }
    this.transport = this.openXhr(url);
  }

  private openEventSource(url: string): Transport {
    const es = new EventSource(url);
    let sawConnected = false;

    const onNamed = (evt: MessageEvent) => {
      dispatchGatewaySseEvent(evt.type, String(evt.data ?? ''));
    };

    es.addEventListener('connected', () => {
      sawConnected = true;
      this._reconnectCount = 0;
      this._failureStreak = 0;
      this.callbacks.onConnected();
    });

    for (const name of GATEWAY_SSE_EVENTS) {
      es.addEventListener(name, onNamed as EventListener);
    }

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        this.scheduleReconnect(sawConnected ? 'disconnected' : 'error');
      } else {
        this.callbacks.onReconnecting();
      }
    };

    return {
      close: () => {
        es.close();
      },
    };
  }

  private openXhr(url: string): Transport {
    const xhr = new XMLHttpRequest();
    const { token } = useGatewayStore.getState();
    let sawConnected = false;
    let parsedLen = 0;

    const parser = new GatewaySseLineParser((event, data) => {
      dispatchGatewaySseEvent(event, data);
      if (!sawConnected && event === 'connected') {
        sawConnected = true;
        this._reconnectCount = 0;
        this._failureStreak = 0;
        this.callbacks.onConnected();
      }
    });

    const drain = () => {
      const text = xhr.responseText;
      if (text.length > parsedLen) {
        parser.feed(text.slice(parsedLen));
        parsedLen = text.length;
      }
    };

    xhr.open('GET', url, true);
    xhr.setRequestHeader('Accept', 'text/event-stream');
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.onprogress = drain;

    xhr.onreadystatechange = () => {
      if (xhr.readyState === XMLHttpRequest.LOADING || xhr.readyState === XMLHttpRequest.DONE) {
        drain();
      }
    };

    xhr.onload = () => {
      drain();
      parser.flush();
      notifyUnauthorizedIfNeeded(xhr.status);
      if (xhr.status === 401) {
        this._shouldReconnect = false;
        this.callbacks.onError('Unauthorized');
        return;
      }
      this.scheduleReconnect(sawConnected ? 'disconnected' : 'error');
    };

    xhr.onerror = () => {
      this.scheduleReconnect('error');
    };

    xhr.send();

    return {
      close: () => {
        xhr.abort();
      },
    };
  }

  private scheduleReconnect(reason: 'disconnected' | 'error'): void {
    this.transport = undefined;
    if (this._closed || !this._shouldReconnect) return;

    if (reason === 'disconnected') {
      this.callbacks.onDisconnected();
    } else {
      this.callbacks.onReconnecting();
    }

    this._reconnectCount++;
    this._failureStreak++;
    if (this._reconnectCount > this.maxReconnectAttempts) {
      this.callbacks.onError('Gateway SSE connection failed after max retries');
      return;
    }

    if (this._failureStreak >= SSE_REPROBE_AFTER_FAILURES) {
      this.triggerRouteReprobe();
    }

    const delayMs = Math.min(30_000, 1000 * 2 ** Math.min(this._reconnectCount, 5));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this._closed && this._shouldReconnect) {
        this.openTransport();
      }
    }, delayMs);
  }

  /** When the current route keeps failing, kick a fresh race so we can move
   * to the LAN/tunnel that's actually answering. Single-flight: never run two
   * reprobes in parallel. We don't await — the next backoff tick consumes the
   * new activeBaseUrl via buildUrl(). */
  private triggerRouteReprobe(): void {
    if (this._reprobeInFlight) return;
    this._reprobeInFlight = true;
    this._failureStreak = 0;
    void runProbeRound('sse-degraded', { force: true })
      .catch(() => {
        /* probe errors are non-fatal — caller still retries on its own */
      })
      .finally(() => {
        this._reprobeInFlight = false;
      });
  }
}
