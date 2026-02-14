/**
 * Logger Module
 *
 * Centralized logging system using pino.
 * Provides structured logging with levels, prefixes, and child loggers.
 * Supports both console and file output.
 *
 * Log Levels (in order of severity):
 * - trace:   Most detailed, for development debugging only
 * - debug:   Detailed info for troubleshooting
 * - info:    General operational events (startup, shutdown, major state changes)
 * - warn:    Unexpected but non-fatal issues
 * - error:   Errors that affect functionality
 * - fatal:   Critical errors that prevent operation
 */

import pino from 'pino';
import type { Logger } from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, createWriteStream } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Log directory
const LOG_DIR = process.env.XOPCBOT_LOG_DIR || path.join(process.env.HOME || '.', '.xopcbot', 'logs');

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

// Get log file path for a specific date
function getLogPath(type: 'app' | 'error' = 'app'): string {
  const date = new Date().toISOString().split('T')[0];
  return path.join(LOG_DIR, `${type}-${date}.log`);
}

// Default log level from environment
const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.DEBUG ? 'debug' : 'info');

// Create file write streams (append mode)
const appLogStream = createWriteStream(getLogPath('app'), { flags: 'a' });
const errorLogStream = createWriteStream(getLogPath('error'), { flags: 'a' });

// Create the base logger instance
const baseLogger = pino({
  level: LOG_LEVEL,
  base: {
    service: 'xopcbot',
    version: '0.1.0',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
}, pino.multistream([
  {
    stream: process.stdout,
    level: LOG_LEVEL,
  },
  {
    stream: appLogStream,
    level: LOG_LEVEL,
  },
  {
    stream: errorLogStream,
    level: 'error',
  },
]));

// Aliases for compatibility
export const logger = baseLogger;
export { pino as Pino };

/**
 * Create a child logger with a specific prefix
 * Use for: Component-level logging
 */
export function createLogger(prefix: string): Logger {
  return baseLogger.child({ prefix });
}

/**
 * Create a logger for a specific module/component
 * Use for: Module-level logging with file path info
 */
export function createModuleLogger(moduleName: string, modulePath?: string): Logger {
  const base = modulePath 
    ? path.relative(path.join(__dirname, '..'), modulePath).replace(/\.ts$/, '')
    : moduleName;
  return baseLogger.child({ module: base });
}

/**
 * Plugin Logger interface
 */
export interface PluginLogger {
  debug: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  errorObj: (msg: string, err: Error | unknown) => void;
}

/**
 * Create a logger for plugins
 */
export function createPluginLogger(prefix: string): PluginLogger {
  const child = baseLogger.child({ plugin: prefix });
  
  return {
    debug: (msg: string) => child.debug(msg),
    info: (msg: string) => child.info(msg),
    warn: (msg: string) => child.warn(msg),
    error: (msg: string) => child.error(msg),
    errorObj: (msg: string, err: Error | unknown) => child.error({ err }, msg),
  };
}

/**
 * Create a scoped logger for services
 */
export function createServiceLogger(serviceId: string): Logger {
  return baseLogger.child({ service: 'cron', scope: serviceId });
}

/**
 * Log level utilities
 */
export const LogLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal',
  SILENT: 'silent',
} as const;

export type LogLevel = typeof LogLevel[keyof typeof LogLevel];

/**
 * Set the log level dynamically
 */
export function setLogLevel(level: LogLevel): void {
  baseLogger.level = level;
}

/**
 * Get current log level
 */
export function getLogLevel(): string {
  return baseLogger.level;
}

// Re-export pino types for convenience
export type { Logger };

/**
 * Logging Best Practices:
 * 
 * 1. TRACE (development only):
 *    - Function entry/exit
 *    - Variable values during execution
 *    - Loop iterations
 * 
 * 2. DEBUG:
 *    - Detailed troubleshooting info
 *    - Request/response details
 *    - State changes
 * 
 * 3. INFO (default level):
 *    - Service startup/shutdown
 *    - Major state transitions
 *    - Important business events
 *    - Configuration changes
 * 
 * 4. WARN:
 *    - Deprecated feature usage
 *    - Recoverable errors
 *    - Performance issues
 *    - Missing optional configuration
 * 
 * 5. ERROR:
 *    - Failed operations
 *    - Unhandled exceptions
 *    - Data corruption
 *    - External service failures
 * 
 * 6. FATAL:
 *    - System cannot continue
 *    - Critical initialization failure
 *    - Data loss
 */
