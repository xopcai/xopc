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
import type { LogLevel, LogContext, ContextualLogger } from './types.js';

// Internal modules
import { config, getLogDir, getLoggerConfig } from './config.js';
import { initializeStreams } from './streams.js';
import { incrementStats, getRuntimeLogStats } from './stats.js';
import { isLoggerShuttingDown, flushAndClose, setShuttingDown } from './shutdown.js';
import { rotateLogs, cleanOldLogs } from './rotation.js';
import { getAsyncLogContext, getAsyncLogCorrelationKeys, mergeContext } from './context.js';
import { redactLogRecord } from './redact.js';
import { PACKAGE_VERSION } from '../../package-version.js';

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
    service: 'xopc',
    version: process.env.npm_package_version || PACKAGE_VERSION,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  mixin(mergeObject, _level, logger) {
    const ctx = getAsyncLogContext();
    if (!ctx) return {};
    const bindings =
      logger && typeof logger.bindings === 'function'
        ? (logger.bindings() as Record<string, unknown>)
        : {};
    const mo = mergeObject as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of getAsyncLogCorrelationKeys()) {
      const v = ctx[key];
      if (v === undefined || v === '') continue;
      if (mo[key] !== undefined) continue;
      if (bindings[key] !== undefined) continue;
      out[key] = v;
    }
    return out;
  },
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
      return redactLogRecord(object as Record<string, unknown>);
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
    
    const module = defaultContext.module as string | undefined;
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

export function createLogger(module: string, context?: LogContext): ContextualLogger {
  const child = baseLogger.child({ module });
  return createProxyLogger(child, { module, ...context });
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
  return levelValues[level] >= levelValues[getLogLevel()];
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
} from './types.js';

export {
  // Config
  getLogDir,
  getLoggerConfig,
  
  // Stats
  getRuntimeLogStats,
  
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

export {
  redactSensitiveInfo,
  redactObject,
  redactPemBlock,
  redactSecret,
  isLogRedactionEnabled,
} from './redact.js';

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

export { logger as baseLogger };
export { pino as Pino };

export {
  runWithLogContext,
  getAsyncLogContext,
  updateAsyncLogContext,
  inboundCorrelationMetadataFromAsyncLogContext,
} from './context.js';
