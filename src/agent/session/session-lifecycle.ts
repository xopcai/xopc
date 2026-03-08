/**
 * Session Lifecycle Manager - Manages session lifecycle events
 *
 * Handles session start, end, and related lifecycle operations.
 */

import type { SessionStore } from '../../session/index.js';
import type { SessionTracker } from '../session-tracker.js';
import type { LifecycleManager } from '../lifecycle/index.js';
import type { SessionContext } from './session-context.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('SessionLifecycleManager');

export interface SessionLifecycleEvents {
  onSessionStart?: (context: SessionContext) => void | Promise<void>;
  onSessionEnd?: (context: SessionContext, stats: SessionStats) => void | Promise<void>;
}

export interface SessionStats {
  messageCount: number;
  durationMs?: number;
}

export class SessionLifecycleManager {
  private sessionStore: SessionStore;
  private sessionTracker: SessionTracker;
  private lifecycleManager: LifecycleManager;
  private events: SessionLifecycleEvents;
  private sessionStartTimes: Map<string, number> = new Map();

  constructor(
    sessionStore: SessionStore,
    sessionTracker: SessionTracker,
    lifecycleManager: LifecycleManager,
    events: SessionLifecycleEvents = {}
  ) {
    this.sessionStore = sessionStore;
    this.sessionTracker = sessionTracker;
    this.lifecycleManager = lifecycleManager;
    this.events = events;
  }

  /**
   * Start a session and emit lifecycle events
   */
  async startSession(context: SessionContext): Promise<void> {
    const { sessionKey } = context;
    
    log.debug({ sessionKey }, 'Starting session');
    
    // Touch session in tracker
    this.sessionTracker.touchSession(sessionKey);
    
    // Record start time
    this.sessionStartTimes.set(sessionKey, Date.now());
    
    // Emit session start event
    await this.lifecycleManager.emit('session_start', sessionKey, {
      channel: context.channel,
      chatId: context.chatId,
      senderId: context.senderId,
      isGroup: context.isGroup,
    }, context);
    
    // Call custom handler if provided
    if (this.events.onSessionStart) {
      await this.events.onSessionStart(context);
    }
  }

  /**
   * End a session and emit lifecycle events
   */
  async endSession(context: SessionContext): Promise<void> {
    const { sessionKey } = context;
    
    log.debug({ sessionKey }, 'Ending session');
    
    // Calculate stats
    const messageCount = await this.getMessageCount(sessionKey);
    const startTime = this.sessionStartTimes.get(sessionKey);
    const durationMs = startTime ? Date.now() - startTime : undefined;
    
    const stats: SessionStats = {
      messageCount,
      durationMs,
    };
    
    // Emit session end event
    await this.lifecycleManager.emit('session_end', sessionKey, {
      messageCount,
      durationMs,
    }, context);
    
    // Clean up start time tracking
    this.sessionStartTimes.delete(sessionKey);
    
    // Call custom handler if provided
    if (this.events.onSessionEnd) {
      await this.events.onSessionEnd(context, stats);
    }
  }

  /**
   * Get the number of messages in a session
   */
  private async getMessageCount(sessionKey: string): Promise<number> {
    try {
      const messages = await this.sessionStore.load(sessionKey);
      return messages.length;
    } catch {
      return 0;
    }
  }

  /**
   * Get the start time for a session
   */
  getSessionStartTime(sessionKey: string): number | undefined {
    return this.sessionStartTimes.get(sessionKey);
  }

  /**
   * Check if a session is currently active
   */
  isSessionActive(sessionKey: string): boolean {
    return this.sessionStartTimes.has(sessionKey);
  }
}
