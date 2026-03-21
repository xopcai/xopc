// Backward compatibility layer — import from './logger/index.js' for new code

export {
  logger,
  createLogger,
  createModuleLogger,
  createExtensionLogger,
  createServiceLogger,
  createRequestLogger,
  getLogDir,
  getLoggerConfig,
  getLogStats,
  isLoggerShuttingDown,
  flushAndClose,
  setShuttingDown,
  rotateLogs,
  cleanOldLogs,
  setLogLevel,
  getLogLevel,
  withLogLevel,
  isLevelEnabled,
  initializeExporters,
  exportLog,
  flushExporters,
  getExporters,
  logAuditEvent,
  logAuthEvent,
  logConfigChange,
  logPermissionChange,
  logDataAccess,
  configureAuditLog,
  getAuditConfig,
  Pino,
} from './logger/index.js';

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
  LogExporter,
  ExporterConfig,
  LokiConfig,
  ElkConfig,
  DatadogConfig,
  WebhookConfig,
  AuditEvent,
  AuditEventType,
  AuditLogConfig,
} from './logger/index.js';

export { logger as default } from './logger/index.js';
export { logger as baseLogger } from './logger/index.js';

export function registerShutdownHandler(): void {}

export {
  setRequestContext as setRequestLogger,
  clearRequestContext as clearRequestLogger,
} from './logger/context.js';
