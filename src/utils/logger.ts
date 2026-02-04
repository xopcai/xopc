/**
 * Logger Module
 * 
 * Centralized logging system using pino.
 * Provides structured logging with levels, prefixes, and child loggers.
 */

import pino, { Logger } from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default log level from environment
const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.DEBUG ? 'debug' : 'info');

// Create the base logger instance
const baseLogger = pino({
  level: LOG_LEVEL,
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  } : undefined,
  base: {
    service: 'xopcbot',
    version: '0.1.0',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Aliases for compatibility
export { baseLogger as logger, pino as Pino };
export { Logger };

/**
 * Create a child logger with a specific prefix
 */
export function createLogger(prefix: string): Logger {
  return baseLogger.child({ prefix });
}

/**
 * Create a logger for a specific module/component
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
