import crypto from 'crypto';
import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';

import type { AgentService } from '../../agent/service.js';
import type { Config } from '../../config/schema.js';
import type { MessageBus } from '../../infra/bus/index.js';
import { prependEnvelopeTimestamp } from '../../channels/envelope-timestamp.js';
import { resolveWebchatSessionKey } from '../resolve-webchat-session-key.js';
import type { SessionIndex } from '../../session/index.js';
import type { SessionMetadata } from '../../session/types.js';
import {
  createLogger,
  inboundCorrelationMetadataFromAsyncLogContext,
  updateAsyncLogContext,
} from '../../utils/logger.js';
import { parseSessionKey } from '../../routing/session-key.js';
import { recordExplicitRelationshipFollowUp } from '../../user-context/relationship-continuity.js';
import { resolveExecutionContext } from '../../tasks/execution-context.js';
import { TaskRunCoordinator } from '../../tasks/task-run-coordinator.js';
import {
  updateInteractionStateFromMessage,
} from '../../storage/sqlite/index.js';
import type { TaskRunReceipt } from '@xopcai/gateway-contract';

import { formatAgentRunErrorForClient } from '../../agent/client-error-format.js';

import { ChatStreamMapper } from '../chat-stream/mapper.js';
import { coalesceThinkingDeltas } from '../chat-stream/thinking-delta-coalescer.js';
import type { ChatStreamEvent } from '../chat-stream/protocol.js';
import type { AgentRunRelay } from '../agent-run-relay.js';
import { MAX_CHAT_ATTACHMENTS } from '../chat-limits.js';
import type { UserTurnAttachment } from '../user-turn-input.js';
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
  origin: TurnOrigin,
  attachments?: UserTurnAttachment[],
  thinking?: string,
  runOptions?: { signal?: AbortSignal; runId?: string },
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

  const runId = runOptions?.runId ?? crypto.randomUUID();
  const {
    agentService,
    bus,
    runRelay,
    runAbortControllers,
    activeWebchatRunBySession,
    sessionIndex: sessionIndexFromDeps,
    emit,
  } = deps;
  const sessionIndex = sessionIndexFromDeps;
  let taskRun: TaskRunCoordinator | undefined;
  let taskRunStatus: TaskRunReceipt['status'] = 'failed';
  let taskRunSummary = 'Agent run ended unexpectedly';

  let webchatSessionKey: string | undefined;
  let webchatSessionId: string | undefined;
  let webchatMetadata: SessionMetadata | undefined;
  if (channel === 'webchat') {
    const resolved = resolveWebchatSessionKey({ sessionKey: chatId });
    if (resolved.ok === false) {
      throw new Error(resolved.error);
    }
    webchatSessionKey = resolved.sessionKey;
    const meta = await sessionIndex.getSessionMetadata(webchatSessionKey);
    if (!meta) {
      throw new Error('Session not found; create sessions via POST /api/sessions');
    }
    webchatSessionId = meta?.sessionId;
    webchatMetadata = meta;
    runRelay.ensureRun(runId, webchatSessionKey);
    runAbortControllers.set(runId, new AbortController());
  }

  const streamSessionKey = webchatSessionKey ?? chatId;
  if (webchatSessionKey) {
    if (!webchatMetadata) throw new Error('Session metadata is unavailable');
    const parsedSession = parseSessionKey(webchatSessionKey);
    if (!parsedSession) throw new Error('Resolved webchat session key is invalid');
    updateInteractionStateFromMessage({ sessionKey: webchatSessionKey, message });
    recordExplicitRelationshipFollowUp({
      sessionKey: webchatSessionKey,
      sourceAgentId: parsedSession.agentId,
      message,
    });
    const executionContext = resolveExecutionContext({
      runId,
      sessionKey: webchatSessionKey,
      channel,
      metadata: webchatMetadata,
    });
    taskRun = TaskRunCoordinator.start({
      runId,
      context: executionContext,
      fallbackObjective: message,
    });
  }
  const mapper = new ChatStreamMapper({ runId, sessionKey: streamSessionKey, channel });
  let registeredActiveWebchatRun = false;
  const captureTaskEvent = (event: ChatStreamEvent): void => {
    if (event.type === 'task_plan_updated') {
      taskRun?.capturePlan(event.payload.items);
      return;
    }
    if (event.type === 'turn_plan') {
      taskRun?.capturePlan(event.payload.plan.map((item) => ({ title: item.step, status: item.status })));
      return;
    }
    if (event.type === 'patch_applied') {
      taskRun?.capturePatch(event.payload.added, event.payload.removed);
      return;
    }
    if (
      event.type === 'command_completed'
      && event.payload.exitCode === 0
      && /(^|\s)(test|vitest|jest|pytest|lint|typecheck|build)(\s|$|:)/i.test(event.payload.command)
    ) {
      taskRun?.captureCommand(event.payload.command, event.payload.durationMs);
    }
  };
  const publishStreamEvent = (event: ChatStreamEvent): ChatStreamEvent =>
    channel === 'webchat'
      ? ((runRelay.publish(runId, event as unknown as import('../agent-run-relay.js').RelayEvent) as unknown as ChatStreamEvent | undefined) ?? event)
      : event;
  const emitAndYield = function *(events: ChatStreamEvent[]): Generator<ChatStreamEvent> {
    for (const event of events) {
      if (taskRun) captureTaskEvent(event);
      const relayedEvent = publishStreamEvent(event);
      if (channel === 'webchat') emit('agent.stream', { sessionKey: streamSessionKey, event: relayedEvent });
      yield relayedEvent;
    }
  };

  yield* emitAndYield(mapper.start());

  try {
    if (channel === 'webchat' && webchatSessionKey) {
      const sessionKey = webchatSessionKey;
      updateAsyncLogContext({
        sessionKey,
        ...(webchatSessionId ? { sessionId: webchatSessionId } : {}),
      });

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
      if (!activeWebchatRunBySession.has(sessionKey)) {
        activeWebchatRunBySession.set(sessionKey, runId);
        registeredActiveWebchatRun = true;
      }
      let streamError: string | undefined;
      try {
        const eventStream = agentService.turnDispatcher.processDirectStreaming(
          stampedMessage,
          sessionKey,
          origin,
          prepared,
          thinking,
          { signal: mergedSignal, runId },
        );

        const mappedEvents = (async function* (): AsyncGenerator<ChatStreamEvent> {
          for await (const event of eventStream) {
            yield* mapper.map(event);
          }
        })();
        for await (const event of coalesceThinkingDeltas(mappedEvents)) {
          yield* emitAndYield([event]);
        }

        const endStatus = mergedSignal.aborted ? 'cancelled' : 'success';
        const endSummary = mergedSignal.aborted ? 'Interrupted' : 'Message processed successfully';
        taskRunStatus = mergedSignal.aborted ? 'cancelled' : 'succeeded';
        taskRunSummary = endSummary;
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
        taskRunStatus = 'failed';
        taskRunSummary = em;
        const errorContent = formatAgentRunErrorForClient(streamError);
        yield* emitAndYield(mapper.error(errorContent));
        yield* emitAndYield(mapper.end('error', streamError));
        runRelay.complete(runId);
        return { status: 'error', summary: streamError };
      } finally {
        if (registeredActiveWebchatRun && activeWebchatRunBySession.get(sessionKey) === runId) {
          activeWebchatRunBySession.delete(sessionKey);
        }
        runAbortControllers.delete(runId);
        const assistantPlainText = agentService.getLastAssistantPlainText(sessionKey);
        const reviewHint = agentService.takeTaskReviewStreamHint(sessionKey);
        try {
          await agentService.outboundCoordinator.emitSessionTurnComplete({
            sessionKey,
            channel: 'webchat',
            chatId: sessionKey,
            inboundUserText: message,
            assistantPlainText,
            aborted: mergedSignal.aborted,
            ...(streamError !== undefined ? { streamError } : {}),
            skipTaskReview: reviewHint?.skipTaskReview ?? false,
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
        payload: { messageId, presentation: 'answer' },
      },
    ]);
    yield* emitAndYield(mapper.end('success', 'Message processed'));
    taskRunStatus = 'succeeded';
    taskRunSummary = 'Message processed';
    return { status: 'ok', summary: 'Message processed' };
  } catch (error) {
    const em = error instanceof Error ? error.message : String(error);
    taskRunStatus = 'failed';
    taskRunSummary = em;
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
  } finally {
    if (taskRun) {
      try {
        taskRun.finalize({
        status: taskRunStatus,
        summary: taskRunSummary,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log.warn({ err, runId }, `Task run finalization failed: ${errorMessage}`);
      }
    }
  }
}
