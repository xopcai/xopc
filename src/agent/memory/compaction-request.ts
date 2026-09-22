import type { Api, Model, SimpleStreamOptions } from '@earendil-works/pi-ai/compat';

import { estimateTextTokens } from './context-budget.js';

export const COMPACTION_CONTEXT_MARGIN = 4_096;
export const COMPACTION_REPAIR_RESERVE = 1_024;

export class CompactionRequestError extends Error {
  constructor(
    readonly kind: 'length' | 'empty' | 'budget' | 'provider' | 'timeout',
    message: string,
  ) {
    super(message);
    this.name = 'CompactionRequestError';
  }
}

export function compactionOutputLimit(model: Model<Api>, configured: number): number {
  return Math.min(configured, model.maxTokens > 0 ? model.maxTokens : configured);
}

/** Start large prompts closer to their likely delta size while retaining room to double on truncation. */
export function initialCompactionOutputLimit(
  systemPrompt: string,
  prompt: string,
  outputLimit: number,
): number {
  const estimated = Math.ceil(
    (estimateTextTokens(systemPrompt) + estimateTextTokens(prompt)) * 0.2,
  );
  return Math.min(outputLimit, estimated > 4_000 ? 8_000 : 4_000);
}

export function compactionPromptFits(
  model: Model<Api>, systemPrompt: string, prompt: string, outputLimit: number,
): boolean {
  return estimateTextTokens(systemPrompt) + estimateTextTokens(prompt) + 32
    + outputLimit + COMPACTION_CONTEXT_MARGIN <= (model.contextWindow || 128_000);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** Bound the final provider payload, including adapters that add a thinking budget. */
export function compactionPayloadGuard(
  limit: number,
  onBudget: (actual: number) => void,
): NonNullable<SimpleStreamOptions['onPayload']> {
  return (payload) => {
    const root = record(payload);
    if (!root) return;
    const containers = [root, record(root.config), record(root.generationConfig), record(root.inferenceConfig)];
    let actual: number | undefined;
    for (const container of containers) {
      if (!container) continue;
      for (const key of ['max_tokens', 'max_completion_tokens', 'max_output_tokens', 'maxOutputTokens', 'maxTokens']) {
        if (typeof container[key] !== 'number') continue;
        const bounded = Math.min(container[key], limit);
        container[key] = bounded;
        actual = actual === undefined ? bounded : Math.min(actual, bounded);
      }
    }
    if (actual === undefined) return;
    // Anthropic and Bedrock require at least 1,024 thinking tokens when enabled.
    for (const thinking of [record(root.thinking), record(record(root.additionalModelRequestFields)?.thinking)]) {
      if (thinking?.type !== 'enabled' || typeof thinking.budget_tokens !== 'number') continue;
      if (actual < 2_048) {
        throw new CompactionRequestError('budget', 'Compaction output budget cannot fit enabled thinking and an answer');
      }
      thinking.budget_tokens = Math.min(thinking.budget_tokens, actual - 1_024);
    }
    onBudget(actual);
    return payload;
  };
}

export function isPermanentCompactionError(error: unknown): boolean {
  if (error instanceof CompactionRequestError && error.kind === 'budget') return true;
  const status = record(error)?.status;
  if (typeof status === 'number' && [400, 401, 403, 404, 422].includes(status)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /(?:\b(?:400|401|403|404|422)\b|unauthorized|forbidden|invalid api key|no api key|token expired|context (?:length|window)|maximum context|unsupported parameter|budget cannot fit)/i.test(message);
}
