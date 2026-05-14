/**
 * Structured logger for the xopc browser extension.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_COLORS: Record<LogLevel, string> = {
  debug: 'color: #888',
  info: 'color: #3b82f6',
  warn: 'color: #f59e0b',
  error: 'color: #ef4444',
};

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export function createLogger(prefix: string): Logger {
  function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString().slice(11, 23);
    const formatted = `[${timestamp}] [${prefix}] ${message}`;

    if (data && Object.keys(data).length > 0) {
      console[level](`%c${formatted}`, LOG_COLORS[level], data);
    } else {
      console[level](`%c${formatted}`, LOG_COLORS[level]);
    }
  }

  return {
    debug: (msg, data) => log('debug', msg, data),
    info: (msg, data) => log('info', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    error: (msg, data) => log('error', msg, data),
  };
}
