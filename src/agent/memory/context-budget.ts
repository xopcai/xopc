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

export function pruneToolResultsToFit(input: ContextBudgetInput): {
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
    const charsToRemove = Math.min(reducibleChars, overflowChars);
    overflowChars -= charsToRemove;
    prunedToolResults += 1;
    return truncateToolResultMessage(message, textLength - charsToRemove, { minKeepChars });
  });

  return {
    messages,
    evaluation: evaluateContextBudget({ ...input, messages }),
    prunedToolResults,
  };
}
