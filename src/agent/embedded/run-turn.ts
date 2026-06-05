import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent, Model, Api } from '@earendil-works/pi-ai';

import { createLogger } from '../../utils/logger.js';
import { registerEmbeddedRun, unregisterEmbeddedRun } from './runs.js';
import { subscribeEmbeddedSessionEvents, lastAssistantPlainText } from './subscribe-session.js';
import type { RunXopcEmbeddedTurnParams, RunXopcEmbeddedTurnResult } from './types.js';
import {
  isAssistantTurnAborted,
  isAssistantTurnFailed,
  maybeRetryTurnAfterTransientLlmFailure,
} from '../orchestration/llm-turn-retry.js';
import { runAgentTurnWithTimeout, resolveAgentTurnTimeoutMs } from '../orchestration/run-agent-turn-with-timeout.js';
import { detectToolLoops, type RecentToolCall } from '../orchestration/loop-guard.js';
import {
  acquireEmbeddedSessionRunner,
  resolveEmbeddedTranscriptInputs,
} from './session-runner.js';
import { wrapStreamFnForXopcExtensions } from './xopc-stream-bridge.js';

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
  const calls: RecentToolCall[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block && typeof block === 'object' && (block as { type?: string }).type === 'toolCall') {
        const toolCall = block as { name: string; arguments: unknown };
        calls.push({ name: toolCall.name, params: toolCall.arguments });
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

function userMessageToPromptImages(message: AgentMessage): ImageContent[] {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return [];
  }

  const images: ImageContent[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue;
    }
    const typedBlock = block as { type?: string; data?: unknown; mimeType?: unknown };
    if (typedBlock.type !== 'image' || typeof typedBlock.data !== 'string' || typedBlock.data.length === 0) {
      continue;
    }
    images.push({
      type: 'image',
      data: typedBlock.data,
      mimeType: typeof typedBlock.mimeType === 'string' ? typedBlock.mimeType : 'image/png',
    });
  }
  return images;
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
  const transcript = await resolveEmbeddedTranscriptInputs(sessionStore, sessionKey);

  let runner: Awaited<ReturnType<typeof acquireEmbeddedSessionRunner>> | undefined;
  let unsubscribe: (() => void) | undefined;

  try {
    runner = await acquireEmbeddedSessionRunner({
      sessionKey,
      sessionId: transcript.sessionId,
      sessionFile: transcript.sessionFile,
      sessionsDir: transcript.sessionsDir,
      hadSessionFile: transcript.hadSessionFile,
      workspaceDir,
      model: resolvedModel,
      modelRef: params.modelRef,
      tools,
      systemPrompt,
      thinkingLevel: thinkingLevel ?? 'medium',
    });

    const { session, reused } = runner;

    const streamFnWithXopcExtensions = wrapStreamFnForXopcExtensions(session.agent.streamFn);
    const loggingStreamFn: typeof session.agent.streamFn = (streamModel, context, options) => {
      const recentToolCalls = extractRecentToolCalls(context.messages);
      const loopGuard = detectToolLoops(recentToolCalls);

      let effectiveContext = context;
      if (loopGuard.injection || loopGuard.hiddenTools.size > 0) {
        const messages = loopGuard.injection
          ? [...context.messages, { role: 'user' as const, content: loopGuard.injection, timestamp: Date.now() }]
          : context.messages;

        const contextTools = loopGuard.hiddenTools.size > 0 && context.tools
          ? context.tools.filter((t) => !loopGuard.hiddenTools.has(t.name))
          : context.tools;

        effectiveContext = { ...context, messages, tools: contextTools };
      }

      log.debug(
        {
          sessionKey,
          runId,
          reusedRunner: reused,
          modelRef: `${streamModel.provider}/${streamModel.id}`,
          systemPromptLength: effectiveContext.systemPrompt?.length ?? 0,
          messageCount: effectiveContext.messages.length,
          toolCount: effectiveContext.tools?.length ?? 0,
          lastUserMessagePreview: getLastUserMessagePreview(effectiveContext.messages),
          loopWarningInjected: !!loopGuard.injection,
          hiddenToolCount: loopGuard.hiddenTools.size,
        },
        'Sending messages to AI',
      );
      return streamFnWithXopcExtensions(streamModel, effectiveContext, options);
    };
    session.agent.streamFn = loggingStreamFn;

    if (onEvent) {
      unsubscribe = subscribeEmbeddedSessionEvents(session, onEvent);
    }

    const handle = {
      sessionKey,
      sessionId: transcript.sessionId,
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
          const text = userMessageToPromptText(userMessage);
          const images = [...(params.images ?? []), ...userMessageToPromptImages(userMessage)];
          await session.prompt(text, images.length > 0 ? { images } : undefined);
          await session.agent.waitForIdle();
          await maybeRetryTurnAfterTransientLlmFailure(session.agent, { sessionKey, log });
        },
        timeoutMs,
      );

      if (isAssistantTurnAborted(session.agent)) {
        return { ok: true, lastAssistantText: lastAssistantPlainText(session) };
      }
      if (isAssistantTurnFailed(session.agent)) {
        return {
          ok: false,
          errorMessage: 'Assistant turn failed',
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
    onEvent?.({ type: 'error', content: em });
    return { ok: false, errorMessage: em };
  } finally {
    unsubscribe?.();
    try {
      runner?.piSm.flushPendingToolResults?.();
    } catch {
      /* ignore */
    }
    runner?.release();
  }
}

export { abortEmbeddedRun, queueEmbeddedSteer } from './runs.js';
