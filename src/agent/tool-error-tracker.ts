/**
 * Tool Error Tracker - Tracks tool failures per session/turn
 * 
 * Prevents agent from getting stuck in tool failure loops by:
 * - Counting failures per tool
 * - Tracking total failures
 * - Providing retry hints to agent
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('ToolErrorTracker');

export interface ToolFailureRecord {
  toolName: string;
  failureCount: number;
  lastError?: string;
  lastErrorTime: number;
}

export interface ToolErrorTrackerConfig {
  maxFailuresPerTool: number;    // Max failures per individual tool (default: 3)
  maxTotalFailures: number;      // Max total failures across all tools (default: 5)
  resetOnTurnEnd: boolean;       // Reset counters at end of each turn (default: true)
  failureWindowMs: number;       // Time window for counting failures (default: 5 min)
}

const DEFAULT_CONFIG: ToolErrorTrackerConfig = {
  maxFailuresPerTool: 3,
  maxTotalFailures: 5,
  resetOnTurnEnd: true,
  failureWindowMs: 5 * 60 * 1000, // 5 minutes
};

export class ToolErrorTracker {
  private failures: Map<string, ToolFailureRecord> = new Map();
  private totalFailures = 0;
  private config: ToolErrorTrackerConfig;

  constructor(config: Partial<ToolErrorTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a tool failure
   */
  recordFailure(toolName: string, error?: string): void {
    const now = Date.now();
    const existing = this.failures.get(toolName);

    if (existing) {
      existing.failureCount++;
      existing.lastError = error;
      existing.lastErrorTime = now;
    } else {
      this.failures.set(toolName, {
        toolName,
        failureCount: 1,
        lastError: error,
        lastErrorTime: now,
      });
    }

    this.totalFailures++;

    log.warn(
      { toolName, failures: this.getFailureCount(toolName), total: this.totalFailures },
      'Tool failure recorded'
    );
  }

  /**
   * Get failure count for a specific tool
   */
  getFailureCount(toolName: string): number {
    return this.failures.get(toolName)?.failureCount || 0;
  }

  /**
   * Get remaining attempts for a tool
   */
  remainingAttempts(toolName: string): number {
    const current = this.getFailureCount(toolName);
    return Math.max(0, this.config.maxFailuresPerTool - current);
  }

  /**
   * Check if a specific tool has reached its failure limit
   */
  isToolLimitReached(toolName: string): boolean {
    return this.getFailureCount(toolName) >= this.config.maxFailuresPerTool;
  }

  /**
   * Check if total failure limit is reached
   */
  isTotalLimitReached(): boolean {
    return this.totalFailures >= this.config.maxTotalFailures;
  }

  /**
   * Check if any limit is reached (tool-specific or total)
   */
  isAnyLimitReached(): boolean {
    return this.isTotalLimitReached() || 
           Array.from(this.failures.keys()).some(name => this.isToolLimitReached(name));
  }

  /**
   * Get the tool that has reached its limit (if any)
   */
  getLimitReachedTool(): string | null {
    for (const [name, record] of this.failures.entries()) {
      if (record.failureCount >= this.config.maxFailuresPerTool) {
        return name;
      }
    }
    return null;
  }

  /**
   * Get failure hint message for agent
   */
  getFailureHint(toolName: string): string {
    const remaining = this.remainingAttempts(toolName);
    const totalRemaining = this.config.maxTotalFailures - this.totalFailures;

    if (remaining === 0) {
      return `⚠️ Tool '${toolName}' has failed ${this.config.maxFailuresPerTool} times. Do not retry this tool.`;
    }

    if (totalRemaining === 0) {
      return `⚠️ Total failure limit (${this.config.maxTotalFailures}) reached. Stop executing tools.`;
    }

    return `⚠️ '${toolName}' has failed ${this.getFailureCount(toolName)} times. Remaining attempts: ${remaining}/${this.config.maxFailuresPerTool}`;
  }

  /**
   * Get all failure records
   */
  getFailures(): Map<string, ToolFailureRecord> {
    return new Map(this.failures);
  }

  /**
   * Get summary of failures
   */
  getSummary(): { total: number; byTool: Record<string, number> } {
    const byTool: Record<string, number> = {};
    for (const [name, record] of this.failures.entries()) {
      byTool[name] = record.failureCount;
    }
    return { total: this.totalFailures, byTool };
  }

  /**
   * Reset all counters (called at end of turn)
   */
  reset(): void {
    if (!this.config.resetOnTurnEnd) return;

    // Clean up old failures first (memory optimization)
    this.cleanupOldFailures();

    const summary = this.getSummary();
    if (summary.total > 0) {
      log.info({ summary }, 'Tool error tracker reset');
    }

    this.failures.clear();
    this.totalFailures = 0;
  }

  /**
   * Reset failures for a specific tool
   */
  resetTool(toolName: string): void {
    if (this.failures.has(toolName)) {
      const record = this.failures.get(toolName)!;
      // Protect against negative totalFailures
      this.totalFailures = Math.max(0, this.totalFailures - record.failureCount);
      this.failures.delete(toolName);
      log.debug({ toolName }, 'Tool failure counter reset');
    }
  }

  /**
   * Get tracker configuration
   */
  getConfig(): ToolErrorTrackerConfig {
    return { ...this.config };
  }

  /**
   * Clean up old failures (outside the failure window)
   */
  cleanupOldFailures(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [name, record] of this.failures.entries()) {
      if (now - record.lastErrorTime > this.config.failureWindowMs) {
        this.totalFailures -= record.failureCount;
        this.failures.delete(name);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.debug({ cleaned }, 'Cleaned up old tool failures');
    }
  }
}
