/** In-process live log fan-out. */

import type { LogLevel, LogEntry } from './types.js';
export type { LogLevel, LogEntry };

type LogSubscriber = (entry: LogEntry) => void;
const subscribers = new Set<LogSubscriber>();

export function subscribeToLogs(subscriber: LogSubscriber): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

export function hasSubscribers(): boolean {
  return subscribers.size > 0;
}

/** @internal Called from Pino live emit stream */
export function emitLogEntry(entry: LogEntry): void {
  if (subscribers.size === 0) return;

  for (const subscriber of subscribers) {
    try {
      subscriber(entry);
    } catch {
      /* ignore subscriber errors */
    }
  }
}
