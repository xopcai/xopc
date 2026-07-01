/**
 * MemoryPrefetchCoordinator — owns the per-session memory prefetch cadence and
 * the post-turn sync hand-off to external memory providers.
 *
 * Previously these lived as two methods + a private `Map<sessionKey, turn>` on
 * `AgentManager`. Moving them out makes the memory layer a stand-alone concern
 * with a single owner that handles both "what to prefix on the user turn" and
 * "what to sync after the turn ends".
 */

import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import type { MemoryManager } from './manager.js';
import { extractAgentUserPlainText } from './user-message-text.js';
import { injectPrefetchIntoUserMessage } from './inject-prefetch.js';
import {
  isMemorySubsystemEnabled,
  shouldInjectMemoryPrefetchThisTurn,
} from './memory-config.js';

export interface MemoryPrefetchCoordinatorOptions {
  /** Effective config snapshot accessor; tested against `isMemorySubsystemEnabled`. */
  getConfig: () => Config | undefined;
  /** Resolve the per-session memory manager (workspace runtime lookup lives in AgentManager). */
  getMemoryManagerForSession: (sessionKey: string) => MemoryManager;
  /** Return the last assistant text for a session — fed into external `syncAll`. */
  getLastAssistantContent: (sessionKey: string) => string | null;
}

export class MemoryPrefetchCoordinator {
  private readonly opts: MemoryPrefetchCoordinatorOptions;
  /** Per-session user-message index, incremented before each `applyPrefetch` call. */
  private readonly prefetchUserTurn = new Map<string, number>();

  constructor(opts: MemoryPrefetchCoordinatorOptions) {
    this.opts = opts;
  }

  /** Forget a session entirely (called when AgentManager removes the agent). */
  forgetSession(sessionKey: string): void {
    this.prefetchUserTurn.delete(sessionKey);
  }

  /** Tear down all per-session state (process stop / hot reload). */
  clear(): void {
    this.prefetchUserTurn.clear();
  }

  /**
   * Prepend the prefetched memory fence to the user turn when the cadence
   * config says we should. Returns the original message untouched otherwise.
   */
  async applyToUserMessage(
    userMessage: AgentMessage,
    sessionKey: string,
  ): Promise<AgentMessage> {
    const cfg = this.opts.getConfig();
    if (!isMemorySubsystemEnabled(cfg)) {
      return userMessage;
    }
    const plain = extractAgentUserPlainText(userMessage);
    const turn = (this.prefetchUserTurn.get(sessionKey) ?? 0) + 1;
    this.prefetchUserTurn.set(sessionKey, turn);
    if (!shouldInjectMemoryPrefetchThisTurn(cfg, turn)) {
      return userMessage;
    }
    return injectPrefetchIntoUserMessage(
      this.opts.getMemoryManagerForSession(sessionKey),
      sessionKey,
      userMessage,
      plain,
    );
  }

  /** Post-turn: push the latest exchange to external providers + warm next prefetch. */
  afterTurn(sessionKey: string, userPlainText: string): void {
    const cfg = this.opts.getConfig();
    if (!isMemorySubsystemEnabled(cfg)) {
      return;
    }
    const assistant = this.opts.getLastAssistantContent(sessionKey) ?? '';
    const mm = this.opts.getMemoryManagerForSession(sessionKey);
    void mm.syncAll(userPlainText, assistant, { sessionId: sessionKey });
    mm.queuePrefetchAll(userPlainText, { sessionId: sessionKey });
  }
}
