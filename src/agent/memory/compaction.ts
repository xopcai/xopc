import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { complete, type Model, type Api, type UserMessage } from '@mariozechner/pi-ai';
import { generateStructuredSummary, formatSummaryAsText, type ConversationSummary } from './summary-generator.js';

export interface CompactionResult {
  summary: string;
  firstKeptIndex: number;
  tokensBefore: number;
  tokensAfter: number;
  compacted: boolean;
  structuredSummary?: ConversationSummary;
  compactedUsage?: {
    input: number;
    output: number;
    total: number;
    cost?: number;
  };
}

export interface CompactionConfig {
  enabled: boolean;
  mode: 'extractive' | 'abstractive' | 'structured';
  reserveTokens: number;
  triggerThreshold: number;
  minMessagesBeforeCompact: number;
  keepRecentMessages: number;
  summaryMaxTokens: number;
  evictionWindow: number;
  retentionWindow: number;
  preserveReasoning: boolean;
  accumulateUsage: boolean;
}

const DEFAULT_CONFIG: CompactionConfig = {
  enabled: true,
  mode: 'abstractive',
  reserveTokens: 8000,
  triggerThreshold: 0.8,
  minMessagesBeforeCompact: 10,
  keepRecentMessages: 10,
  summaryMaxTokens: 500,
  evictionWindow: 0.2,
  retentionWindow: 6,
  preserveReasoning: true,
  accumulateUsage: true,
};

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

// Internal: Reasoning extraction utilities
interface ReasoningDetails {
  thinking?: string;
  signature?: string;
}

function extractLastReasoning(messages: AgentMessage[]): ReasoningDetails | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant') {
      const rd = (msg as unknown as { reasoning_details?: ReasoningDetails }).reasoning_details;
      if (rd && (rd.thinking || rd.signature)) {
        return rd;
      }
    }
  }
  return null;
}

// Internal: Inject reasoning into first assistant message
function injectReasoningIntoFirstAssistant(
  messages: AgentMessage[],
  reasoning: ReasoningDetails
): void {
  for (const msg of messages) {
    if (msg.role === 'assistant') {
      const existing = (msg as unknown as { reasoning_details?: ReasoningDetails }).reasoning_details;
      if (!existing || (!existing.thinking && !existing.signature)) {
        (msg as unknown as { reasoning_details?: ReasoningDetails }).reasoning_details = reasoning;
      }
      break;
    }
  }
}

// Internal: Message usage tracking
interface MessageUsage {
  input: number;
  output: number;
  total: number;
  cost?: number;
}

export function accumulateUsage(messages: AgentMessage[]): MessageUsage | undefined {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;
  let hasUsage = false;

  for (const msg of messages) {
    const usage = (msg as unknown as { usage?: MessageUsage }).usage;
    if (usage) {
      hasUsage = true;
      totalInput += usage.input || 0;
      totalOutput += usage.output || 0;
      totalCost += usage.cost || 0;
    }
  }

  if (!hasUsage) return undefined;

  return {
    input: totalInput,
    output: totalOutput,
    total: totalInput + totalOutput,
    cost: totalCost > 0 ? totalCost : undefined,
  };
}

// Internal: Droppable message filtering
type DroppableMessage = AgentMessage & {
  droppable?: boolean;
};

function filterDroppableMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.filter(msg => !(msg as DroppableMessage).droppable);
}

function findNthTurnFromEnd(messages: AgentMessage[], n: number): number {
  if (n <= 0) return messages.length;
  
  let turnsFound = 0;
  let lastRole: string | null = null;
  
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    
    if (msg.role === 'user' && lastRole !== 'user') {
      turnsFound++;
      if (turnsFound === n) {
        return i;
      }
    }
    lastRole = msg.role;
  }
  
  return 0;
}

// Internal: Calculate compaction range
function calculateCompactionRange(
  messages: AgentMessage[],
  config: CompactionConfig
): { start: number; end: number } | null {
  const totalMessages = messages.length;
  
  if (totalMessages < config.minMessagesBeforeCompact) {
    return null;
  }
  
  const evictionEnd = Math.floor(totalMessages * config.evictionWindow);
  const retentionStart = findNthTurnFromEnd(messages, config.retentionWindow);
  const retentionEnd = retentionStart > 0 ? retentionStart - 1 : 0;
  const compactionEnd = Math.min(evictionEnd, retentionEnd);
  
  if (compactionEnd <= 1) {
    return null;
  }
  
  return { start: 0, end: compactionEnd };
}

export class SessionCompactor {
  private config: CompactionConfig;
  
  constructor(
    config?: Partial<CompactionConfig>,
    private model?: Model<Api>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

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

  async compact(
    messages: AgentMessage[],
    _instructions?: string
  ): Promise<CompactionResult> {
    const effectiveMessages = filterDroppableMessages(messages);
    
    if (effectiveMessages.length < this.config.minMessagesBeforeCompact) {
      return {
        summary: '',
        firstKeptIndex: 0,
        tokensBefore: this.estimateTotalTokens(effectiveMessages),
        tokensAfter: this.estimateTotalTokens(effectiveMessages),
        compacted: false,
      };
    }

    const range = calculateCompactionRange(effectiveMessages, this.config);
    const keepRecent = range ? effectiveMessages.length - range.end : this.config.keepRecentMessages;
    const messagesToSummarize = range 
      ? effectiveMessages.slice(0, range.end)
      : effectiveMessages.slice(0, -keepRecent);
    const keptMessages = range 
      ? effectiveMessages.slice(range.end)
      : effectiveMessages.slice(-keepRecent);

    let preservedReasoning: ReasoningDetails | null = null;
    if (this.config.preserveReasoning) {
      preservedReasoning = extractLastReasoning(messagesToSummarize);
      if (preservedReasoning) {
        injectReasoningIntoFirstAssistant(keptMessages, preservedReasoning);
      }
    }

    const summary = await this.generateSummary(messagesToSummarize);
    const structuredSummary = this.config.mode === 'structured' 
      ? generateStructuredSummary(messagesToSummarize)
      : undefined;

    const tokensBefore = this.estimateTotalTokens(effectiveMessages);
    const summaryTokens = estimateTokens(summary) + 20;
    const keptTokens = this.estimateTotalTokens(keptMessages);
    const tokensAfter = summaryTokens + keptTokens;

    let compactedUsage: MessageUsage | undefined;
    if (this.config.accumulateUsage) {
      compactedUsage = accumulateUsage(messagesToSummarize);
    }

    return {
      summary,
      firstKeptIndex: keptMessages.length > 0 ? effectiveMessages.length - keptMessages.length : 0,
      tokensBefore,
      tokensAfter,
      compacted: true,
      structuredSummary,
      compactedUsage,
    };
  }

  private async generateSummary(messages: AgentMessage[]): Promise<string> {
    if (this.model && (this.config.mode === 'abstractive' || this.config.mode === 'structured')) {
      try {
        if (this.config.mode === 'structured') {
          const structured = generateStructuredSummary(messages);
          return formatSummaryAsText(structured, true);
        } else {
          return await this.llmAbstractiveSummary(messages);
        }
      } catch (err) {
        console.warn('[Compactor] LLM summarization failed, falling back to extractive', err);
      }
    }

    return this.extractiveSummary(messages);
  }

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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const summaryMessage: UserMessage = { role: 'user', content: prompt, timestamp: Date.now() };
      const result = await complete(this.model, { 
        messages: [summaryMessage]
      }, {
        maxTokens: this.config.summaryMaxTokens,
        temperature: 0.3,
        signal: controller.signal as any,
      });

      const text = Array.isArray(result.content)
        ? result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
        : '';

      return text.trim();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('LLM summarization timed out after 30 seconds');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private formatMessages(messages: AgentMessage[]): string {
    return messages
      .map(m => {
        const role = m.role;
        const content = typeof m.content === 'string' 
          ? m.content 
          : (m.content as Array<{ type: string; text?: string }>).filter(c => c.type === 'text').map(c => c.text || '').join('\n');
        return `[${role}]: ${content}`;
      })
      .join('\n\n');
  }

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

  estimateTotalTokens(messages: AgentMessage[]): number {
    return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
  }

  applyCompaction(
    messages: AgentMessage[],
    result: CompactionResult
  ): AgentMessage[] {
    if (!result.compacted || !result.summary) {
      return messages;
    }

    const summaryMessage: AgentMessage & { usage?: MessageUsage } = {
      role: 'user',
      content: [{ type: 'text', text: `[Previous conversation summary]: ${result.summary}` }],
      timestamp: Date.now(),
    };

    if (result.compactedUsage) {
      summaryMessage.usage = result.compactedUsage;
    }

    const keptMessages = messages.slice(result.firstKeptIndex);
    return [summaryMessage, ...keptMessages];
  }
}
