/**
 * Log Statistics
 * Track log counts by level and module
 */

import type { LogLevel } from '../logger.types.js';

interface StatsData {
  byLevel: Record<LogLevel, number>;
  byModule: Map<string, number>;
  errorsLast24h: number;
  lastErrorTime: number;
  startTime: number;
}

const stats: StatsData = {
  byLevel: { trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0, silent: 0 },
  byModule: new Map(),
  errorsLast24h: 0,
  lastErrorTime: 0,
  startTime: Date.now(),
};

/**
 * Increment statistics for a log entry
 */
export function incrementStats(level: LogLevel, module?: string): void {
  stats.byLevel[level]++;
  
  if (module) {
    const current = stats.byModule.get(module) || 0;
    stats.byModule.set(module, current + 1);
  }
  
  if (level === 'error' || level === 'fatal') {
    const now = Date.now();
    if (now - stats.lastErrorTime > 24 * 60 * 60 * 1000) {
      stats.errorsLast24h = 0;
    }
    stats.errorsLast24h++;
    stats.lastErrorTime = now;
  }
}

/**
 * Get current statistics
 */
export function getLogStats() {
  return {
    byLevel: { ...stats.byLevel },
    byModule: Object.fromEntries(stats.byModule),
    errorsLast24h: stats.errorsLast24h,
    uptimeMs: Date.now() - stats.startTime,
  };
}

/**
 * Reset statistics (for testing)
 */
export function resetStats(): void {
  stats.byLevel = { trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0, silent: 0 };
  stats.byModule.clear();
  stats.errorsLast24h = 0;
  stats.lastErrorTime = 0;
  stats.startTime = Date.now();
}
