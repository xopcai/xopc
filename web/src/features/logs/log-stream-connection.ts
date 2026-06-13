import { apiUrl } from '@/lib/url';

import type { LogEntry, LogLevel } from '@/features/logs/log.types';

export type LogStreamCallbacks = {
  onConnected: () => void;
  onEntry: (entry: LogEntry) => void;
  onError: (message: string) => void;
};

const LIVE_LOG_CAP = 500;

/** Server-Sent Events client for `/api/logs/stream`. */
export class LogStreamConnection {
  private _eventSource?: EventSource;

  constructor(
    private readonly _token: string | undefined,
    private readonly _callbacks: LogStreamCallbacks,
  ) {}

  connect(levels?: LogLevel[], module?: string): void {
    this.disconnect();

    const url = new URL(apiUrl('/api/logs/stream'));
    if (this._token) url.searchParams.set('token', this._token);
    if (levels?.length) url.searchParams.set('levels', levels.join(','));
    else url.searchParams.set('levels', 'trace,debug,info,warn,error,fatal');
    if (module) url.searchParams.set('module', module);

    this._eventSource = new EventSource(url.toString());

    this._eventSource.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (data.type === 'connected') {
          this._callbacks.onConnected();
          return;
        }
        if (data.type === 'heartbeat') return;
        this._callbacks.onEntry(data as LogEntry);
      } catch {
        /* ignore malformed SSE payloads */
      }
    };

    this._eventSource.onerror = () => {
      if (this._eventSource?.readyState === EventSource.CLOSED) {
        this._callbacks.onError('Log stream disconnected');
      }
    };
  }

  disconnect(): void {
    this._eventSource?.close();
    this._eventSource = undefined;
  }
}

export function prependLiveLog(existing: LogEntry[], entry: LogEntry): LogEntry[] {
  const key = `${entry.timestamp}-${entry.requestId ?? ''}-${entry.message}`;
  const deduped = existing.filter(
    (l) => `${l.timestamp}-${l.requestId ?? ''}-${l.message}` !== key,
  );
  return [entry, ...deduped].slice(0, LIVE_LOG_CAP);
}
