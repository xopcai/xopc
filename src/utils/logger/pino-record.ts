/**
 * Shared Pino JSON record → LogEntry conversion for file query and live SSE.
 */

import type { LogEntry, LogLevel } from './types.js';

const VALID_LEVELS = new Set<LogLevel>(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

function resolveLevel(parsed: Record<string, unknown>): LogLevel {
  if (typeof parsed.level !== 'string') {
    return 'info';
  }
  const lv = parsed.level.toLowerCase() as LogLevel;
  return VALID_LEVELS.has(lv) ? lv : 'info';
}

/** Convert a parsed Pino JSON object into a normalized LogEntry. */
export function pinoRecordToLogEntry(parsed: Record<string, unknown>): LogEntry {
  const reserved = new Set([
    'time',
    'level',
    'msg',
    'pid',
    'host',
    'service',
    'version',
    'module',
    'extension',
    'requestId',
    'sessionId',
    'userId',
    'correlationId',
  ]);

  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!reserved.has(key)) {
      meta[key] = value;
    }
  }

  const entry: LogEntry = {
    timestamp: String(parsed.time ?? new Date().toISOString()),
    level: resolveLevel(parsed),
    message: String(parsed.msg ?? ''),
    module: typeof parsed.module === 'string' ? parsed.module : undefined,
    service: typeof parsed.service === 'string' ? parsed.service : undefined,
    extension: typeof parsed.extension === 'string' ? parsed.extension : undefined,
    requestId: typeof parsed.requestId === 'string' ? parsed.requestId : undefined,
    sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
    userId: typeof parsed.userId === 'string' ? parsed.userId : undefined,
    correlationId: typeof parsed.correlationId === 'string' ? parsed.correlationId : undefined,
  };

  if (Object.keys(meta).length > 0) {
    entry.meta = meta;
  }

  return entry;
}

/** Build searchable text from a log entry (query + client-side filter). */
export function logEntrySearchText(entry: LogEntry): string {
  const parts: string[] = [
    entry.message,
    entry.module,
    entry.service,
    entry.extension,
    entry.requestId,
    entry.sessionId,
    typeof entry.phase === 'string' ? entry.phase : undefined,
    typeof entry.errorMessage === 'string' ? entry.errorMessage : undefined,
  ];

  const meta =
    entry.meta && typeof entry.meta === 'object'
      ? (entry.meta as Record<string, unknown>)
      : undefined;
  const err = entry.err ?? meta?.err;
  if (err && typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>;
    if (typeof e.message === 'string') parts.push(e.message);
    if (typeof e.name === 'string') parts.push(e.name);
    if (typeof e.stack === 'string') parts.push(e.stack);
  }

  if (entry.meta && typeof entry.meta === 'object') {
    for (const [key, value] of Object.entries(entry.meta)) {
      if (key === 'err') continue;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        parts.push(String(value));
      }
    }
  }

  return parts.filter(Boolean).map(String).join(' ').toLowerCase();
}
