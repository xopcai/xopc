/**
 * Logger Module - Optimized Version
 *
 * Centralized logging system using pino with enhanced features:
 * - Contextual logging with requestId/sessionId tracking
 * - Log rotation with automatic cleanup
 * - Sampling for high-frequency debug logs
 * - Async logging with proper flush on shutdown
 * - Unified configuration via XOPCBOT_* environment variables
 *
 * Log Levels (in order of severity):
 * - trace:   Most detailed, for development debugging only
 * - debug:   Detailed info for troubleshooting (supports sampling)
 * - info:    General operational events (startup, shutdown, major state changes)
 * - warn:    Unexpected but non-fatal issues
 * - error:   Errors that affect functionality
 * - fatal:   Critical errors that prevent operation
 */

import pino from 'pino';
import type { Logger as PinoLogger, ChildLoggerOptions, DestinationStream } from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, createWriteStream, unlinkSync, readdirSync, statSync, readFileSync } from 'fs';
import { gzip } from 'zlib';
import { promisify } from 'util';
import type { 
  LogLevel, 
  LogContext, 
  ContextualLogger, 
  LoggerConfig,
  RotationResult 
} from './logger.types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compressAsync = promisify(gzip);

// ============================================
// Configuration
// ============================================

const DEFAULT_CONFIG: LoggerConfig = {
  level: 'info',
  logDir: path.join(process.env.HOME || '.', '.xopcbot', 'logs'),
  consoleOutput: true,
  fileOutput: true,
  errorFileOutput: true,
  retentionDays: 7,
  maxFileSizeMB: 100,
  prettyPrint: false,
  async: true,
  debugSampleRate: 1.0,
};

function loadConfig(): LoggerConfig {
  const config: LoggerConfig = { ...DEFAULT_CONFIG };

  // Log level - unified environment variable
  const logLevel = process.env.XOPCBOT_LOG_LEVEL || process.env.LOG_LEVEL;
  if (logLevel) {
    config.level = logLevel.toLowerCase() as LogLevel;
  } else if (process.env.DEBUG) {
    config.level = 'debug';
  }

  // Log directory
  if (process.env.XOPCBOT_LOG_DIR) {
    config.logDir = process.env.XOPCBOT_LOG_DIR;
  }

  // Output options
  if (process.env.XOPCBOT_LOG_CONSOLE === 'false') {
    config.consoleOutput = false;
  }
  if (process.env.XOPCBOT_LOG_FILE === 'false') {
    config.fileOutput = false;
  }

  // Retention
  if (process.env.XOPCBOT_LOG_RETENTION_DAYS) {
    config.retentionDays = parseInt(process.env.XOPCBOT_LOG_RETENTION_DAYS, 10);
  }

  // Pretty print for development
  if (process.env.NODE_ENV === 'development' || process.env.XOPCBOT_PRETTY_LOGS === 'true') {
    config.prettyPrint = true;
  }

  return config;
}

const config = loadConfig();

// Ensure log directory exists
if (!existsSync(config.logDir)) {
  mkdirSync(config.logDir, { recursive: true });
}

// ============================================
// Log File Management
// ============================================

function getLogPath(type: 'app' | 'error' | 'audit' | 'access' = 'app', date: Date = new Date()): string {
  const dateStr = date.toISOString().split('T')[0];
  return path.join(config.logDir, `${type}-${dateStr}.log`);
}

function getCompressedLogPath(originalPath: string): string {
  return `${originalPath}.gz`;
}

function createLogStream(filePath: string): ReturnType<typeof createWriteStream> {
  return createWriteStream(filePath, { flags: 'a', encoding: 'utf-8' });
}

// Create streams
const streams: Array<{ stream: DestinationStream | NodeJS.WriteStream; level: LogLevel }> = [];

if (config.consoleOutput) {
  streams.push({
    stream: process.stdout as unknown as DestinationStream,
    level: config.level,
  });
}

if (config.fileOutput) {
  streams.push({
    stream: createLogStream(getLogPath('app')) as unknown as DestinationStream,
    level: config.level,
  });
}

if (config.errorFileOutput) {
  streams.push({
    stream: createLogStream(getLogPath('error')) as unknown as DestinationStream,
    level: 'error',
  });
}

// ============================================
// Custom Log Levels with Sampling
// ============================================

const customLevels = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

// ============================================
// Base Logger Creation
// ============================================

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

const baseLogger = pino(pinoOptions, pino.multistream(streams));

// ============================================
// Context Tracking
// ============================================

const contextStore = new Map<string, LogContext>();

function mergeContext(base: LogContext, additional: LogContext): LogContext {
  return { ...base, ...additional };
}

function createProxyLogger(logger: PinoLogger, defaultContext: LogContext = {}): ContextualLogger {
  const contextRef = { current: defaultContext };

  const proxy = new Proxy(logger, {
    get(target, prop) {
      const propKey = prop as keyof PinoLogger | 'withContext' | 'childContext';
      
      if (prop === 'withContext') {
        return (context: LogContext) => {
          contextRef.current = mergeContext(contextRef.current, context);
          return proxy;
        };
      }
      if (prop === 'childContext') {
        return (context: LogContext) => {
          const merged = mergeContext(contextRef.current, context);
          const child = target.child({ ...merged });
          return createProxyLogger(child, merged);
        };
      }
      return (target as unknown as Record<string | symbol, unknown>)[propKey as string];
    },
  });

  // Wrap logging methods to inject context
  const wrappedLogger = proxy as ContextualLogger;
  
  return wrappedLogger;
}

// ============================================
// Public API
// ============================================

export const logger = createProxyLogger(baseLogger);
export { pino as Pino };

/**
 * Create a child logger with a specific prefix/context
 */
export function createLogger(prefix: string, context?: LogContext): ContextualLogger {
  const child = baseLogger.child({ prefix });
  return createProxyLogger(child, { module: prefix, ...context });
}

/**
 * Create a logger for a specific module/component
 */
export function createModuleLogger(moduleName: string, modulePath?: string): ContextualLogger {
  const base = modulePath 
    ? path.relative(path.join(__dirname, '..'), modulePath).replace(/\.ts$/, '')
    : moduleName;
  const child = baseLogger.child({ module: base });
  return createProxyLogger(child, { module: base });
}

/**
 * Create a logger for plugins with consistent interface
 */
export function createPluginLogger(pluginName: string): ContextualLogger {
  const child = baseLogger.child({ plugin: pluginName });
  return createProxyLogger(child, { plugin: pluginName });
}

/**
 * Create a logger for cron services
 */
export function createServiceLogger(serviceId: string): ContextualLogger {
  const child = baseLogger.child({ service: 'cron', scope: serviceId });
  return createProxyLogger(child, { service: 'cron', scope: serviceId });
}

/**
 * Create a request-scoped logger with tracking ID
 */
export function createRequestLogger(requestId: string, initialContext?: LogContext): ContextualLogger {
  const context: LogContext = { requestId, ...initialContext };
  contextStore.set(requestId, context);
  
  const child = baseLogger.child({ requestId });
  const proxy = createProxyLogger(child, context);
  
  return proxy;
}

/**
 * Remove request context when done
 */
export function clearRequestContext(requestId: string): void {
  contextStore.delete(requestId);
}

/**
 * Get context for a request ID
 */
export function getRequestContext(requestId: string): LogContext | undefined {
  return contextStore.get(requestId);
}

// ============================================
// Log Level Management
// ============================================

export { LogLevel };

export function setLogLevel(level: LogLevel): void {
  baseLogger.level = level;
}

export function getLogLevel(): LogLevel {
  return baseLogger.level as LogLevel;
}

/**
 * Temporarily change log level for a block of code
 */
export function withLogLevel<T>(level: LogLevel, fn: () => T): T {
  const previous = baseLogger.level;
  baseLogger.level = level;
  try {
    return fn();
  } finally {
    baseLogger.level = previous;
  }
}

// ============================================
// Log Rotation
// ============================================

/**
 * Rotate logs if they exceed max size
 */
export async function rotateLogs(): Promise<RotationResult> {
  const result: RotationResult = {
    rotated: 0,
    deleted: 0,
    compressed: 0,
    errors: [],
  };

  try {
    const files = readdirSync(config.logDir);
    const maxSizeBytes = config.maxFileSizeMB * 1024 * 1024;

    for (const file of files) {
      if (!file.endsWith('.log') || file.endsWith('.gz')) continue;

      const filePath = path.join(config.logDir, file);
      const stats = statSync(filePath);

      if (stats.size >= maxSizeBytes) {
        // Rotate: compress and create new file
        const compressedPath = getCompressedLogPath(filePath);
        
        try {
          const content = readFileSync(filePath);
          const compressed = await compressAsync(content);
          // Write compressed file
          const { writeFile } = await import('fs/promises');
          await writeFile(compressedPath, compressed);
          unlinkSync(filePath);
          result.compressed++;
          result.rotated++;
        } catch (err) {
          result.errors.push(`Failed to compress ${file}: ${err}`);
        }
      }
    }
  } catch (err) {
    result.errors.push(`Rotation failed: ${err}`);
  }

  return result;
}

/**
 * Clean old logs based on retention policy
 */
export function cleanOldLogs(keepDays: number = config.retentionDays): RotationResult {
  const result: RotationResult = {
    rotated: 0,
    deleted: 0,
    compressed: 0,
    errors: [],
  };

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keepDays);

    const files = readdirSync(config.logDir);

    for (const file of files) {
      if (!file.endsWith('.log') && !file.endsWith('.log.gz')) continue;

      const filePath = path.join(config.logDir, file);
      const stats = statSync(filePath);

      if (new Date(stats.mtime) < cutoff) {
        try {
          unlinkSync(filePath);
          result.deleted++;
        } catch (err) {
          result.errors.push(`Failed to delete ${file}: ${err}`);
        }
      }
    }
  } catch (err) {
    result.errors.push(`Cleanup failed: ${err}`);
  }

  return result;
}

/**
 * Get current log directory
 */
export function getLogDir(): string {
  return config.logDir;
}

/**
 * Get logger configuration
 */
export function getLoggerConfig(): Readonly<LoggerConfig> {
  return { ...config };
}

// ============================================
// Graceful Shutdown
// ============================================

let shutdownHandler: (() => Promise<void>) | null = null;

/**
 * Register shutdown handler to flush logs
 */
export function registerShutdownHandler(): void {
  if (shutdownHandler) return;

  shutdownHandler = async () => {
    try {
      // Flush any pending logs
      await new Promise<void>((resolve) => {
        baseLogger.flush();
        setTimeout(resolve, 100);
      });
    } catch {
      // Ignore flush errors on shutdown
    }
  };

  process.on('SIGINT', shutdownHandler);
  process.on('SIGTERM', shutdownHandler);
  process.on('exit', () => {
    if (shutdownHandler) {
      shutdownHandler();
    }
  });
}

// Auto-register shutdown handler
registerShutdownHandler();

// ============================================
// Utilities
// ============================================

/**
 * Check if a log level is enabled
 */
export function isLevelEnabled(level: LogLevel): boolean {
  const levelValue = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60,
    silent: Number.MAX_VALUE,
  }[level];

  const currentLevelValue = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60,
    silent: Number.MAX_VALUE,
  }[getLogLevel()];

  return levelValue >= currentLevelValue;
}

/**
 * Log with sampling (for high-frequency debug logs)
 */
export function logWithSample(
  logger: ContextualLogger,
  level: LogLevel,
  sampleRate: number,
  message: string,
  data?: unknown
): void {
  if (Math.random() > sampleRate) return;
  
  switch (level) {
    case 'trace':
      logger.trace(data, message);
      break;
    case 'debug':
      logger.debug(data, message);
      break;
    case 'info':
      logger.info(data, message);
      break;
    case 'warn':
      logger.warn(data, message);
      break;
    case 'error':
      logger.error(data, message);
      break;
    case 'fatal':
      logger.fatal(data, message);
      break;
  }
}

// ============================================
// Re-exports
// ============================================

export type { ContextualLogger as Logger, LogContext } from './logger.types.js';

/**
 * Logging Best Practices:
 * 
 * 1. TRACE (development only):
 *    - Function entry/exit with parameters
 *    - Variable values during execution
 *    - Loop iterations and detailed state
 * 
 * 2. DEBUG:
 *    - Detailed troubleshooting information
 *    - Request/response payloads (sanitized)
 *    - State transitions and decisions
 *    - Use sampling for high-frequency logs
 * 
 * 3. INFO (default level):
 *    - Service startup/shutdown
 *    - Major state transitions
 *    - Important business events
 *    - Configuration changes
 *    - User actions (login, logout, etc.)
 * 
 * 4. WARN:
 *    - Deprecated feature usage
 *    - Recoverable errors with fallback
 *    - Performance degradation
 *    - Missing optional configuration
 *    - Rate limit approaching
 * 
 * 5. ERROR:
 *    - Failed operations with impact
 *    - Unhandled exceptions
 *    - Data validation failures
 *    - External service failures
 *    - Always include error context
 * 
 * 6. FATAL:
 *    - System cannot continue operating
 *    - Critical initialization failure
 *    - Data corruption detected
 *    - Requires immediate attention
 */
