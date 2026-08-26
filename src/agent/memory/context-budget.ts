import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { getToolResultTextLength, truncateToolResultMessage } from '../embedded/tool-result-truncation.js';
import { readAgentMessageContent } from './agent-message-access.js';

const MESSAGE_OVERHEAD_TOKENS = 12;
const REQUEST_OVERHEAD_TOKENS = 256;
const DEFAULT_IMAGE_TOKENS = 1_024;

export type ContextBudgetRoute =
  | 'fits'
  | 'compact_only'
  | 'truncate_tool_results_only'
  | 'compact_then_truncate';

export interface ContextBudgetInput {
  messages: AgentMessage[];
  contextWindow: number;
  systemPrompt?: string;
  currentUserMessage?: AgentMessage;
  tools?: Array<{ name: string; description?: string; parameters?: unknown }>;
  imageCount?: number;
  triggerThreshold?: number;
  reserveTokens?: number;
  minToolResultKeepChars?: number;
  canCompact?: boolean;
}

export type ContextProjectionReason = 'normal' | 'cache_expired' | 'hard_limit';

export interface ContextBudgetEvaluation {
  route: ContextBudgetRoute;
  estimatedTokens: number;
  transcriptTokens: number;
  systemPromptTokens: number;
  currentUserTokens: number;
  toolSchemaTokens: number;
  imageTokens: number;
  reducibleToolResultTokens: number;
  triggerTokens: number;
  hardLimitTokens: number;
  usagePercent: number;
}

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function stringifyForBudget(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? '');
  } catch {
    return String(value ?? '');
  }
}

export function estimateMessageTokens(message: AgentMessage): number {
  return estimateTextTokens(stringifyForBudget(readAgentMessageContent(message))) + MESSAGE_OVERHEAD_TOKENS;
}

export function estimateMessagesTokens(messages: readonly AgentMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

function estimateToolSchemaTokens(
  tools: ReadonlyArray<{ name: string; description?: string; parameters?: unknown }>,
): number {
  let total = 0;
  for (const tool of tools) {
    total += estimateTextTokens(stringifyForBudget({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })) + 16;
  }
  return total;
}

function estimateReducibleToolResultTokens(
  messages: readonly AgentMessage[],
  minKeepChars: number,
): number {
  let reducibleChars = 0;
  for (const message of messages) {
    const textLength = getToolResultTextLength(message);
    reducibleChars += Math.max(0, textLength - minKeepChars);
  }
  return Math.ceil(reducibleChars / 4);
}

export function evaluateContextBudget(input: ContextBudgetInput): ContextBudgetEvaluation {
  const contextWindow = Math.max(1, input.contextWindow);
  const reserveTokens = Math.min(
    Math.max(1_024, input.reserveTokens ?? 8_192),
    Math.max(1_024, Math.floor(contextWindow * 0.5)),
  );
  const hardLimitTokens = Math.max(1_024, contextWindow - reserveTokens);
  const triggerThreshold = Math.min(0.98, Math.max(0.1, input.triggerThreshold ?? 0.8));
  const triggerTokens = Math.min(hardLimitTokens, Math.floor(contextWindow * triggerThreshold));
  const transcriptTokens = estimateMessagesTokens(input.messages);
  const systemPromptTokens = estimateTextTokens(input.systemPrompt ?? '');
  const currentUserTokens = input.currentUserMessage
    ? estimateMessageTokens(input.currentUserMessage)
    : 0;
  const toolSchemaTokens = estimateToolSchemaTokens(input.tools ?? []);
  const imageTokens = Math.max(0, input.imageCount ?? 0) * DEFAULT_IMAGE_TOKENS;
  const reducibleToolResultTokens = estimateReducibleToolResultTokens(
    input.messages,
    Math.max(200, input.minToolResultKeepChars ?? 1_000),
  );
  const estimatedTokens = transcriptTokens
    + systemPromptTokens
    + currentUserTokens
    + toolSchemaTokens
    + imageTokens
    + REQUEST_OVERHEAD_TOKENS;
  const canCompact = input.canCompact ?? input.messages.length >= 2;

  let route: ContextBudgetRoute = 'fits';
  if (estimatedTokens > hardLimitTokens) {
    if (canCompact && reducibleToolResultTokens > 0) {
      route = 'compact_then_truncate';
    } else if (canCompact) {
      route = 'compact_only';
    } else if (reducibleToolResultTokens > 0) {
      route = 'truncate_tool_results_only';
    } else {
      route = 'compact_only';
    }
  } else if (estimatedTokens > triggerTokens && canCompact) {
    route = 'compact_only';
  }

  return {
    route,
    estimatedTokens,
    transcriptTokens,
    systemPromptTokens,
    currentUserTokens,
    toolSchemaTokens,
    imageTokens,
    reducibleToolResultTokens,
    triggerTokens,
    hardLimitTokens,
    usagePercent: estimatedTokens / contextWindow,
  };
}

function truncateToolResultsToFit(input: ContextBudgetInput): {
  messages: AgentMessage[];
  evaluation: ContextBudgetEvaluation;
  prunedToolResults: number;
} {
  const initial = evaluateContextBudget(input);
  if (initial.estimatedTokens <= initial.hardLimitTokens || initial.reducibleToolResultTokens === 0) {
    return { messages: input.messages, evaluation: initial, prunedToolResults: 0 };
  }

  const minKeepChars = Math.max(200, input.minToolResultKeepChars ?? 1_000);
  let overflowChars = (initial.estimatedTokens - initial.hardLimitTokens) * 4;
  let prunedToolResults = 0;
  const messages = input.messages.map((message) => {
    if (overflowChars <= 0) return message;
    const textLength = getToolResultTextLength(message);
    const reducibleChars = Math.max(0, textLength - minKeepChars);
    if (reducibleChars === 0) return message;
    overflowChars -= reducibleChars;
    prunedToolResults += 1;
    return truncateToolResultMessage(message, minKeepChars, { minKeepChars });
  });

  return {
    messages,
    evaluation: evaluateContextBudget({ ...input, messages }),
    prunedToolResults,
  };
}

function protectedRecentTurnStart(messages: readonly AgentMessage[], recentTurns: number): number {
  let remaining = recentTurns;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if ((messages[index] as { role?: string }).role !== 'assistant') continue;
    remaining -= 1;
    if (remaining === 0) return index;
  }
  return 0;
}

function replaceOldImages(message: AgentMessage): { message: AgentMessage; removed: number } {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return { message, removed: 0 };
  let removed = 0;
  const nextContent = content.map((block) => {
    if (!block || typeof block !== 'object' || (block as { type?: string }).type !== 'image') return block;
    removed += 1;
    return { type: 'text', text: '[Earlier image omitted from the model context.]' };
  });
  return removed > 0
    ? { message: { ...message, content: nextContent } as AgentMessage, removed }
    : { message, removed: 0 };
}

export function projectContextForModel(
  input: ContextBudgetInput & { reason: ContextProjectionReason; recentTurns?: number },
): {
  messages: AgentMessage[];
  evaluation: ContextBudgetEvaluation;
  prunedToolResults: number;
  prunedImages: number;
} {
  const initial = evaluateContextBudget(input);
  const mustFit = input.reason === 'hard_limit' || initial.estimatedTokens > initial.hardLimitTokens;
  if (input.reason !== 'cache_expired' && !mustFit) {
    return { messages: input.messages, evaluation: initial, prunedToolResults: 0, prunedImages: 0 };
  }
  if (input.reason === 'cache_expired' && initial.usagePercent < 0.3 && !mustFit) {
    return { messages: input.messages, evaluation: initial, prunedToolResults: 0, prunedImages: 0 };
  }

  const protectedStart = protectedRecentTurnStart(input.messages, input.recentTurns ?? 3);
  let prunedToolResults = 0;
  let prunedImages = 0;
  let messages = input.messages.map((message, index) => {
    if (index >= protectedStart) return message;
    const imageProjection = replaceOldImages(message);
    prunedImages += imageProjection.removed;
    if (getToolResultTextLength(imageProjection.message) <= 3_000) return imageProjection.message;
    prunedToolResults += 1;
    return truncateToolResultMessage(imageProjection.message, 3_000, { minKeepChars: 1_500 });
  });

  let evaluation = evaluateContextBudget({ ...input, messages });
  if (input.reason === 'cache_expired' && evaluation.usagePercent > 0.5) {
    messages = messages.map((message, index) => {
      if (index >= protectedStart || getToolResultTextLength(message) <= 400) return message;
      prunedToolResults += 1;
      return truncateToolResultMessage(message, 400, { minKeepChars: 200 });
    });
    evaluation = evaluateContextBudget({ ...input, messages });
  }

  if (evaluation.estimatedTokens > evaluation.hardLimitTokens) {
    const fitted = truncateToolResultsToFit({ ...input, messages });
    messages = fitted.messages;
    prunedToolResults += fitted.prunedToolResults;
    evaluation = fitted.evaluation;
  }

  return { messages, evaluation, prunedToolResults, prunedImages };
}
