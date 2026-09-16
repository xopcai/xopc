import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import { createLogger } from '../../utils/logger.js';
import { stripTrailingErrorAssistantMessages } from '../orchestration/llm-turn-retry.js';
import { evaluateContextBudget, projectContextForModel, type ContextBudgetInput } from './context-budget.js';
import type { CompactionExecutionOptions, CompactionResult } from './compaction.js';
import type { ResolvedCompactionPolicy } from './compaction-policy.js';

const log = createLogger('ContextRecovery');

export class ContextRecoveryError extends Error {
  constructor(readonly code: 'disabled' | 'unrecoverable', message: string) {
    super(message);
    this.name = 'ContextRecoveryError';
  }
}

/** Projection is ephemeral; the transcript remains the authoritative record. */
export function assessContext(input: ContextBudgetInput, maxBytes: number) {
  const projection = projectContextForModel({ ...input, reason: 'normal' });
  const bytes = Buffer.byteLength(JSON.stringify(projection.messages), 'utf8');
  return {
    ...projection,
    bytes,
    fits: projection.evaluation.estimatedTokens <= projection.evaluation.hardLimitTokens && bytes <= maxBytes,
  };
}

interface RecoveryTranscript {
  loadMessages(): Promise<AgentMessage[]>;
  compact(messages: AgentMessage[], model: Model<Api>, instructions?: string, force?: boolean,
    options?: CompactionExecutionOptions): Promise<CompactionResult>;
}

/** One normal compaction and at most one full-history recovery, under the caller's deadline. */
export async function recoverContext(options: {
  conversationId: string;
  transcript: RecoveryTranscript;
  budget: Omit<ContextBudgetInput, 'messages'>;
  policy: ResolvedCompactionPolicy;
  summaryModel: Model<Api> | (() => Model<Api> | Promise<Model<Api>>);
  fallbackModels?: Model<Api>[];
  signal?: AbortSignal;
  providerRejected?: boolean;
  preserveLastUser?: boolean;
  onCompacted?: () => void;
}) {
  const { transcript, budget, policy, signal } = options;
  const load = async () => stripTrailingErrorAssistantMessages(await transcript.loadMessages());
  signal?.throwIfAborted();
  let messages = await load();
  const initial = evaluateContextBudget({ ...budget, messages });
  let assessed = assessContext({ ...budget, messages }, policy.maxActiveTranscriptBytes);
  const required = !assessed.fits || options.providerRejected === true;
  if (!required && (initial.estimatedTokens <= initial.triggerTokens
    || messages.length < policy.minMessagesBeforeCompact || !policy.enabled)) {
    return { status: 'unchanged' as const, messages: assessed.messages };
  }
  if (!policy.enabled) {
    throw new ContextRecoveryError('disabled', 'Context budget exceeded and automatic compaction is disabled');
  }

  let result: CompactionResult | undefined;
  for (const summarizeAll of [false, true]) {
    signal?.throwIfAborted();
    log.info({ conversationId: options.conversationId, phase: summarizeAll ? 'full_history' : 'normal',
      estimatedTokens: assessed.evaluation.estimatedTokens, bytes: assessed.bytes }, 'Context recovery started');
    try {
      const summaryModel = typeof options.summaryModel === 'function'
        ? await options.summaryModel() : options.summaryModel;
      signal?.throwIfAborted();
      result = await transcript.compact(messages, summaryModel,
        options.preserveLastUser ? 'Preserve the pending user request and completed tool outcomes. Continue remaining work without repeating completed operations.' : undefined,
        required || summarizeAll,
        { signal, fallbackModels: options.fallbackModels ?? [], ...(summarizeAll ? {
          summarizeAll: true, preserveLastUser: options.preserveLastUser,
        } : {}) });
    } catch (error) {
      signal?.throwIfAborted();
      if (required || summarizeAll) throw error;
      log.warn({ err: error, conversationId: options.conversationId }, 'Optional context compaction failed');
      return { status: 'unchanged' as const, messages: assessed.messages };
    }
    signal?.throwIfAborted();
    if (result.compacted) options.onCompacted?.();
    messages = await load();
    assessed = assessContext({ ...budget, messages }, policy.maxActiveTranscriptBytes);
    if (assessed.fits && (result.compacted || !options.providerRejected)) {
      return { status: result.compacted ? 'compacted' as const : 'unchanged' as const,
        result, messages: assessed.messages };
    }
  }
  throw new ContextRecoveryError('unrecoverable',
    `Context budget still exceeded after full-history compaction (${assessed.evaluation.estimatedTokens}/${assessed.evaluation.hardLimitTokens} tokens, ${assessed.bytes}/${policy.maxActiveTranscriptBytes} bytes); reduce the current input, attachments or system/tool context`);
}
