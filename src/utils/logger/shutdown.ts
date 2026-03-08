/**
 * Logger Shutdown
 * Graceful shutdown handling
 */

import { closeStreams } from './streams.js';

let isShuttingDown = false;
let shutdownHandler: (() => Promise<void>) | null = null;

/**
 * Check if logger is shutting down
 */
export function isLoggerShuttingDown(): boolean {
  return isShuttingDown;
}

/**
 * Set shutdown state
 */
export function setShuttingDown(value: boolean): void {
  isShuttingDown = value;
}

/**
 * Flush and close all streams
 * Must be called before process exit
 */
export async function flushAndClose(): Promise<void> {
  isShuttingDown = true;
  
  try {
    await closeStreams();
  } catch {
    // Ignore errors during shutdown
  }
}

/**
 * Register shutdown handlers
 */
export function registerShutdownHandler(): void {
  if (shutdownHandler) return;

  shutdownHandler = async () => {
    await flushAndClose();
  };

  process.on('SIGINT', shutdownHandler);
  process.on('SIGTERM', shutdownHandler);
  process.on('exit', () => {
    if (shutdownHandler) {
      shutdownHandler();
    }
  });
}

// Auto-register on import
registerShutdownHandler();
