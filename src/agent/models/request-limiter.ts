/**
 * Request Limiter - Controls agent request rate per turn
 * 
 * Prevents agent from making too many LLM calls in a single turn by:
 * - Counting requests per session/turn
 * - Enforcing configurable limits
 * - Providing graceful degradation when limits are reached
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('RequestLimiter');

export interface RequestLimiterConfig {
  maxRequestsPerTurn: number;      // Max requests per turn (default: 50)
  warnThreshold: number;           // Warn when approaching limit (default: 80%)
  softLimit: boolean;              // Soft limit (warn but continue) or hard limit (stop) (default: false)
}

const DEFAULT_CONFIG: RequestLimiterConfig = {
  maxRequestsPerTurn: 50,
  warnThreshold: 0.8, // 80%
  softLimit: false,
};

export interface RequestLimitResult {
  allowed: boolean;
  count: number;
  remaining: number;
  limit: number;
  isWarning: boolean;
  shouldStop: boolean;
}

export class RequestLimiter {
  private requestCount = 0;
  private config: RequestLimiterConfig;
  private turnStartTime: number = Date.now();

  constructor(config: Partial<RequestLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a request and check if it's allowed
   */
  recordRequest(): RequestLimitResult {
    this.requestCount++;
    const remaining = Math.max(0, this.config.maxRequestsPerTurn - this.requestCount);
    const usagePercent = this.requestCount / this.config.maxRequestsPerTurn;
    const isWarning = usagePercent >= this.config.warnThreshold;
    const shouldStop = !this.config.softLimit && this.requestCount >= this.config.maxRequestsPerTurn;

    const result: RequestLimitResult = {
      allowed: !shouldStop,
      count: this.requestCount,
      remaining,
      limit: this.config.maxRequestsPerTurn,
      isWarning,
      shouldStop,
    };

    if (isWarning) {
      log.warn(
        { count: this.requestCount, limit: this.config.maxRequestsPerTurn, remaining },
        'Approaching request limit'
      );
    }

    if (shouldStop) {
      log.error(
        { count: this.requestCount, limit: this.config.maxRequestsPerTurn },
        'Request limit reached'
      );
    }

    return result;
  }

  /**
   * Check current request status without recording
   */
  getStatus(): RequestLimitResult {
    const remaining = Math.max(0, this.config.maxRequestsPerTurn - this.requestCount);
    const usagePercent = this.requestCount / this.config.maxRequestsPerTurn;
    const isWarning = usagePercent >= this.config.warnThreshold;
    const shouldStop = !this.config.softLimit && this.requestCount >= this.config.maxRequestsPerTurn;

    return {
      allowed: !shouldStop,
      count: this.requestCount,
      remaining,
      limit: this.config.maxRequestsPerTurn,
      isWarning,
      shouldStop,
    };
  }

  /**
   * Get current request count
   */
  getCount(): number {
    return this.requestCount;
  }

  /**
   * Get remaining requests
   */
  getRemaining(): number {
    return Math.max(0, this.config.maxRequestsPerTurn - this.requestCount);
  }

  /**
   * Check if limit is reached
   */
  isLimitReached(): boolean {
    return this.requestCount >= this.config.maxRequestsPerTurn;
  }

  /**
   * Check if approaching limit (warning threshold)
   */
  isApproachingLimit(): boolean {
    return this.requestCount >= this.config.maxRequestsPerTurn * this.config.warnThreshold;
  }

  /**
   * Get usage percentage
   */
  getUsagePercent(): number {
    if (this.config.maxRequestsPerTurn <= 0) {
      return 1.0; // Treat as full if limit is zero or negative
    }
    return this.requestCount / this.config.maxRequestsPerTurn;
  }

  /**
   * Get warning message for agent
   */
  getWarningMessage(): string | null {
    const status = this.getStatus();
    
    if (status.shouldStop) {
      return `⚠️ Request limit reached (${this.requestCount}/${this.config.maxRequestsPerTurn}). Stopping execution.`;
    }
    
    if (status.isWarning) {
      return `⚠️ Approaching request limit (${this.requestCount}/${this.config.maxRequestsPerTurn}). Remaining: ${status.remaining}`;
    }
    
    return null;
  }

  /**
   * Reset counter (called at end of turn)
   */
  reset(): void {
    if (this.requestCount > 0) {
      log.info(
        { count: this.requestCount, duration: Date.now() - this.turnStartTime },
        'Request limiter reset'
      );
    }
    this.requestCount = 0;
    this.turnStartTime = Date.now();
  }

  /**
   * Manually adjust count (for testing or special cases)
   */
  setCount(count: number): void {
    this.requestCount = Math.max(0, count);
  }

  /**
   * Get turn duration in milliseconds
   */
  getTurnDuration(): number {
    return Date.now() - this.turnStartTime;
  }

  /**
   * Get stats for reporting
   */
  getStats(): {
    count: number;
    limit: number;
    remaining: number;
    usagePercent: number;
    turnDurationMs: number;
    isWarning: boolean;
    isLimitReached: boolean;
  } {
    return {
      count: this.requestCount,
      limit: this.config.maxRequestsPerTurn,
      remaining: this.getRemaining(),
      usagePercent: this.getUsagePercent(),
      turnDurationMs: this.getTurnDuration(),
      isWarning: this.isApproachingLimit(),
      isLimitReached: this.isLimitReached(),
    };
  }
}
