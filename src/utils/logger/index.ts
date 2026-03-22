/**
 * Modular Logger System
 * 
 * Production-grade logging with:
 * - Modular architecture
 * - Context tracking
 * - Statistics
 * - Graceful shutdown
 */

import pino from 'pino';
import type { Logger as PinoLogger } from 'pino';
import type { LogLevel, LogContext, ContextualLogger } from '../logger.types.js';

// Internal modules
import { config, getLogDir, getLoggerConfig } from './config.js';
import { initializeStreams } from './streams.js';
import { incrementStats, getLogStats } from './stats.js';
import { isLoggerShuttingDown, flushAndClose, setShuttingDown } from './shutdown.js';
import { rotateLogs, cleanOldLogs } from './rotation.js';
import { mergeContext } from './context.js';

// ============================================
// Base Logger Creation
// ============================================

const customLevels = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const pinoOptions: pino.LoggerOptions = {
  level: config.level,
  base: {
    service: 'xopcbot',
    version: process.env.npm_package_version || '0.1.0',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      host: bindings.host,
    }),
    log: (object) => {
      // Serialize errors with full stack trace
      if (object.err && object.err instanceof Error) {
        object.err = {
          name: object.err.name,
          message: object.err.message,
          stack: object.err.stack,
          cause: object.err.cause instanceof Error 
            ? { name: object.err.cause.name, message: object.err.cause.message, stack: object.err.cause.stack }
            : object.err.cause,
        };
      }
      for (const key of Object.keys(object)) {
        if (object[key] instanceof Error) {
          object[key] = {
            name: object[key].name,
            message: object[key].message,
            stack: object[key].stack,
          };
        }
      }
      return object;
    },
  },
  customLevels,
};

// Add pretty print for development
if (config.prettyPrint) {
  pinoOptions.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,host',
    },
  };
}

const streams = initializeStreams();
const baseLogger = pino(pinoOptions, pino.multistream(streams));

// ============================================
// Contextual Logger
// ============================================

function wrapLogMethod(method: Function, defaultContext: LogContext, level: LogLevel) {
  return function (data: unknown, msg?: string) {
    // During shutdown, only allow error and fatal logs
    if (isLoggerShuttingDown()) {
      if (level !== 'error' && level !== 'fatal') {
        return;
      }
    }
    
    const module = (defaultContext.module || defaultContext.prefix) as string | undefined;
    incrementStats(level, module);
    
    return msg !== undefined ? method.call(this, data, msg) : method.call(this, data);
  };
}

function createProxyLogger(logger: PinoLogger, defaultContext: LogContext = {}): ContextualLogger {
  const proxy = new Proxy(logger, {
    get(target, prop) {
      const propKey = prop as string;
      
      if (prop === 'withContext') {
        return (context: LogContext) => {
          return createProxyLogger(target.child({ ...context }), mergeContext(defaultContext, context));
        };
      }
      if (prop === 'childContext') {
        return (context: LogContext) => {
          return createProxyLogger(target.child({ ...context }), mergeContext(defaultContext, context));
        };
      }
      
      const value = (target as unknown as Record<string, unknown>)[propKey];
      if (typeof value === 'function') {
        if (['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(propKey)) {
          return wrapLogMethod(value, defaultContext, propKey as LogLevel);
        }
      }
      
      return value;
    },
  });

  return proxy as ContextualLogger;
}

// ============================================
// Public API
// ============================================

export const logger = createProxyLogger(baseLogger);

export function createLogger(prefix: string, context?: LogContext): ContextualLogger {
  const child = baseLogger.child({ prefix });
  return createProxyLogger(child, { module: prefix, ...context });
}

export function createModuleLogger(moduleName: string, _modulePath?: string): ContextualLogger {
  const child = baseLogger.child({ module: moduleName });
  return createProxyLogger(child, { module: moduleName });
}

export function createExtensionLogger(extensionName: string): ContextualLogger {
  const child = baseLogger.child({ extension: extensionName });
  return createProxyLogger(child, { extension: extensionName });
}

export function createServiceLogger(serviceId: string): ContextualLogger {
  const child = baseLogger.child({ service: 'cron', scope: serviceId });
  return createProxyLogger(child, { service: 'cron', scope: serviceId });
}

export function createRequestLogger(requestId: string, initialContext?: LogContext): ContextualLogger {
  const context: LogContext = { requestId, ...initialContext };
  const child = baseLogger.child({ requestId });
  return createProxyLogger(child, context);
}

// ============================================
// Log Level Management
// ============================================

export function setLogLevel(level: LogLevel): void {
  baseLogger.level = level;
}

export function getLogLevel(): LogLevel {
  return baseLogger.level as LogLevel;
}

export function withLogLevel<T>(level: LogLevel, fn: () => T): T {
  const previous = baseLogger.level;
  baseLogger.level = level;
  try {
    return fn();
  } finally {
    baseLogger.level = previous;
  }
}

export function isLevelEnabled(level: LogLevel): boolean {
  const levelValues: Record<LogLevel, number> = {
    trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: Number.MAX_VALUE,
  };
  const currentLevelValues: Record<LogLevel, number> = {
    trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: Number.MAX_VALUE,
  };
  return levelValues[level] >= currentLevelValues[getLogLevel()];
}

// ============================================
// Re-exports
// ============================================

export type {
  LogLevel,
  LogContext,
  LogEntry,
  LoggerConfig,
  LogFileMeta,
  LogQuery,
  LogStats,
  RotationResult,
  ContextualLogger,
} from '../logger.types.js';

export {
  // Config
  getLogDir,
  getLoggerConfig,
  
  // Stats
  getLogStats,
  
  // Shutdown
  isLoggerShuttingDown,
  flushAndClose,
  setShuttingDown,
  
  // Rotation
  rotateLogs,
  cleanOldLogs,
};

//  Exporters
export {
  type LogExporter,
  type ExporterConfig,
  type LokiConfig,
  type ElkConfig,
  type DatadogConfig,
  type WebhookConfig,
  initializeExporters,
  exportLog,
  flushExporters,
  getExporters,
} from './exporters.js';

//  Audit Log
export {
  type AuditEvent,
  type AuditEventType,
  type AuditLogConfig,
  logAuditEvent,
  logAuthEvent,
  logConfigChange,
  logPermissionChange,
  logDataAccess,
  configureAuditLog,
  getAuditConfig,
} from './audit.js';

// Backward compatibility
export { logger as default };
export { pino as Pino };
