import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';
import type { Model, Api } from '@earendil-works/pi-ai';

import { createLogger } from '../../utils/logger.js';
import { registerEmbeddedRun, unregisterEmbeddedRun } from './runs.js';
import { subscribeEmbeddedSessionEvents, lastAssistantPlainText } from './subscribe-session.js';
import type { RunXopcEmbeddedTurnParams, RunXopcEmbeddedTurnResult } from './types.js';
import {
  getAssistantTurnErrorMessage,
  isAssistantTurnAborted,
  isAssistantTurnFailed,
  maybeRetryTurnAfterTransientLlmFailure,
  stripTrailingErrorAssistantMessages,
} from '../orchestration/llm-turn-retry.js';
import { runAgentTurnWithTimeout, resolveAgentTurnTimeoutMs } from '../orchestration/run-agent-turn-with-timeout.js';
import { detectToolLoops, type RecentToolCall } from '../orchestration/loop-guard.js';
import { tryApplySessionTranscriptHygiene } from '../transcript/transcript-hygiene.js';
import { acquireEmbeddedSessionRunner } from './session-runner.js';
import { createSqliteTranscriptRuntime } from './transcript-runtime.js';
import { wrapStreamFnForXopcExtensions } from './xopc-stream-bridge.js';
import { projectContextForModel } from '../memory/context-budget.js';
import { isContextOverflowError } from '../orchestration/context-overflow.js';
import {
  buildPromptCacheSnapshot,
  observePromptCacheSnapshot,
} from '../../providers/prompt-cache-observability.js';
import {
  isPromptCacheExpired,
  recordPromptCacheTouch,
} from '../../providers/prompt-cache-lifecycle.js';
import { resolvePromptCachePolicy } from '../../providers/prompt-cache-plan.js';

const log = createLogger('EmbeddedRun');
const LOG_PREVIEW_MAX_CHARS = 300;

function truncateForLog(value: string, maxChars = LOG_PREVIEW_MAX_CHARS): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}…` : value;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter((block): block is { type: string; text: string } => {
      return !!block && typeof block === 'object' && (block as { type?: string }).type === 'text';
    })
    .map((block) => block.text)
    .join('');
}

function extractRecentToolCalls(messages: readonly { role?: string; content?: unknown }[]): RecentToolCall[] {
  const resultByToolCallId = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== 'toolResult') continue;
    const toolCallId = (message as { toolCallId?: unknown }).toolCallId;
    if (typeof toolCallId !== 'string' || !toolCallId) continue;
    resultByToolCallId.set(toolCallId, truncateForLog(extractTextFromContent(message.content)));
  }

  const calls: RecentToolCall[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block && typeof block === 'object' && (block as { type?: string }).type === 'toolCall') {
        const toolCall = block as { id?: string; name: string; arguments: unknown };
        calls.push({
          name: toolCall.name,
          params: toolCall.arguments,
          ...(toolCall.id && resultByToolCallId.has(toolCall.id)
            ? { resultPreview: resultByToolCallId.get(toolCall.id) }
            : {}),
        });
      }
    }
  }
  return calls;
}

function getLastUserMessagePreview(messages: readonly { role?: string; content?: unknown }[]): string | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex];
    if (message?.role !== 'user') {
      continue;
    }
    const text = extractTextFromContent(message.content).trim();
    return text ? truncateForLog(text) : undefined;
  }
  return undefined;
}

function requireEmbeddedModel(model: Model<Api> | undefined, modelRef: string): Model<Api> {
  if (!model?.id || !model?.provider) {
    throw new Error(`Invalid model for embedded run: ${modelRef}`);
  }
  return model;
}

function userMessageToPromptText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: 'text'; text: string } => {
        return !!block && typeof block === 'object' && (block as { type?: string }).type === 'text';
      })
      .map((block) => block.text)
      .join('');
  }
  return '';
}

async function maybeRecoverContextOverflow(params: {
  agent: Agent;
  model: Model<Api>;
  sessionKey: string;
  transcriptRuntime: NonNullable<RunXopcEmbeddedTurnParams['transcriptRuntime']>;
  onEvent?: RunXopcEmbeddedTurnParams['onEvent'];
}): Promise<boolean> {
  const errorMessage = getAssistantTurnErrorMessage(params.agent);
  if (!errorMessage || !isContextOverflowError(errorMessage)) return false;

  const messages = stripTrailingErrorAssistantMessages(params.agent.state.messages);
  log.warn(
    { sessionKey: params.sessionKey, errorMessage, messageCount: messages.length },
    'Provider rejected the context window; compacting and retrying the same turn',
  );
  params.onEvent?.({ type: 'compaction', status: 'started' });

  const result = await params.transcriptRuntime.compact(
    messages,
    params.model,
    'Preserve the current pending user request verbatim and retain every fact needed to answer it.',
    true,
  );
  if (!result.compacted) {
    throw new Error(`Context overflow recovery could not find a safe compaction range: ${errorMessage}`);
  }

  params.agent.state.messages = await params.transcriptRuntime.loadMessages();
  params.onEvent?.({
    type: 'compaction',
    status: 'completed',
    tokensBefore: result.tokensBefore,
    tokensAfter: result.tokensAfter,
    summary: result.summary.length > 200 ? `${result.summary.slice(0, 200)}…` : result.summary,
  });
  await params.agent.continue();
  await params.agent.waitForIdle();
  return true;
}

export async function runXopcEmbeddedTurn(params: RunXopcEmbeddedTurnParams): Promise<RunXopcEmbeddedTurnResult> {
  const {
    sessionKey,
    runId,
    userMessage,
    model,
    tools,
    systemPrompt,
    thinkingLevel,
    workspaceDir,
    sessionStore,
    onEvent,
  } = params;

  const timeoutMs = params.timeoutMs || resolveAgentTurnTimeoutMs();
  const resolvedModel = requireEmbeddedModel(model, params.modelRef);
  const promptCachePolicy = resolvePromptCachePolicy(params.promptCachePolicy);
  const transcriptRuntime = params.transcriptRuntime ?? (
    sessionStore
      ? await createSqliteTranscriptRuntime({ sessionKey, sessionStore })
      : undefined
  );
  if (!transcriptRuntime) {
    throw new Error('Embedded run requires a transcript runtime');
  }

  let runner: Awaited<ReturnType<typeof acquireEmbeddedSessionRunner>> | undefined;
  let unsubscribe: (() => void) | undefined;

  try {
    runner = await acquireEmbeddedSessionRunner({
      runtimeId: transcriptRuntime.runtimeId,
      sessionId: transcriptRuntime.sessionId,
      workspaceDir,
      model: resolvedModel,
      modelRef: params.modelRef,
      tools,
      systemPrompt,
      thinkingLevel: thinkingLevel ?? 'medium',
      transcriptRuntime,
    });

    const { session, reused } = runner;
    runner.piSm.setActiveTurnId?.(runId);

    const streamFnWithXopcExtensions = wrapStreamFnForXopcExtensions(
      session.agent.streamFunction,
      params.promptCachePolicy,
    );
    const loggingStreamFn: typeof session.agent.streamFunction = (streamModel, context, options) => {
      const sourceMessages = [...context.messages];
      const hygienicMessages = tryApplySessionTranscriptHygiene(sourceMessages, streamModel) as typeof sourceMessages;
      const recentToolCalls = extractRecentToolCalls(hygienicMessages);
      const loopGuard = detectToolLoops(recentToolCalls);

      let effectiveContext: typeof context = { ...context, messages: hygienicMessages };
      if (loopGuard.injection || loopGuard.hiddenTools.size > 0) {
        const messages = loopGuard.injection
          ? [...hygienicMessages, { role: 'user' as const, content: loopGuard.injection, timestamp: Date.now() }]
          : hygienicMessages;

        const contextTools = loopGuard.hiddenTools.size > 0 && context.tools
          ? context.tools.filter((t) => !loopGuard.hiddenTools.has(t.name))
          : context.tools;

        effectiveContext = { ...context, messages, tools: contextTools };
      }

      const projection = projectContextForModel({
        messages: effectiveContext.messages as AgentMessage[],
        contextWindow: streamModel.contextWindow ?? 128_000,
        systemPrompt: effectiveContext.systemPrompt,
        tools: effectiveContext.tools,
        canCompact: false,
        reason: isPromptCacheExpired(sessionKey, streamModel, promptCachePolicy)
          ? 'cache_expired'
          : 'normal',
      });
      if (projection.prunedToolResults > 0 || projection.prunedImages > 0) {
        effectiveContext = {
          ...effectiveContext,
          messages: projection.messages as typeof effectiveContext.messages,
        };
        log.warn(
          {
            sessionKey,
            runId,
            prunedToolResults: projection.prunedToolResults,
            prunedImages: projection.prunedImages,
            estimatedTokens: projection.evaluation.estimatedTokens,
            hardLimitTokens: projection.evaluation.hardLimitTokens,
          },
          'Projected a smaller provider context',
        );
      }

      const promptCacheSnapshot = buildPromptCacheSnapshot({
        model: streamModel,
        systemPrompt: effectiveContext.systemPrompt,
        tools: effectiveContext.tools,
        reasoning: options?.reasoning,
      });
      const promptCacheChanges = observePromptCacheSnapshot(sessionKey, promptCacheSnapshot);

      log.debug(
        {
          sessionKey,
          runId,
          reusedRunner: reused,
          modelRef: `${streamModel.provider}/${streamModel.id}`,
          systemPromptLength: effectiveContext.systemPrompt?.length ?? 0,
          messageCount: effectiveContext.messages.length,
          transcriptRepaired: hygienicMessages !== sourceMessages,
          toolCount: effectiveContext.tools?.length ?? 0,
          lastUserMessagePreview: getLastUserMessagePreview(effectiveContext.messages),
          loopWarningInjected: !!loopGuard.injection,
          hiddenToolCount: loopGuard.hiddenTools.size,
          promptCache: promptCacheSnapshot,
          promptCacheChanges,
          ...(process.env.XOPC_LOG_LLM_PAYLOAD === 'true'
            ? {
                effectiveContext: {
                  systemPrompt: effectiveContext.systemPrompt,
                  messages: effectiveContext.messages,
                  tools: effectiveContext.tools,
                },
              }
            : {}),
        },
        'Sending messages to AI',
      );
      return streamFnWithXopcExtensions(streamModel, effectiveContext, {
        ...options,
      });
    };
    session.agent.streamFunction = loggingStreamFn;

    unsubscribe = subscribeEmbeddedSessionEvents(session, (event) => {
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        recordPromptCacheTouch(sessionKey, resolvedModel, event.message.usage);
      }
      onEvent?.({ ...event, runId });
    });

    const handle = {
      sessionKey,
      sessionId: transcriptRuntime.sessionId,
      runId,
      session,
      abort: async () => {
        await session.abort();
      },
    };
    registerEmbeddedRun(handle);

    const abortListener = () => {
      void session.abort();
    };
    if (params.abortSignal) {
      if (params.abortSignal.aborted) {
        await session.abort();
        return { ok: false, errorMessage: 'aborted' };
      }
      params.abortSignal.addEventListener('abort', abortListener, { once: true });
    }

    try {
      await runAgentTurnWithTimeout(
        session.agent,
        async () => {
          if (params.resumeLastUserMessage) {
            await session.agent.continue();
          } else {
            const text = userMessageToPromptText(userMessage);
            const images = params.images ?? [];
            await session.prompt(text, images.length > 0 ? { images } : undefined);
          }
          await session.agent.waitForIdle();
          await maybeRetryTurnAfterTransientLlmFailure(session.agent, { sessionKey, log });
          await maybeRecoverContextOverflow({
            agent: session.agent,
            model: resolvedModel,
            sessionKey,
            transcriptRuntime,
            onEvent,
          });
        },
        timeoutMs,
      );

      if (isAssistantTurnAborted(session.agent)) {
        return { ok: true, lastAssistantText: lastAssistantPlainText(session) };
      }
      if (isAssistantTurnFailed(session.agent)) {
        return {
          ok: false,
          errorMessage: getAssistantTurnErrorMessage(session.agent) ?? 'Assistant turn failed',
          lastAssistantText: lastAssistantPlainText(session),
        };
      }

      return { ok: true, lastAssistantText: lastAssistantPlainText(session) };
    } finally {
      params.abortSignal?.removeEventListener('abort', abortListener);
      unregisterEmbeddedRun(handle);
    }
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    log.error({ err, sessionKey, runId }, `Embedded run failed: ${em}`);
    onEvent?.({ type: 'error', content: em, runId });
    return { ok: false, errorMessage: em };
  } finally {
    unsubscribe?.();
    try {
      runner?.piSm.flushPendingToolResults?.();
    } catch {
      /* ignore */
    }
    runner?.piSm.setActiveTurnId?.(null);
    runner?.release();
  }
}

export { abortEmbeddedRun, queueEmbeddedSteer } from './runs.js';
