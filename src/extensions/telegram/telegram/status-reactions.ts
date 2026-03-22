/**
 * Telegram Status Reactions
 * 
 * Manages message reactions to indicate agent thinking status.
 * Used to show the user that the agent is processing their request.
 */

import type { Bot } from 'grammy';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('TelegramStatusReactions');

/**
 * Status reaction types for thinking states
 */
export type ThinkingStatus = 
  | 'idle'       // No active thinking
  | 'thinking'   // Agent is thinking/reasoning
  | 'streaming'  // Agent is streaming output
  | 'done'       // Response complete
  | 'error';     // Error occurred

/**
 * Emoji mappings for thinking status
 */
export const THINKING_REACTIONS: Record<ThinkingStatus, string[]> = {
  idle: [],
  thinking: ['💭'],  // Thinking bubble
  streaming: ['📝'],  // Memo/note
  done: ['✅'],       // Checkmark
  error: ['❌'],      // Cross mark
};

/**
 * Status reaction configuration
 */
export interface StatusReactionConfig {
  /** Whether to enable status reactions */
  enabled?: boolean;
  /** Delay before showing thinking reaction (ms) */
  thinkingDelayMs?: number;
  /** Reaction emoji to use */
  reactions?: Record<ThinkingStatus, string[]>;
}

/**
 * Create a status reaction handler
 */
export function createStatusReactionHandler(
  api: Bot['api'],
  chatId: number | string,
  messageId: number,
  config?: StatusReactionConfig
) {
  const enabled = config?.enabled ?? true;
  const thinkingDelayMs = config?.thinkingDelayMs ?? 1500;
  const reactions = config?.reactions ?? THINKING_REACTIONS;

  let thinkingTimer: ReturnType<typeof setTimeout> | null = null;
  let currentStatus: ThinkingStatus = 'idle';

  /**
   * Show thinking reaction after delay
   */
  const showThinking = () => {
    if (!enabled || currentStatus !== 'idle') return;

    thinkingTimer = setTimeout(async () => {
      try {
        const reaction = reactions.thinking;
        if (reaction && reaction.length > 0) {
          await (api as any).setMessageReaction(chatId, messageId, reaction);
          currentStatus = 'thinking';
          log.debug({ chatId, messageId, status: 'thinking' }, 'Set thinking reaction');
        }
      } catch (err) {
        log.warn({ chatId, messageId, err }, 'Failed to set thinking reaction');
      }
    }, thinkingDelayMs);
  };

  /**
   * Clear thinking timer without showing reaction
   */
  const cancelThinking = () => {
    if (thinkingTimer) {
      clearTimeout(thinkingTimer);
      thinkingTimer = null;
    }
  };

  /**
   * Set streaming status (replace thinking with streaming)
   */
  const showStreaming = async () => {
    cancelThinking();
    if (!enabled) return;

    try {
      const reaction = reactions.streaming;
      if (reaction && reaction.length > 0) {
        await (api as any).setMessageReaction(chatId, messageId, reaction);
        currentStatus = 'streaming';
        log.debug({ chatId, messageId, status: 'streaming' }, 'Set streaming reaction');
      }
    } catch (err) {
      log.warn({ chatId, messageId, err }, 'Failed to set streaming reaction');
    }
  };

  /**
   * Mark as done
   */
  const showDone = async () => {
    cancelThinking();
    if (!enabled) return;

    try {
      const reaction = reactions.done;
      if (reaction && reaction.length > 0) {
        await (api as any).setMessageReaction(chatId, messageId, reaction);
        currentStatus = 'done';
        log.debug({ chatId, messageId, status: 'done' }, 'Set done reaction');
      }
    } catch (err) {
      log.warn({ chatId, messageId, err }, 'Failed to set done reaction');
    }
  };

  /**
   * Mark as error
   */
  const showError = async () => {
    cancelThinking();
    if (!enabled) return;

    try {
      const reaction = reactions.error;
      if (reaction && reaction.length > 0) {
        await (api as any).setMessageReaction(chatId, messageId, reaction);
        currentStatus = 'error';
        log.debug({ chatId, messageId, status: 'error' }, 'Set error reaction');
      }
    } catch (err) {
      log.warn({ chatId, messageId, err }, 'Failed to set error reaction');
    }
  };

  /**
   * Clear all reactions
   */
  const clear = async () => {
    cancelThinking();
    if (!enabled) return;

    try {
      await (api as any).setMessageReaction(chatId, messageId, []);
      currentStatus = 'idle';
      log.debug({ chatId, messageId }, 'Cleared reactions');
    } catch (err) {
      // Ignore errors when clearing
      log.debug({ chatId, messageId, err }, 'Failed to clear reactions (may already be cleared)');
    }
  };

  return {
    showThinking,
    cancelThinking,
    showStreaming,
    showDone,
    showError,
    clear,
    getStatus: () => currentStatus,
  };
}

/**
 * Status reaction types for export
 */
export type StatusReactionHandler = ReturnType<typeof createStatusReactionHandler>;
;
