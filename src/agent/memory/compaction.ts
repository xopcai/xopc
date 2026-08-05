import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { type Model, type Api, type UserMessage } from '@earendil-works/pi-ai/compat';

import { completeWithResolvedCredentials } from '../../providers/model-call.js';
import { readAgentMessageContent } from './agent-message-access.js';

export interface CompactionResult {
  summary: string;
  firstKeptIndex: number;
  tokensBefore: number;
  tokensAfter: number;
  compacted: boolean;
  compactedUsage?: {
    input: number;
    output: number;
    total: number;
    cost?: number;
  };
}

export interface CompactionConfig {
  enabled: boolean;
  triggerThreshold: number;
  minMessagesBeforeCompact: number;
  keepRecentMessages: number;
  summaryMaxTokens: number;
  retentionWindow: number;
  preserveReasoning: boolean;
  accumulateUsage: boolean;
}

const DEFAULT_CONFIG: CompactionConfig = {
  enabled: true,
  triggerThreshold: 0.8,
  minMessagesBeforeCompact: 10,
  keepRecentMessages: 10,
  summaryMaxTokens: 2000,
  retentionWindow: 6,
  preserveReasoning: true,
  accumulateUsage: true,
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(msg: AgentMessage): number {
  const raw = readAgentMessageContent(msg);
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
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

function findUserTurnAtOrAfter(messages: AgentMessage[], start: number): number {
  for (let i = Math.max(0, start); i < messages.length; i++) {
    if (messages[i]?.role === 'user') {
      return i;
    }
  }
  return Math.max(1, Math.min(start, messages.length - 1));
}

// Keep complete recent turns and never split an assistant/tool sequence.
function calculateCompactionRange(
  messages: AgentMessage[],
  config: CompactionConfig
): { start: number; end: number } | null {
  const totalMessages = messages.length;
  
  if (totalMessages < config.minMessagesBeforeCompact) {
    return null;
  }
  
  const retentionStart = findNthTurnFromEnd(messages, config.retentionWindow);
  const countStart = findUserTurnAtOrAfter(
    messages,
    Math.max(1, totalMessages - config.keepRecentMessages),
  );
  const compactionEnd = Math.min(retentionStart, countStart);
  
  if (compactionEnd <= 1) {
    return null;
  }
  
  return { start: 0, end: compactionEnd };
}

export class SessionCompactor {
  private config: CompactionConfig;
  
  constructor(config?: Partial<CompactionConfig>) {
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
    model: Model<Api>,
    instructions?: string,
    force?: boolean,
  ): Promise<CompactionResult> {
    const effectiveMessages = filterDroppableMessages(messages);

    const minRequired = this.config.minMessagesBeforeCompact;
    if (!force && effectiveMessages.length < minRequired) {
      return {
        summary: '',
        firstKeptIndex: 0,
        tokensBefore: this.estimateTotalTokens(effectiveMessages),
        tokensAfter: this.estimateTotalTokens(effectiveMessages),
        compacted: false,
      };
    }

    if (force && effectiveMessages.length < 2) {
      return {
        summary: '',
        firstKeptIndex: 0,
        tokensBefore: this.estimateTotalTokens(effectiveMessages),
        tokensAfter: this.estimateTotalTokens(effectiveMessages),
        compacted: false,
      };
    }

    const range = calculateCompactionRange(effectiveMessages, this.config);
    let messagesToSummarize: AgentMessage[];
    let keptMessages: AgentMessage[];

    if (range) {
      messagesToSummarize = effectiveMessages.slice(0, range.end);
      keptMessages = effectiveMessages.slice(range.end);
    } else if (force) {
      const forceEnd = findUserTurnAtOrAfter(
        effectiveMessages,
        Math.max(1, effectiveMessages.length - this.config.keepRecentMessages),
      );
      messagesToSummarize = effectiveMessages.slice(0, forceEnd);
      keptMessages = effectiveMessages.slice(forceEnd);
    } else {
      return {
        summary: '',
        firstKeptIndex: 0,
        tokensBefore: this.estimateTotalTokens(effectiveMessages),
        tokensAfter: this.estimateTotalTokens(effectiveMessages),
        compacted: false,
      };
    }

    if (messagesToSummarize.length === 0) {
      return {
        summary: '',
        firstKeptIndex: 0,
        tokensBefore: this.estimateTotalTokens(effectiveMessages),
        tokensAfter: this.estimateTotalTokens(effectiveMessages),
        compacted: false,
      };
    }

    let preservedReasoning: ReasoningDetails | null = null;
    if (this.config.preserveReasoning) {
      preservedReasoning = extractLastReasoning(messagesToSummarize);
      if (preservedReasoning) {
        injectReasoningIntoFirstAssistant(keptMessages, preservedReasoning);
      }
    }

    const summary = await this.generateSummary(messagesToSummarize, model, instructions);

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
      compactedUsage,
    };
  }

  private generateSummary(
    messages: AgentMessage[],
    model: Model<Api>,
    instructions?: string,
  ): Promise<string> {
    return this.llmAbstractiveSummary(messages, model, instructions);
  }

  private async llmAbstractiveSummary(
    messages: AgentMessage[],
    model: Model<Api>,
    instructions?: string,
  ): Promise<string> {
    const conversation = this.formatMessages(messages);
    const extra = instructions?.trim()
      ? `\nAdditional focus from the user:\n${instructions.trim()}\n`
      : '';
    const prompt = `Create a durable continuation summary of the conversation below.

This summary will replace the older messages in the model context. Preserve every fact needed to continue accurately, especially:
- the user's background, identity, relationships, constraints, preferences, and current situation;
- chronology, goals, decisions, commitments, corrections, negations, and unresolved questions;
- exact names, paths, identifiers, numbers, dates, and quoted wording when precision matters;
- tool results and work already completed when they affect what should happen next;
- emotional or interpersonal context when it changes the meaning of later messages.

Do not infer facts that were not stated. Distinguish the user's statements from the assistant's suggestions. Do not describe this task or mention token limits. Use concise Markdown sections, but prefer completeness over brevity.
${extra}
Conversation:
${conversation}

Summary:`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const summaryMessage: UserMessage = { role: 'user', content: prompt, timestamp: Date.now() };
      const result = await completeWithResolvedCredentials(model, {
        messages: [summaryMessage]
      }, {
        maxTokens: this.config.summaryMaxTokens,
        temperature: 0.3,
        signal: controller.signal as any,
      });

      const text = Array.isArray(result.content)
        ? result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
        : '';

      const summary = text.trim();
      if (!summary) {
        throw new Error('Compaction model returned an empty summary');
      }
      return summary;
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
        const raw = readAgentMessageContent(m);
        const content = typeof raw === 'string'
          ? raw
          : (raw as Array<{ type: string; text?: string }>).filter(c => c.type === 'text').map(c => c.text || '').join('\n');
        return `[${role}]: ${content}`;
      })
      .join('\n\n');
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
      content: [{
        type: 'text',
        text: `<conversation_summary>\nThis is a compressed factual record of earlier messages, not a new user message and not a verbatim transcript.\n\n${result.summary}\n</conversation_summary>`,
      }],
      timestamp: Date.now(),
    };

    if (result.compactedUsage) {
      summaryMessage.usage = result.compactedUsage;
    }

    const keptMessages = filterDroppableMessages(messages).slice(result.firstKeptIndex);
    return [summaryMessage, ...keptMessages];
  }
}
