/**
 * Session Context - Types and manager for session context
 *
 * Manages session context state and provides utilities for context extraction.
 */

import type { InboundMessage } from '../../infra/bus/index.js';

export interface SessionContext {
  sessionKey: string;
  channel: string;
  chatId: string;
  senderId: string;
  isGroup: boolean;
  model?: string;
  metadata?: Record<string, unknown>;
}

export class SessionContextManager {
  private currentContext: SessionContext | null = null;

  /**
   * Set the current session context
   */
  setContext(context: SessionContext): void {
    this.currentContext = context;
  }

  /**
   * Get the current session context
   */
  getContext(): SessionContext | null {
    return this.currentContext;
  }

  /**
   * Clear the current session context
   */
  clearContext(): void {
    this.currentContext = null;
  }

  /**
   * Check if a context is currently set
   */
  hasContext(): boolean {
    return this.currentContext !== null;
  }

  /**
   * Extract session context from an inbound message
   */
  static extractFromMessage(msg: InboundMessage): SessionContext {
    const metadata = msg.metadata || {};
    
    return {
      sessionKey: (metadata.sessionKey as string) || `${msg.channel}:${msg.chat_id}`,
      channel: msg.channel,
      chatId: msg.chat_id,
      senderId: (metadata.senderId as string) || '',
      isGroup: (metadata.isGroup as boolean) || false,
      model: metadata.model as string | undefined,
      metadata,
    };
  }

  /**
   * Create a clone of the current context with optional overrides
   */
  cloneContext(overrides?: Partial<SessionContext>): SessionContext | null {
    if (!this.currentContext) return null;
    
    return {
      ...this.currentContext,
      ...overrides,
    };
  }
}
