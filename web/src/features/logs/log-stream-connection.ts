import { subscribeRealtimeTopic } from '@/features/gateway/gateway-realtime';

import type { LogEntry, LogLevel } from '@/features/logs/log.types';

export type LogStreamCallbacks = {
  onConnected: () => void;
  onEntry: (entry: LogEntry) => void;
  onError: (message: string) => void;
};

const LIVE_LOG_CAP = 500;

/** Live log topic subscription over the shared realtime connection. */
export class LogStreamConnection {
  private _cleanup?: () => void;

  constructor(private readonly _callbacks: LogStreamCallbacks) {}

  connect(levels?: LogLevel[], module?: string): void {
    this.disconnect();
    const allowedLevels = new Set(levels?.length ? levels : ['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
    this._cleanup = subscribeRealtimeTopic('logs', {
      onEvent: (event) => {
        if (event.event !== 'log.entry' || !event.data || typeof event.data !== 'object') return;
        const entry = event.data as LogEntry;
        if (!allowedLevels.has(entry.level) || (module && entry.module !== module)) return;
        this._callbacks.onEntry(entry);
      },
      onGap: () => this._callbacks.onError('Live log replay gap; refresh the log query'),
    });
    this._callbacks.onConnected();
  }

  disconnect(): void {
    this._cleanup?.();
    this._cleanup = undefined;
  }
}

export function prependLiveLog(existing: LogEntry[], entry: LogEntry): LogEntry[] {
  const key = `${entry.timestamp}-${entry.requestId ?? ''}-${entry.message}`;
  const deduped = existing.filter(
    (l) => `${l.timestamp}-${l.requestId ?? ''}-${l.message}` !== key,
  );
  return [entry, ...deduped].slice(0, LIVE_LOG_CAP);
}
