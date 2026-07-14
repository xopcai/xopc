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
  private _abort?: AbortController;

  constructor(
    private readonly _token: string | undefined,
    private readonly _callbacks: LogStreamCallbacks,
  ) {}

  connect(levels?: LogLevel[], module?: string): void {
    this.disconnect();
    const abort = new AbortController();
    this._abort = abort;
    void this._consume(abort, levels, module);
  }

  private async _consume(abort: AbortController, levels?: LogLevel[], module?: string): Promise<void> {
    const url = new URL(apiUrl('/api/logs/stream'));
    if (levels?.length) url.searchParams.set('levels', levels.join(','));
    else url.searchParams.set('levels', 'trace,debug,info,warn,error,fatal');
    if (module) url.searchParams.set('module', module);

    try {
      const headers = new Headers({ Accept: 'text/event-stream' });
      if (this._token) headers.set('Authorization', `Bearer ${this._token}`);
      const response = await fetch(url.toString(), { headers, signal: abort.signal });
      if (!response.ok || !response.body) throw new Error(`Log stream failed: ${response.status}`);
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
      if (!abort.signal.aborted) {
        this._callbacks.onError(error instanceof Error ? error.message : 'Log stream disconnected');
      }
    } finally {
      if (this._abort === abort) this._abort = undefined;
    }
  }

  private _dispatchChunk(chunk: string): void {
    const data = chunk
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    try {
      const entry = JSON.parse(data) as Record<string, unknown>;
      if (entry.type === 'connected') {
        this._callbacks.onConnected();
        return;
      }
      if (entry.type === 'heartbeat') return;
      this._callbacks.onEntry(entry as LogEntry);
    } catch {
      /* ignore malformed SSE payloads */
    }
  }

  disconnect(): void {
    this._abort?.abort();
    this._abort = undefined;
  }
}

export function prependLiveLog(existing: LogEntry[], entry: LogEntry): LogEntry[] {
  const key = `${entry.timestamp}-${entry.requestId ?? ''}-${entry.message}`;
  const deduped = existing.filter(
    (l) => `${l.timestamp}-${l.requestId ?? ''}-${l.message}` !== key,
  );
  return [entry, ...deduped].slice(0, LIVE_LOG_CAP);
}
