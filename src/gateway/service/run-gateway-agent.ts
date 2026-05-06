import crypto from 'crypto';

import type { AgentService } from '../../agent/service.js';
import { prependEnvelopeTimestamp } from '../../channels/envelope-timestamp.js';
import type { Config } from '../../config/schema.js';
import type { MessageBus } from '../../infra/bus/index.js';
import { buildSessionKey, parseSessionKey } from '../../routing/session-key.js';
import { getDefaultAgentId } from '../../routing/resolve-route.js';
import type { SessionManager } from '../../session/index.js';
import {
  createLogger,
  inboundCorrelationMetadataFromAsyncLogContext,
} from '../../utils/logger.js';
import { shouldSkipWebchatInboundByAbortCutoff } from '../../session/abort-cutoff.js';

import type { AgentRunRelay } from '../agent-run-relay.js';
import { MAX_CHAT_ATTACHMENTS } from '../chat-limits.js';
import { saveWebchatUserMessage } from './save-webchat-user-message.js';

const log = createLogger('GatewayService');

export type RunGatewayAgentYield = {
  type: string;
  content?: string;
  status?: string;
  runId?: string;
};

export type RunGatewayAgentDeps = {
  config: Config;
  agentService: AgentService;
  bus: MessageBus;
  runRelay: AgentRunRelay;
  runAbortControllers: Map<string, AbortController>;
  activeWebchatRunBySession: Map<string, string>;
  sessionManager: SessionManager;
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
    sessionManager,
    emit,
  } = deps;

  let webchatSessionKey: string | undefined;
  let webchatStaleSkip = false;
  if (channel === 'webchat') {
    const parsedKey = parseSessionKey(chatId);
    webchatSessionKey = parsedKey
      ? chatId
      : buildSessionKey({
          agentId: getDefaultAgentId(config),
          source: 'webchat',
          accountId: 'default',
          peerKind: 'direct',
          peerId: chatId,
        });
    const meta = await sessionManager.getSessionMetadata(webchatSessionKey);
    webchatStaleSkip = shouldSkipWebchatInboundByAbortCutoff(meta, runOptions?.clientCreatedAtMs);
    if (!webchatStaleSkip && meta?.abortCutoffTimestamp !== undefined) {
      await sessionManager
        .updateSessionMetadata(webchatSessionKey, { abortCutoffTimestamp: undefined })
        .catch(() => {});
    }
    runRelay.ensureRun(runId, webchatSessionKey);
    runAbortControllers.set(runId, new AbortController());
  }

  const statusEvent = { type: 'status', status: 'accepted', runId };
  if (channel === 'webchat') runRelay.publish(runId, statusEvent);
  yield statusEvent;

  try {
    if (channel === 'webchat' && webchatSessionKey) {
      if (webchatStaleSkip) {
        runRelay.complete(runId);
        runAbortControllers.delete(runId);
        return {
          status: 'skipped',
          summary: 'Stale inbound after abort (clientCreatedAtMs before cutoff)',
        };
      }

      const sessionKey = webchatSessionKey;

      const timezone = agentService.resolveUserTimezoneForSession(sessionKey);
      const stampedMessage = message.trimStart().startsWith('/')
        ? message
        : prependEnvelopeTimestamp(message, timezone);
      const prepared = await agentService.prepareInboundAttachments(sessionKey, cappedAttachments);

      try {
        await saveWebchatUserMessage(sessionManager, sessionKey, message, prepared);
      } catch (err) {
        log.error({ err, sessionKey }, 'Failed to save user message');
      }

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
        emit('agent.stream', { sessionKey, event: statusEvent });
        const eventStream = agentService.processDirectStreaming(stampedMessage, sessionKey, prepared, thinking, {
          signal: mergedSignal,
        });

        for await (const event of eventStream) {
          runRelay.publish(runId, event);
          emit('agent.stream', { sessionKey, event });
          yield event as RunGatewayAgentYield;
        }

        runRelay.complete(runId);
        try {
          const metaAfter = await sessionManager.getSessionMetadata(sessionKey);
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
        log.error({ error }, 'Agent processing failed');
        streamError = error instanceof Error ? error.message : 'Unknown error';
        const errorEvent = { type: 'error', content: `Error: ${streamError}` };
        runRelay.publish(runId, errorEvent);
        emit('agent.stream', { sessionKey, event: errorEvent });
        runRelay.complete(runId);
        yield errorEvent;
        return { status: 'error', summary: streamError };
      } finally {
        activeWebchatRunBySession.delete(sessionKey);
        runAbortControllers.delete(runId);
        const assistantPlainText = agentService.getLastAssistantPlainText(sessionKey);
        const streamOutcome = agentService.takePersistentGoalStreamOutcome(sessionKey);
        try {
          await agentService.emitSessionTurnComplete({
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

    yield { type: 'token', content: 'Processing...\n' };
    await new Promise((resolve) => setTimeout(resolve, 1000));
    yield { type: 'token', content: 'Done\n' };
    return { status: 'ok', summary: 'Message processed' };
  } catch (error) {
    log.error({ error }, 'Agent run failed');
    throw error;
  }
}
