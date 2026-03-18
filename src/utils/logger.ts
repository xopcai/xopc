/**
 * Logger Module - Backward Compatibility Layer
 * 
 * This file re-exports from the new modular logger system.
 * New code should import from './logger/index.js' instead.
 * 
 * @deprecated Use './logger/index.js' for new code
 */

// Re-export everything from the modular logger
export {
  // Core
  logger,
  createLogger,
  createModuleLogger,
  createExtensionLogger,
  createServiceLogger,
  createRequestLogger,
  
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
  
  // Level management
  setLogLevel,
  getLogLevel,
  withLogLevel,
  isLevelEnabled,
  
  // Types
  type LogLevel,
  type LogContext,
  type LogEntry,
  type LoggerConfig,
  type LogFileMeta,
  type LogQuery,
  type LogStats,
  type RotationResult,
  type ContextualLogger,
  
  //  Exporters
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
  
  //  Audit Log
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
  
  // Pino re-export
  Pino,
} from './logger/index.js';

// Default export for backward compatibility
import { logger } from './logger/index.js';
export { logger as default };

// Legacy compatibility exports
export { 
  logger as baseLogger,
};

// Legacy: registerShutdownHandler is now auto-registered
// This is a no-op for backward compatibility
export function registerShutdownHandler(): void {
  // Shutdown handler is auto-registered in the new module
}

// Legacy: context store functions
export {
  setRequestContext as setRequestLogger,
  clearRequestContext as clearRequestLogger,
  getRequestContext,
} from './logger/context.js';
