/**
 * Session tracking and cleanup module
 * 
 * Manages session state, usage statistics, and memory cleanup
 * to prevent memory leaks in long-running agent instances.
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('SessionTracker');

export interface SessionUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface SessionTrackerConfig {
  /** Max sessions to keep in memory */
  maxSessions?: number;
  /** Session TTL in milliseconds */
  sessionTtlMs?: number;
  /** Cleanup interval in milliseconds */
  cleanupIntervalMs?: number;
}

export class SessionTracker {
  private sessionUsage: Map<string, SessionUsage> = new Map();
  private sessionLastActivity: Map<string, number> = new Map();
  private sessionModels: Map<string, string> = new Map(); // sessionKey -> modelId
  private cleanupInterval?: NodeJS.Timeout;
  
  private readonly maxSessions: number;
  private readonly sessionTtlMs: number;
  private readonly cleanupIntervalMs: number;

  constructor(config: SessionTrackerConfig = {}) {
    this.maxSessions = config.maxSessions ?? 1000;
    this.sessionTtlMs = config.sessionTtlMs ?? 30 * 60 * 1000; // 30 minutes
    this.cleanupIntervalMs = config.cleanupIntervalMs ?? 5 * 60 * 1000; // 5 minutes
    
    this.startCleanupInterval();
  }

  /**
   * Start periodic cleanup of inactive sessions
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveSessions();
    }, this.cleanupIntervalMs);
  }

  /**
   * Cleanup inactive sessions to prevent memory leak
   */
  private cleanupInactiveSessions(): void {
    const now = Date.now();
    const sessionsToDelete: string[] = [];
    let deletedCount = 0;

    // Find expired sessions
    for (const [sessionKey, lastActivity] of this.sessionLastActivity) {
      if (now - lastActivity > this.sessionTtlMs) {
        sessionsToDelete.push(sessionKey);
      }
    }

    // Delete expired sessions
    for (const sessionKey of sessionsToDelete) {
      this.sessionUsage.delete(sessionKey);
      this.sessionLastActivity.delete(sessionKey);
      this.sessionModels.delete(sessionKey);
      deletedCount++;
    }

    // If still over limit, remove oldest
    if (this.sessionUsage.size > this.maxSessions) {
      const sorted = Array.from(this.sessionLastActivity.entries())
        .sort((a, b) => a[1] - b[1]);
      
      const toRemove = sorted.slice(0, this.sessionUsage.size - this.maxSessions);
      for (const [sessionKey] of toRemove) {
        this.sessionUsage.delete(sessionKey);
        this.sessionLastActivity.delete(sessionKey);
        this.sessionModels.delete(sessionKey);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      log.info({ deleted: deletedCount, remaining: this.sessionUsage.size }, 'Cleaned up inactive sessions');
    }
  }

  /**
   * Update last activity timestamp for a session
   */
  touchSession(sessionKey: string): void {
    this.sessionLastActivity.set(sessionKey, Date.now());
  }

  /**
   * Get usage for a session
   */
  getUsage(sessionKey: string): SessionUsage | undefined {
    return this.sessionUsage.get(sessionKey);
  }

  /**
   * Update usage for a session
   */
  updateUsage(sessionKey: string, usage: Partial<SessionUsage>): void {
    const current = this.sessionUsage.get(sessionKey) ?? { prompt: 0, completion: 0, total: 0 };
    
    if (usage.prompt !== undefined) current.prompt += usage.prompt;
    if (usage.completion !== undefined) current.completion += usage.completion;
    if (usage.total !== undefined) current.total += usage.total;
    
    this.sessionUsage.set(sessionKey, current);
    this.touchSession(sessionKey);
  }

  /**
   * Set model for a session
   */
  setModel(sessionKey: string, modelId: string): void {
    this.sessionModels.set(sessionKey, modelId);
    this.touchSession(sessionKey);
  }

  /**
   * Get model for a session
   */
  getModel(sessionKey: string): string | undefined {
    return this.sessionModels.get(sessionKey);
  }

  /**
   * Get all session keys
   */
  getSessionKeys(): string[] {
    return Array.from(this.sessionUsage.keys());
  }

  /**
   * Get total session count
   */
  getSessionCount(): number {
    return this.sessionUsage.size;
  }

  /**
   * Delete a session
   */
  deleteSession(sessionKey: string): boolean {
    const hadUsage = this.sessionUsage.delete(sessionKey);
    this.sessionLastActivity.delete(sessionKey);
    this.sessionModels.delete(sessionKey);
    return hadUsage;
  }

  /**
   * Dispose resources (call on shutdown)
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }
}
