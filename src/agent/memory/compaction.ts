// Session Compaction - Compress old messages using LLM summary
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { Model, Api } from '@mariozechner/pi-ai';

export interface CompactionResult {
  summary: string;
  firstKeptIndex: number;
  tokensBefore: number;
  tokensAfter: number;
  compacted: boolean;
}

export interface CompactionConfig {
  enabled: boolean;
  mode: 'default' | 'safeguard';
  reserveTokens: number;
  triggerThreshold: number;
  minMessagesBeforeCompact: number;
  keepRecentMessages: number;
}

const DEFAULT_CONFIG: CompactionConfig = {
  enabled: true,
  mode: 'default',
  reserveTokens: 8000,
  triggerThreshold: 0.8,
  minMessagesBeforeCompact: 10,
  keepRecentMessages: 10,
};

// Rough token estimation (4 chars per token average)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(msg: AgentMessage): number {
  let text = '';
  
  if (typeof msg.content === 'string') {
    text = msg.content;
  } else if (Array.isArray(msg.content)) {
    text = msg.content
      .filter(c => c.type === 'text')
      .map(c => (c as { text?: string }).text || '')
      .join('\n');
  }
  
  return estimateTokens(text) + 10;
}

export class SessionCompactor {
  constructor(
    private config: Partial<CompactionConfig> = {},
    private _model?: Model<Api>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if compaction is needed
   */
  needsCompaction(
    messages: AgentMessage[],
    contextWindow: number
  ): { needed: boolean; reason: string; usagePercent?: number } {
    if (!this.config.enabled) {
      return { needed: false, reason: 'disabled' };
    }

    if (messages.length < this.config.minMessagesBeforeCompact) {
      return { needed: false, reason: 'not_enough_messages' };
    }

    const totalTokens = this.estimateTotalTokens(messages);
    const usagePercent = totalTokens / contextWindow;

    if (usagePercent > this.config.triggerThreshold) {
      return { 
        needed: true, 
        reason: 'threshold_exceeded',
        usagePercent 
      };
    }

    return { needed: false, reason: 'within_threshold' };
  }

  /**
   * Compact messages by summarizing old ones
   */
  async compact(
    messages: AgentMessage[],
    _instructions?: string
  ): Promise<CompactionResult> {
    if (messages.length < this.config.minMessagesBeforeCompact) {
      return {
        summary: '',
        firstKeptIndex: 0,
        tokensBefore: this.estimateTotalTokens(messages),
        tokensAfter: this.estimateTotalTokens(messages),
        compacted: false,
      };
    }

    const keepRecent = this.config.keepRecentMessages;
    const messagesToSummarize = messages.slice(0, -keepRecent);
    const keptMessages = messages.slice(-keepRecent);

    const summary = await this.generateSummary(messagesToSummarize);

    const tokensBefore = this.estimateTotalTokens(messages);
    const summaryTokens = estimateTokens(summary) + 20;
    const keptTokens = this.estimateTotalTokens(keptMessages);
    const tokensAfter = summaryTokens + keptTokens;

    return {
      summary,
      firstKeptIndex: messages.length - keepRecent,
      tokensBefore,
      tokensAfter,
      compacted: true,
    };
  }

  /**
   * Generate summary using LLM or fallback
   */
  private async generateSummary(messages: AgentMessage[]): Promise<string> {
    // Fallback: simple extractive summary
    return this.extractiveSummary(messages);
  }

  /**
   * Simple extractive summary (fallback when LLM unavailable)
   */
  private extractiveSummary(messages: AgentMessage[]): string {
    const userMessages = messages
      .filter(m => m.role === 'user')
      .slice(-5)
      .map(m => {
        if (typeof m.content === 'string') return m.content;
        if (Array.isArray(m.content)) {
          return m.content
            .filter(c => c.type === 'text')
            .map(c => (c as { text?: string }).text || '')
            .join('\n');
        }
        return '';
      })
      .filter(t => t.length > 0)
      .join('; ');

    return `Previous conversation covered: ${userMessages.slice(0, 300)}...`;
  }

  /**
   * Estimate tokens for messages array
   */
  estimateTotalTokens(messages: AgentMessage[]): number {
    return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
  }

  /**
   * Apply compaction result to messages
   */
  applyCompaction(
    messages: AgentMessage[],
    result: CompactionResult
  ): AgentMessage[] {
    if (!result.compacted || !result.summary) {
      return messages;
    }

    const summaryMessage: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: `[Previous conversation summary]: ${result.summary}` }],
      timestamp: Date.now(),
    };

    const keptMessages = messages.slice(result.firstKeptIndex);
    return [summaryMessage, ...keptMessages];
  }
}
