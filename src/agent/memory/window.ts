// Sliding Window Memory - Keep only recent messages
import type { AgentMessage } from '@mariozechner/pi-agent-core';

export interface WindowConfig {
  maxMessages: number;
  keepRecentMessages: number;
  preserveSystemMessages: boolean;
}

const DEFAULT_CONFIG: WindowConfig = {
  maxMessages: 100,
  keepRecentMessages: 20,
  preserveSystemMessages: true,
};

export class SlidingWindow {
  constructor(private config: Partial<WindowConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Trim messages to keep within window size
   */
  trim(messages: AgentMessage[]): AgentMessage[] {
    if (messages.length <= this.config.maxMessages) {
      return messages;
    }

    const { maxMessages, keepRecentMessages, preserveSystemMessages } = this.config;

    // Separate system-like messages (role not in standard set)
    const systemMessages = messages.filter(m => {
      const role = (m as any).role;
      return role !== 'user' && role !== 'assistant' && role !== 'toolResult';
    });
    const otherMessages = messages.filter(m => {
      const role = (m as any).role;
      return role === 'user' || role === 'assistant' || role === 'toolResult';
    });

    if (preserveSystemMessages && systemMessages.length > 0) {
      if (systemMessages.length >= maxMessages) {
        return systemMessages.slice(-maxMessages);
      }

      const availableForRecent = maxMessages - systemMessages.length;
      const recentMessages = otherMessages.slice(-Math.min(keepRecentMessages, availableForRecent));
      
      return [...systemMessages, ...recentMessages];
    } else {
      return messages.slice(-maxMessages);
    }
  }

  /**
   * Check if messages need trimming
   */
  needsTrim(messages: AgentMessage[]): boolean {
    return messages.length > this.config.maxMessages;
  }

  /**
   * Get stats about current window
   */
  getStats(messages: AgentMessage[]): {
    total: number;
    system: number;
    user: number;
    assistant: number;
    tool: number;
    needsTrim: boolean;
  } {
    return {
      total: messages.length,
      system: messages.filter(m => {
        const role = (m as any).role;
        return role !== 'user' && role !== 'assistant' && role !== 'toolResult';
      }).length,
      user: messages.filter(m => (m as any).role === 'user').length,
      assistant: messages.filter(m => (m as any).role === 'assistant').length,
      tool: messages.filter(m => (m as any).role === 'toolResult').length,
      needsTrim: this.needsTrim(messages),
    };
  }
}
