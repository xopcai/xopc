/**
 * Logger Configuration
 * Centralized configuration loading from environment variables
 */

import path from 'path';
import type { LoggerConfig, LogLevel } from './types.js';

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

/**
 * Load configuration from environment variables
 */
export function loadConfig(): LoggerConfig {
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

// Singleton config instance
export const config = loadConfig();

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
