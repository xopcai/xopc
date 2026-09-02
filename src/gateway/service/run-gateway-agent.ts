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
import type {
  AgentRunEndedEvent,
  AgentStreamRunStatus,
  TaskRunReceipt,
} from '@xopcai/gateway-contract';

import { formatAgentRunErrorForClient } from '../../agent/client-error-format.js';

import { ChatStreamMapper } from '../chat-stream/mapper.js';
import { coalesceThinkingDeltas } from '../chat-stream/thinking-delta-coalescer.js';
import type { ChatStreamEvent } from '../chat-stream/protocol.js';
import { MAX_CHAT_ATTACHMENTS } from '../chat-limits.js';
import type { UserTurnAttachment } from '../user-turn-input.js';
import type { AgentSourceContext } from '../../agent/source-context/types.js';
const log = createLogger('Gateway:Service');

export type RunGatewayAgentYield = ChatStreamEvent;

export type RunGatewayAgentDeps = {
  config: Config;
  agentService: AgentService;
  bus: MessageBus;
  runAbortControllers: Map<string, AbortController>;
  activeWebchatRunBySession: Map<string, string>;
  sessionIndex: SessionIndex;
  emit: (type: string, payload: unknown) => void;
  publishRealtime: (topic: string, event: string, data: unknown) => void;
  completeRealtimeTopic: (topic: string) => void;
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
  runOptions?: { signal?: AbortSignal; runId?: string; sourceContexts?: AgentSourceContext[] },
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
    runAbortControllers,
    activeWebchatRunBySession,
    sessionIndex: sessionIndexFromDeps,
    emit,
    publishRealtime,
    completeRealtimeTopic,
  } = deps;
  const sessionIndex = sessionIndexFromDeps;
  let taskRun: TaskRunCoordinator | undefined;
  let taskRunStatus: TaskRunReceipt['status'] = 'failed';
  let taskRunSummary = 'Agent run ended unexpectedly';
  let terminalStatus: AgentStreamRunStatus = 'error';
  let runTopicCompleted = false;

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
  const emitAndYield = function *(events: ChatStreamEvent[]): Generator<ChatStreamEvent> {
    for (const event of events) {
      if (taskRun) captureTaskEvent(event);
      if (channel === 'webchat') {
        publishRealtime(`run:${runId}`, event.type, event);
      }
      yield event;
    }
  };
  try {
    yield* emitAndYield(mapper.start());

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
        publishRealtime('sessions', 'run.started', { sessionKey, runId });
      }
      let streamError: string | undefined;
      try {
        const eventStream = agentService.turnDispatcher.processDirectStreaming(
          stampedMessage,
          sessionKey,
          origin,
          prepared,
          thinking,
          { signal: mergedSignal, runId, sourceContexts: runOptions?.sourceContexts },
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
        terminalStatus = endStatus;
        taskRunSummary = endSummary;
        yield* emitAndYield(mapper.end(endStatus, endSummary));
        completeRealtimeTopic(`run:${runId}`);
        runTopicCompleted = true;
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
        terminalStatus = 'error';
        taskRunSummary = em;
        const errorContent = formatAgentRunErrorForClient(streamError);
        yield* emitAndYield(mapper.error(errorContent));
        yield* emitAndYield(mapper.end('error', streamError));
        completeRealtimeTopic(`run:${runId}`);
        runTopicCompleted = true;
        return { status: 'error', summary: streamError };
      } finally {
        if (registeredActiveWebchatRun && activeWebchatRunBySession.get(sessionKey) === runId) {
          activeWebchatRunBySession.delete(sessionKey);
          publishRealtime('sessions', 'run.completed', { sessionKey, runId, status: terminalStatus });
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
        } catch (completionErr) {
          log.warn(
            { err: completionErr, sessionKey },
            `Session turn complete failed: ${completionErr instanceof Error ? completionErr.message : String(completionErr)}`,
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
    terminalStatus = 'error';
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
    if (channel === 'webchat' && !runTopicCompleted) {
      yield* emitAndYield(mapper.error(formatAgentRunErrorForClient(em)));
      yield* emitAndYield(mapper.end('error', em));
      completeRealtimeTopic(`run:${runId}`);
      runTopicCompleted = true;
      return { status: 'error', summary: em };
    }
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
    if (webchatSessionKey) {
      const metaAfter = await sessionIndex.getSessionMetadata(webchatSessionKey).catch(() => undefined);
      const normalizedResponse = terminalStatus === 'success'
        ? mapper.getLastAssistantText().replace(/\s+/g, ' ').trim()
        : '';
      const responseCharacters = Array.from(normalizedResponse);
      const responsePreview = responseCharacters.length > 180
        ? `${responseCharacters.slice(0, 179).join('')}…`
        : normalizedResponse;
      if (metaAfter?.name) {
        emit('session.updated', { key: webchatSessionKey, name: metaAfter.name });
      }
      const endedEvent: AgentRunEndedEvent = {
        schemaVersion: 1,
        runId,
        sessionKey: webchatSessionKey,
        status: terminalStatus,
        completedAtMs: Date.now(),
        target: { kind: 'chat', sessionKey: webchatSessionKey },
        source: 'webchat',
        ...(metaAfter?.name?.trim() ? { sessionTitle: metaAfter.name.trim().slice(0, 100) } : {}),
        ...(responsePreview ? { responsePreview } : {}),
      };
      emit('agent.run.ended', endedEvent);
    }
  }
}
