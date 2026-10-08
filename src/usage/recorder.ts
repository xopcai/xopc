import { randomUUID } from 'node:crypto';

import type { AssistantMessage, AssistantMessageEventStream } from '@earendil-works/pi-ai/compat';

import { startObservation, type Observation } from '../observability/runtime.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import { finishAiUsageEvent, insertAiUsageEvent } from '../storage/sqlite/ai-usage-repository.js';
import { createLogger } from '../utils/logger.js';
import { classifyCostSource, dollarsToMicrousd, pricingSnapshot } from './cost.js';
import { resolveAiUsageScenario } from './scenario-registry.js';
import type { AiUsageContext, AiUsageFinish, AiUsageModel } from './types.js';

const log = createLogger('AiUsage');

export type AiUsageCall = {
  id: string;
  finish: (result: AiUsageFinish) => void;
  run: Observation['run'];
};

export function continuesAfterTool(messages: readonly { role?: string }[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const role = messages[index]?.role;
    if (role === 'system') continue;
    return role === 'toolResult';
  }
  return false;
}

export function startAiUsageCall(model: AiUsageModel, context: AiUsageContext, input?: unknown): AiUsageCall {
  const observation = startObservation(context.operation, 'generation', context);
  observation.update({ 'gen_ai.request.model': model.id, 'gen_ai.system': model.provider });
  observation.input(input);
  const operation = context.operation;
  const scenario = resolveAiUsageScenario(operation);
  const id = randomUUID();
  const startedAt = Date.now();
  const costSource = classifyCostSource(model);
  let persisted = false;
  try {
    if (isXopcDatabaseOpen()) {
      insertAiUsageEvent({
        otelTraceId: observation.span?.spanContext().traceId,
        otelSpanId: observation.span?.spanContext().spanId,
        id,
        traceId: context.traceId ?? context.runId ?? id,
        parentEventId: context.parentEventId,
        conversationId: context.conversationId,
        runId: context.runId,
        agentId: context.agentId,
        category: scenario.category,
        operation,
        trigger: context.trigger ?? scenario.trigger,
        reasonKey: scenario.reasonKey,
        provider: model.provider,
        model: model.id,
        status: 'running',
        startedAt,
        costSource,
        pricingSnapshot: costSource === 'unknown' ? undefined : pricingSnapshot(model),
      });
      persisted = true;
    }
  } catch (err) {
    log.error({ err, operation, provider: model.provider, modelId: model.id }, 'Failed to start AI usage record');
  }
  observation.update({ 'xopc.usageEventId': id });

  let completed = false;
  return {
    id,
    run: observation.run,
    finish(result) {
      if (completed) return;
      completed = true;
      observation.update({
        'gen_ai.usage.input_tokens': result.usage?.input,
        'gen_ai.usage.output_tokens': result.usage?.output,
        'langfuse.observation.usage_details': JSON.stringify({ input: result.usage?.input, output: result.usage?.output, cache_read: result.usage?.cacheRead, cache_write: result.usage?.cacheWrite }),
        'langfuse.observation.cost_details': costSource === 'unknown' ? undefined : JSON.stringify({ total: result.usage?.cost?.total }),
        'xopc.costSource': costSource,
      });
      observation.finish(result.status === 'failed' ? 'error' : result.status === 'aborted' ? 'cancelled' : 'success', result.output ?? result.errorSummary);
      if (!persisted) return;
      try {
        finishAiUsageEvent(id, {
          ...result,
          estimatedCostMicrousd: costSource === 'local'
            ? 0
            : costSource === 'unknown' ? undefined : dollarsToMicrousd(result.usage?.cost?.total),
        });
      } catch (err) {
        log.error({ err, usageEventId: id, operation }, 'Failed to finish AI usage record');
      }
    },
  };
}

function finishFromMessage(call: AiUsageCall | undefined, message: AssistantMessage): void {
  if (!call) return;
  const status = message.stopReason === 'aborted'
    ? 'aborted'
    : message.stopReason === 'error' ? 'failed' : 'succeeded';
  call.finish({ status, usage: message.usage, errorSummary: message.errorMessage, output: message.content });
}

export function observeAiUsageStream(
  stream: AssistantMessageEventStream,
  call: AiUsageCall | undefined,
): AssistantMessageEventStream {
  if (!call) return stream;
  void stream.result().then(
    message => finishFromMessage(call, message),
    error => call.finish({ status: 'failed', errorSummary: error instanceof Error ? error.message : String(error) }),
  );
  return stream;
}

export function trackAiUsageStream(
  model: AiUsageModel,
  context: AiUsageContext,
  create: () => AssistantMessageEventStream | Promise<AssistantMessageEventStream>,
  input?: unknown,
): AssistantMessageEventStream | Promise<AssistantMessageEventStream> {
  const call = startAiUsageCall(model, context, input);
  try {
    const created = call.run(create);
    if (created instanceof Promise) {
      return created.then(
        stream => observeAiUsageStream(stream, call),
        error => {
          call?.finish({ status: 'failed', errorSummary: error instanceof Error ? error.message : String(error) });
          throw error;
        },
      );
    }
    return observeAiUsageStream(created, call);
  } catch (error) {
    call?.finish({ status: 'failed', errorSummary: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export function finishAiUsageFromMessage(call: AiUsageCall | undefined, message: AssistantMessage): void {
  finishFromMessage(call, message);
}
