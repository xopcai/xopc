// Session Compaction - Compress old messages using LLM summary
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { complete, type Model, type Api } from '@mariozechner/pi-ai';

export interface CompactionResult {
  summary: string;
  firstKeptIndex: number;
  tokensBefore: number;
  tokensAfter: number;
  compacted: boolean;
}

export interface CompactionConfig {
  enabled: boolean;
  mode: 'extractive' | 'abstractive' | 'structured';
  reserveTokens: number;
  triggerThreshold: number;
  minMessagesBeforeCompact: number;
  keepRecentMessages: number;
  summaryMaxTokens: number;
}

const DEFAULT_CONFIG: CompactionConfig = {
  enabled: true,
  mode: 'abstractive',
  reserveTokens: 8000,
  triggerThreshold: 0.8,
  minMessagesBeforeCompact: 10,
  keepRecentMessages: 10,
  summaryMaxTokens: 500,
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
    private model?: Model<Api>
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
   * Generate summary based on configured mode
   */
  private async generateSummary(messages: AgentMessage[]): Promise<string> {
    // Use LLM if available and mode is abstractive/structured
    if (this.model && (this.config.mode === 'abstractive' || this.config.mode === 'structured')) {
      try {
        if (this.config.mode === 'abstractive') {
          return await this.llmAbstractiveSummary(messages);
        } else {
          return await this.llmStructuredSummary(messages);
        }
      } catch (err) {
        console.warn('[Compactor] LLM summarization failed, falling back to extractive', err);
      }
    }

    // Fallback to extractive summary
    return this.extractiveSummary(messages);
  }

  /**
   * LLM-based abstractive summary (natural language summary)
   */
  private async llmAbstractiveSummary(messages: AgentMessage[]): Promise<string> {
    if (!this.model) {
      throw new Error('Model not available');
    }

    const conversation = this.formatMessages(messages);
    const prompt = `Summarize the following conversation in 2-3 concise sentences. Focus on:
1. What the user was trying to accomplish
2. Key decisions, outcomes, or solutions
3. Any important context that should be preserved

Conversation:
${conversation}

Summary:`;

    const result = await complete(this.model, { 
      messages: [{ role: 'user', content: prompt }] as any 
    }, {
      maxTokens: this.config.summaryMaxTokens,
      temperature: 0.3,
    });

    const text = Array.isArray(result.content)
      ? result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
      : '';

    return text.trim();
  }

  /**
   * LLM-based structured extraction (structured memory)
   */
  private async llmStructuredSummary(messages: AgentMessage[]): Promise<string> {
    if (!this.model) {
      throw new Error('Model not available');
    }

    const conversation = this.formatMessages(messages);
    const prompt = `Extract key information from this conversation in a structured format:

${conversation}

Output JSON format:
{
  "task": "What the user was trying to do",
  "decisions": ["Key decisions made"],
  "preferences": ["User preferences mentioned"],
  "context": ["Technical context or setup"],
  "pending": ["Any open tasks or follow-ups"]
}

JSON:`;

    const result = await complete(this.model, { 
      messages: [{ role: 'user', content: prompt }] as any 
    }, {
      maxTokens: this.config.summaryMaxTokens,
      temperature: 0.2,
    });

    const text = Array.isArray(result.content)
      ? result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
      : '';
    
    // Try to parse as JSON, fallback to plain text
    try {
      const parsed = JSON.parse(text);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return text.trim();
    }
  }

  /**
   * Format messages for LLM consumption
   */
  private formatMessages(messages: AgentMessage[]): string {
    return messages
      .map(m => {
        const role = m.role;
        const content = typeof m.content === 'string' 
          ? m.content 
          : (m.content as any[]).filter(c => c.type === 'text').map(c => c.text || '').join('\n');
        return `[${role}]: ${content}`;
      })
      .join('\n\n');
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
