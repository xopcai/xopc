export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export const LOG_LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  module?: string;
  service?: string;
  extension?: string;
  requestId?: string;
  sessionId?: string;
  userId?: string;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface LogQuery {
  level?: string[];
  from?: string;
  to?: string;
  q?: string;
  module?: string;
  requestId?: string;
  sessionId?: string;
  limit?: number;
  offset?: number;
}

export interface LogFile {
  name: string;
  size: number;
  modified: string;
}

export interface LogStats {
  byLevel: Partial<Record<LogLevel | 'silent', number>>;
  runtime?: {
    byLevel: Partial<Record<LogLevel | 'silent', number>>;
    byModule?: Record<string, number>;
    errorsLast24h?: number;
    uptimeMs?: number;
  };
}

export interface LogErrorSummaryItem {
  key: string;
  errName: string;
  phase?: string;
  module?: string;
  count: number;
  lastSeen: string;
  sampleMessage: string;
}
