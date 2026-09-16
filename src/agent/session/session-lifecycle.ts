/**
 * Session Lifecycle Manager - Manages session lifecycle events
 *
 * Handles session start, end, and related lifecycle operations.
 */

import type { SessionStore } from '../../session/index.js';
import type { SessionTracker } from './tracker.js';
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
    const { conversationId } = context;
    
    log.debug({ conversationId }, 'Starting session');
    
    // Touch session in tracker
    this.sessionTracker.touchSession(conversationId);
    
    // Record start time
    this.sessionStartTimes.set(conversationId, Date.now());
    
    // Emit session start event
    await this.lifecycleManager.emit('session_start', conversationId, {
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
    const { conversationId } = context;
    
    log.debug({ conversationId }, 'Ending session');
    
    // Calculate stats
    const messageCount = await this.getMessageCount(conversationId);
    const startTime = this.sessionStartTimes.get(conversationId);
    const durationMs = startTime ? Date.now() - startTime : undefined;
    
    const stats: SessionStats = {
      messageCount,
      durationMs,
    };
    
    // Emit session end event
    await this.lifecycleManager.emit('session_end', conversationId, {
      messageCount,
      durationMs,
    }, context);
    
    // Clean up start time tracking
    this.sessionStartTimes.delete(conversationId);
    
    // Call custom handler if provided
    if (this.events.onSessionEnd) {
      await this.events.onSessionEnd(context, stats);
    }
  }

  /**
   * Get the number of messages in a session
   */
  private async getMessageCount(conversationId: string): Promise<number> {
    try {
      const messages = await this.sessionStore.load(conversationId);
      return messages.length;
    } catch {
      return 0;
    }
  }

  /**
   * Get the start time for a session
   */
  getSessionStartTime(conversationId: string): number | undefined {
    return this.sessionStartTimes.get(conversationId);
  }

  /**
   * Check if a session is currently active
   */
  isSessionActive(conversationId: string): boolean {
    return this.sessionStartTimes.has(conversationId);
  }
}
