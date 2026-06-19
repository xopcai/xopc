import crypto from 'crypto';

import type { AgentService } from '../../agent/service.js';
import type { Config } from '../../config/schema.js';
import type { MessageBus } from '../../infra/bus/index.js';
import { prependEnvelopeTimestamp } from '../../channels/envelope-timestamp.js';
import { resolveWebchatSessionKey } from '../resolve-webchat-session-key.js';
import type { SessionIndex } from '../../session/index.js';
import {
  createLogger,
  inboundCorrelationMetadataFromAsyncLogContext,
  updateAsyncLogContext,
} from '../../utils/logger.js';
import { shouldSkipWebchatInboundByAbortCutoff } from '../../session/abort-cutoff.js';

import { formatAgentRunErrorForClient } from '../../agent/client-error-format.js';

import { ChatStreamMapper } from '../chat-stream/mapper.js';
import type { ChatStreamEvent } from '../chat-stream/protocol.js';
import type { AgentRunRelay } from '../agent-run-relay.js';
import { MAX_CHAT_ATTACHMENTS } from '../chat-limits.js';
const log = createLogger('Gateway:Service');

export type RunGatewayAgentYield = ChatStreamEvent;

export type RunGatewayAgentDeps = {
  config: Config;
  agentService: AgentService;
  bus: MessageBus;
  runRelay: AgentRunRelay;
  runAbortControllers: Map<string, AbortController>;
  activeWebchatRunBySession: Map<string, string>;
  sessionIndex: SessionIndex;
  emit: (type: string, payload: unknown) => void;
};

/**
 * @param runOptions.signal — When set (e.g. client disconnect), aborts in-flight generation and persists partial output.
 */
export async function *runGatewayAgent(
  deps: RunGatewayAgentDeps,
  message: string,
  channel: string,
  chatId: string,
  attachments?: Array<{
    type: string;
    mimeType?: string;
    data?: string;
    name?: string;
    size?: number;
  }>,
  thinking?: string,
  runOptions?: { signal?: AbortSignal; clientCreatedAtMs?: number },
): AsyncGenerator<RunGatewayAgentYield, { status: string; summary: string }, unknown> {
  const cappedAttachments =
    attachments && attachments.length > MAX_CHAT_ATTACHMENTS
      ? attachments.slice(0, MAX_CHAT_ATTACHMENTS)
      : attachments;
  if (attachments && cappedAttachments && attachments.length > cappedAttachments.length) {
    log.debug(
      { dropped: attachments.length - cappedAttachments.length, max: MAX_CHAT_ATTACHMENTS },
      'Attachments capped for webchat',
    );
  }

  const runId = crypto.randomUUID();
  const {
    config,
    agentService,
    bus,
    runRelay,
    runAbortControllers,
    activeWebchatRunBySession,
    sessionIndex: sessionIndexFromDeps,
    emit,
  } = deps;
  const sessionIndex = sessionIndexFromDeps;

  let webchatSessionKey: string | undefined;
  let webchatStaleSkip = false;
  if (channel === 'webchat') {
    const resolved = resolveWebchatSessionKey({ cfg: config, chatId, newSession: false });
    if (resolved.ok === false) {
      throw new Error(resolved.error);
    }
    webchatSessionKey = resolved.sessionKey;
    const meta = await sessionIndex.getSessionMetadata(webchatSessionKey);
    webchatStaleSkip = shouldSkipWebchatInboundByAbortCutoff(meta, runOptions?.clientCreatedAtMs);
    if (!webchatStaleSkip && meta?.abortCutoffTimestamp !== undefined) {
      await sessionIndex
        .updateSessionMetadata(webchatSessionKey, { abortCutoffTimestamp: undefined })
        .catch(() => {});
    }
    runRelay.ensureRun(runId, webchatSessionKey);
    runAbortControllers.set(runId, new AbortController());
  }

  const streamSessionKey = webchatSessionKey ?? chatId;
  const mapper = new ChatStreamMapper({ runId, sessionKey: streamSessionKey, channel });
  const publishStreamEvent = (event: ChatStreamEvent): ChatStreamEvent =>
    channel === 'webchat'
      ? ((runRelay.publish(runId, event as unknown as import('../agent-run-relay.js').RelayEvent) as unknown as ChatStreamEvent | undefined) ?? event)
      : event;
  const emitAndYield = function *(events: ChatStreamEvent[]): Generator<ChatStreamEvent> {
    for (const event of events) {
      const relayedEvent = publishStreamEvent(event);
      if (channel === 'webchat') emit('agent.stream', { sessionKey: streamSessionKey, event: relayedEvent });
      yield relayedEvent;
    }
  };

  yield* emitAndYield(mapper.start());

  try {
    if (channel === 'webchat' && webchatSessionKey) {
      if (webchatStaleSkip) {
        yield* emitAndYield(mapper.end('cancelled', 'Stale inbound after abort (clientCreatedAtMs before cutoff)'));
        runRelay.complete(runId);
        runAbortControllers.delete(runId);
        return {
          status: 'skipped',
          summary: 'Stale inbound after abort (clientCreatedAtMs before cutoff)',
        };
      }

      const sessionKey = webchatSessionKey;
      updateAsyncLogContext({ sessionId: sessionKey });

      const timezone = agentService.resolveUserTimezoneForSession(sessionKey);
      const stampedMessage = message.trimStart().startsWith('/')
        ? message
        : prependEnvelopeTimestamp(message, timezone);
      const prepared = await agentService.prepareInboundAttachments(sessionKey, cappedAttachments);

      const runAbort = runAbortControllers.get(runId);
      if (!runAbort) {
        throw new Error('run abort controller missing for webchat');
      }
      const mergedSignal = runOptions?.signal
        ? AbortSignal.any([runOptions.signal, runAbort.signal])
        : runAbort.signal;

      agentService.beginInboundTurn(sessionKey);
      activeWebchatRunBySession.set(sessionKey, runId);
      let streamError: string | undefined;
      try {
        const eventStream = agentService.turnDispatcher.processDirectStreaming(
          stampedMessage,
          sessionKey,
          prepared,
          thinking,
          { signal: mergedSignal, runId },
        );

        for await (const event of eventStream) {
          yield* emitAndYield(mapper.map(event));
        }

        const endStatus = mergedSignal.aborted ? 'cancelled' : 'success';
        const endSummary = mergedSignal.aborted ? 'Interrupted' : 'Message processed successfully';
        yield* emitAndYield(mapper.end(endStatus, endSummary));
        runRelay.complete(runId);
        try {
          const metaAfter = await sessionIndex.getSessionMetadata(sessionKey);
          if (metaAfter?.name) {
            emit('session.updated', { key: sessionKey, name: metaAfter.name });
          }
        } catch {
          /* ignore */
        }
        return {
          status: mergedSignal.aborted ? 'aborted' : 'ok',
          summary: mergedSignal.aborted ? 'Interrupted' : 'Message processed successfully',
        };
      } catch (error) {
        const em = error instanceof Error ? error.message : String(error);
        log.error(
          {
            err: error,
            errorMessage: em,
            phase: 'gateway.agent_run',
            sessionKey,
            runId,
            channel: 'webchat',
          },
          `Agent processing failed: ${em}`,
        );
        streamError = em;
        const errorContent = formatAgentRunErrorForClient(streamError);
        yield* emitAndYield(mapper.error(errorContent));
        yield* emitAndYield(mapper.end('error', streamError));
        runRelay.complete(runId);
        return { status: 'error', summary: streamError };
      } finally {
        activeWebchatRunBySession.delete(sessionKey);
        runAbortControllers.delete(runId);
        const assistantPlainText = agentService.getLastAssistantPlainText(sessionKey);
        const streamOutcome = agentService.persistentGoals.takeStreamOutcome(sessionKey);
        try {
          await agentService.outboundCoordinator.emitSessionTurnComplete({
            sessionKey,
            channel: 'webchat',
            chatId: sessionKey,
            inboundUserText: message,
            assistantPlainText,
            aborted: mergedSignal.aborted,
            ...(streamError !== undefined ? { streamError } : {}),
            skipPersistentGoalPostTurn: streamOutcome?.skipPersistentGoalPostTurn ?? false,
            outboundMetadata: {},
          });
        } catch (goalErr) {
          log.warn(
            { err: goalErr, sessionKey },
            `Session turn complete failed: ${goalErr instanceof Error ? goalErr.message : String(goalErr)}`,
          );
        }
        agentService.endInboundTurn(sessionKey);
      }
    }

    const correlationMeta = inboundCorrelationMetadataFromAsyncLogContext();
    await bus.publishInbound({
      channel,
      sender_id: 'gateway',
      chat_id: chatId,
      content: message,
      ...(correlationMeta ? { metadata: correlationMeta } : {}),
    });

    const messageId = `msg_${runId.replace(/[^a-zA-Z0-9_-]/g, '_')}_1`;
    yield* emitAndYield([
      {
        type: 'assistant_message_start',
        runId,
        sessionKey: streamSessionKey,
        timestamp: Date.now(),
        payload: { messageId },
      },
      {
        type: 'assistant_delta',
        runId,
        sessionKey: streamSessionKey,
        timestamp: Date.now(),
        payload: { messageId, delta: 'Processing...\n' },
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    yield* emitAndYield([
      {
        type: 'assistant_delta',
        runId,
        sessionKey: streamSessionKey,
        timestamp: Date.now(),
        payload: { messageId, delta: 'Done\n' },
      },
      {
        type: 'assistant_message_end',
        runId,
        sessionKey: streamSessionKey,
        timestamp: Date.now(),
        payload: { messageId },
      },
    ]);
    yield* emitAndYield(mapper.end('success', 'Message processed'));
    return { status: 'ok', summary: 'Message processed' };
  } catch (error) {
    const em = error instanceof Error ? error.message : String(error);
    log.error(
      {
        err: error,
        errorMessage: em,
        phase: 'gateway.agent_run',
        runId,
        channel,
        chatId,
      },
      `Agent run failed: ${em}`,
    );
    throw error;
  }
}
