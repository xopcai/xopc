/**
 * Logger Types
 * 
 * Centralized type definitions for the logging system.
 */

import type { Logger, LogFn, ChildLoggerOptions } from 'pino';

/**
 * Basic log entry structure
 */
export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  module?: string;
  prefix?: string;
  service?: string;
  plugin?: string;
  requestId?: string;
  sessionId?: string;
  userId?: string;
  [key: string]: unknown;
}

/**
 * Log levels in order of severity
 */
export const LogLevel = {
  TRACE: 'trace',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal',
  SILENT: 'silent',
} as const;

export type LogLevel = typeof LogLevel[keyof typeof LogLevel];

/**
 * Log level numeric values (for comparison)
 */
export const LogLevelValue: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Number.MAX_VALUE,
};

/**
 * Common log context fields
 */
export interface LogContext {
  /** Request/operation ID for tracing */
  requestId?: string;
  /** Session ID for user tracking */
  sessionId?: string;
  /** User ID */
  userId?: string;
  /** Module/component name */
  module?: string;
  /** Plugin name */
  plugin?: string;
  /** Service name */
  service?: string;
  /** Additional context */
  [key: string]: unknown;
}

/**
 * Extended logger with context support
 */
export interface ContextualLogger extends Logger {
  /**
   * Set default context for all subsequent logs
   */
  withContext(context: LogContext): ContextualLogger;
  
  /**
   * Create a child logger with additional context
   */
  childContext(context: LogContext): ContextualLogger;
}

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /** Minimum log level */
  level: LogLevel;
  /** Log directory */
  logDir: string;
  /** Enable console output */
  consoleOutput: boolean;
  /** Enable file output */
  fileOutput: boolean;
  /** Enable error-only file output */
  errorFileOutput: boolean;
  /** Log rotation: max days to keep */
  retentionDays: number;
  /** Log rotation: max file size in MB */
  maxFileSizeMB: number;
  /** Enable pretty print for console (dev only) */
  prettyPrint: boolean;
  /** Enable async logging */
  async: boolean;
  /** Sample rate for debug logs (0-1, 1 = all) */
  debugSampleRate?: number;
}

/**
 * Log file metadata
 */
export interface LogFileMeta {
  name: string;
  path: string;
  size: number;
  created: string;
  modified: string;
  type: 'app' | 'error' | 'audit' | 'access';
  lines?: number;
}

/**
 * Log query options
 */
export interface LogQuery {
  /** Filter by log levels */
  levels?: LogLevel[];
  /** Start timestamp (ISO 8601) */
  from?: string;
  /** End timestamp (ISO 8601) */
  to?: string;
  /** Keyword search */
  q?: string;
  /** Filter by module */
  module?: string;
  /** Filter by plugin */
  plugin?: string;
  /** Filter by service */
  service?: string;
  /** Filter by request ID */
  requestId?: string;
  /** Filter by session ID */
  sessionId?: string;
  /** Pagination offset */
  offset?: number;
  /** Pagination limit */
  limit?: number;
  /** Sort order: 'asc' | 'desc' */
  order?: 'asc' | 'desc';
}

/**
 * Log statistics
 */
export interface LogStats {
  byLevel: Record<LogLevel, number>;
}

/**
 * Log rotation result
 */
export interface RotationResult {
  rotated: number;
  deleted: number;
  compressed: number;
  errors: string[];
}
