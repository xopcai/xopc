import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent } from '@earendil-works/pi-ai';
import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';

import type { Config } from '../../config/schema.js';
import type { InboundAttachmentInput, MediaRef } from '../../channels/attachments/inbound-persist.js';
import { readAgentMessageContent } from '../memory/agent-message-access.js';
import {
  isVoiceLikeAttachment,
  mergeVoiceTranscriptsIntoUserText,
} from '../../channels/attachments/voice-stt-webchat.js';
import { mergeSttConfigFromAppConfig } from '../../voice/stt/index.js';
import {
  resolveEffectiveReasoningLevel,
  resolveConfiguredActivityDetailDefault,
  initSessionTurn,
  type SessionConfigStore,
  type SessionStore,
} from '../../session/index.js';
import type { SessionContext } from '../session/index.js';
import { applyReasoningVisibility } from '../streaming/reasoning-visibility.js';
import type { ReasoningLevel } from '../transcript/thinking-types.js';
import { formatAgentRunErrorForClient } from '../client-error-format.js';
import { abortEmbeddedRun } from '../embedded/runs.js';
import type { AgentInstanceGateway } from '../agent-instance-gateway.js';
import type { CommandHandler } from '../messaging/command-handler.js';
import type { ModelManager } from '../models/index.js';
import { injectSourceContextIntoUserMessage } from '../source-context/injector.js';
import { isSessionSourceBinding, type AgentSourceContextResolver } from '../source-context/types.js';
import type { ReviewOutput } from '../../review/review-types.js';

import { AsyncQueue } from './async-queue.js';
import {
  hydratePerTurnState,
  runDirectAgentTurn,
  tryRunSlashCommand,
} from './direct-turn-helpers.js';
import {
  clearPendingTranscriptUserMessage,
  setPendingTranscriptUserMessage,
  type TranscriptUserMessage,
} from '../inbound/attachment-pipeline.js';

export type DirectStreamInboundAttachment = InboundAttachmentInput;

export type ProcessDirectStreamLog = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  debug?: (obj: Record<string, unknown>, msg: string) => void;
};

export interface ProcessDirectStreamingDeps {
  log: ProcessDirectStreamLog;
  resolveSessionEndpoint: (sessionKey: string) => Promise<{ channel: string; chatId: string }>;
  initDirectStreamingSession: (
    sessionKey: string,
    channel: string,
    chatId: string,
    origin: TurnOrigin,
  ) => SessionContext;
  registerWebchatStreamPublisher: (
    sessionKey: string,
    publisher: (event: { type: string; [key: string]: unknown }) => void,
  ) => void;
  unregisterWebchatStreamPublisher: (sessionKey: string) => void;
  agentManager: AgentInstanceGateway;
  hydrateSessionWorkspaceFromStore: (sessionKey: string) => Promise<void>;
  hydrateSessionModelFromStore: (sessionKey: string) => Promise<void>;
  sessionStore: SessionStore;
  modelManager: ModelManager;
  applyResolvedThinkingLevel: (sessionKey: string, thinking?: string | null) => Promise<void>;
  getConfig: () => Config | undefined;
  sessionConfigStore: SessionConfigStore;
  commandHandler: Pick<CommandHandler, 'executeCommandAndAggregateReply'>;
  prepareInboundAttachments: (
    sessionKey: string,
    attachments?: DirectStreamInboundAttachment[],
  ) => Promise<MediaRef[] | undefined>;
  buildTranscriptUserMessage: (
    content: string,
    prepared: MediaRef[] | undefined,
    sessionKey: string,
  ) => Promise<TranscriptUserMessage>;
  recordTaskReviewStreamHint?: (
    sessionKey: string,
    task: { skipTaskReview: boolean },
  ) => void;
  onTurnComplete?: (sessionKey: string, lastAssistantText?: string) => void;
  enqueueProvisionalSessionTitle?: (sessionKey: string, userText: string) => void;
  /** Disk-only transcript sync (slash receipt already streamed as tokens). */
  reloadWebchatTranscript?: (sessionKey: string) => void;
  maybeEmitWebchatTts: (
    sessionKey: string,
    hadInboundVoice: boolean,
  ) => Promise<{ type: 'tts_audio'; uri: string; mimeType: string; name: string } | null>;
  endDirectRequestContext: () => void;
  resetSession: (sessionKey: string) => Promise<{ sessionId: string; previousSessionId: string } | null>;
  sourceContextResolver?: AgentSourceContextResolver;
}

export interface ProcessDirectStreamingInput {
  content: string;
  sessionKey?: string;
  origin: TurnOrigin;
  attachments?: DirectStreamInboundAttachment[];
  thinking?: string;
  signal?: AbortSignal;
  runId?: string;
}

export type ProcessDirectStreamEvent = { type: string; [key: string]: unknown };

function isReviewOutput(value: unknown): value is ReviewOutput {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (value as { type?: unknown }).type === 'review';
}

const REVIEW_TRACE_PREVIEW_MAX = 2_000;

type ReviewTraceContextEntry = {
  id: string;
  text: string;
  data: Record<string, unknown>;
  createdAt: string;
};

function boundedPreview(text: string): string {
  return text.length > REVIEW_TRACE_PREVIEW_MAX
    ? `${text.slice(0, REVIEW_TRACE_PREVIEW_MAX)}\n[trace preview truncated]`
    : text;
}

function extractTraceResultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return result == null ? '' : String(result);
  }
  const rec = result as Record<string, unknown>;
  if (typeof rec.text === 'string') return rec.text;
  if (Array.isArray(rec.content)) {
    return rec.content
      .map((block) => {
        if (!block || typeof block !== 'object') return '';
        const b = block as Record<string, unknown>;
        return b.type === 'text' && typeof b.text === 'string' ? b.text : '';
      })
      .join('');
  }
  return '';
}

function reviewTraceContextEntryFromCommandEvent(
  event: { type: string; [key: string]: unknown },
  runId: string | undefined,
): ReviewTraceContextEntry | null {
  if (event.type === 'review_start' || event.type === 'review_end') {
    const reviewId = typeof event.reviewId === 'string' && event.reviewId
      ? event.reviewId
      : `review_trace_${Date.now()}`;
    const ended = event.type === 'review_end';
    const isError = ended && event.status === 'error';
    return {
      id: `review-trace:${reviewId}:${ended ? 'end' : 'start'}`,
      text: ended
        ? `Review trace: ${isError ? 'failed' : 'completed'}`
        : 'Review trace: started',
      createdAt: new Date().toISOString(),
      data: {
        type: 'review_trace',
        scope: 'review',
        event: ended ? 'review_end' : 'review_start',
        llmInput: false,
        ...(runId ? { runId } : {}),
        reviewId,
        status: ended ? (isError ? 'error' : 'done') : 'running',
        ...(typeof event.target === 'string' ? { target: event.target } : {}),
        ...(typeof event.message === 'string' ? { message: event.message } : {}),
        ...(isError ? { isError: true } : {}),
      },
    };
  }
  if (event.type !== 'tool_execution_start' && event.type !== 'tool_execution_end') {
    return null;
  }
  const toolName = typeof event.toolName === 'string' ? event.toolName : '';
  if (!toolName.startsWith('review.')) {
    return null;
  }
  const toolCallId = typeof event.toolCallId === 'string' && event.toolCallId
    ? event.toolCallId
    : `review_trace_${Date.now()}`;
  const ended = event.type === 'tool_execution_end';
  const isError = ended && event.isError === true;
  const resultPreview = ended ? boundedPreview(extractTraceResultText(event.result).trim()) : undefined;
  const details = ended && event.result && typeof event.result === 'object' && !Array.isArray(event.result)
    ? (event.result as Record<string, unknown>).details
    : undefined;

  return {
    id: `review-trace:${toolCallId}:${ended ? 'end' : 'start'}`,
    text: ended
      ? `Review trace: ${toolName} ${isError ? 'failed' : 'completed'}`
      : `Review trace: ${toolName} started`,
    createdAt: new Date().toISOString(),
    data: {
      type: 'review_trace',
      scope: 'review',
      event: ended ? 'tool_end' : 'tool_start',
      llmInput: false,
      ...(runId ? { runId } : {}),
      toolCallId,
      toolName,
      status: ended ? (isError ? 'error' : 'done') : 'running',
      ...(event.args !== undefined ? { input: event.args } : {}),
      ...(resultPreview ? { resultPreview } : {}),
      ...(details !== undefined ? { details } : {}),
      ...(isError ? { isError: true } : {}),
    },
  };
}

function makeAssistantReceiptMessage(text: string, metadata?: Record<string, unknown>): AgentMessage {
  const review = isReviewOutput(metadata?.review) ? metadata.review : undefined;
  return {
    role: 'assistant',
    content: review ? [review] : [{ type: 'text', text }],
    timestamp: Date.now(),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
  } as AgentMessage;
}

function pushAssistantReceipt(
  queue: AsyncQueue<ProcessDirectStreamEvent>,
  text: string,
  runId?: string,
  metadata?: Record<string, unknown>,
): void {
  const message = makeAssistantReceiptMessage(text, metadata);
  queue.push({ type: 'message_start', runId, message });
  queue.push({ type: 'assistant_snapshot', runId, message });
  queue.push({ type: 'message_end', runId, message });
}

export async function* runProcessDirectStreaming(
  deps: ProcessDirectStreamingDeps,
  input: ProcessDirectStreamingInput,
): AsyncGenerator<ProcessDirectStreamEvent, void, unknown> {
  const sessionKey = input.sessionKey ?? 'agent:main:main';
  const { channel, chatId } = await deps.resolveSessionEndpoint(sessionKey);
  const context = deps.initDirectStreamingSession(sessionKey, channel, chatId, input.origin);

  const queue = new AsyncQueue<ProcessDirectStreamEvent>();
  let reasoningLevel: ReasoningLevel = channel === 'webchat'
    ? resolveConfiguredActivityDetailDefault(deps.getConfig())
    : 'stream';

  const pushVisible = (event: ProcessDirectStreamEvent) => {
    // Webchat presentation is client-owned so changing the setting takes effect mid-run.
    const visible = channel === 'webchat'
      ? event
      : applyReasoningVisibility(event, reasoningLevel);
    if (visible !== null) {
      queue.push(visible);
    }
  };

  const formatStreamError = (raw: string): string => {
    let provider: string | undefined;
    let modelRef: string | undefined;
    try {
      const resolved = deps.modelManager.getResolvedModelForSession(sessionKey);
      provider = resolved.provider;
      modelRef = deps.modelManager.getModelForSession(sessionKey);
    } catch {
      /* ignore — format without provider context */
    }
    return formatAgentRunErrorForClient(raw, { provider, modelRef });
  };

  if (channel === 'webchat') {
    deps.registerWebchatStreamPublisher(sessionKey, pushVisible);
  }

  const signal = input.signal;
  let userAborted = false;
  let abortHandled = false;
  let inboundVoice = false;
  let ranSlashCommand = false;
  let mergedUserText = input.content;
  let webchatSlashReceipt: string | undefined;
  let slashCommandMetadata: Record<string, unknown> | undefined;
  const slashTraceRows: ReviewTraceContextEntry[] = [];

  const taskPromise = (async () => {
    try {
      const cfg = deps.getConfig();
      let turnBody = input.content;
      let resetTriggeredAtInit = false;
      if (cfg) {
        const turn = await initSessionTurn({
          cfg,
          sessionKey,
          body: input.content,
          resetSession: deps.resetSession,
        });
        resetTriggeredAtInit = turn.resetTriggered;
        if (turn.bareReset && turn.ackMessage) {
          ranSlashCommand = true;
          webchatSlashReceipt = turn.ackMessage;
          pushAssistantReceipt(queue, turn.ackMessage, input.runId);
          return;
        }
        turnBody = turn.bodyStripped;
        if (turn.isNewSession) {
          deps.log.debug(
            {
              sessionKey,
              sessionId: turn.sessionId,
              previousSessionId: turn.previousSessionId,
              resetTriggered: turn.resetTriggered,
              staleRollover: turn.staleRollover,
            },
            'Session reset boundary at direct turn start',
          );
        }
      }

      await hydratePerTurnState(deps, sessionKey, input.thinking);
      {
        const defReason = channel === 'webchat'
          ? resolveConfiguredActivityDetailDefault(cfg)
          : 'stream';
        reasoningLevel = await resolveEffectiveReasoningLevel(deps.sessionConfigStore, sessionKey, defReason);
      }

      const prepared = await deps.prepareInboundAttachments(sessionKey, input.attachments);

      const sttCfg = mergeSttConfigFromAppConfig(deps.getConfig()?.tools?.media?.audio, deps.getConfig()?.tools?.media);
      const voiceMerge = await mergeVoiceTranscriptsIntoUserText(prepared, turnBody, sttCfg);
      mergedUserText = voiceMerge.text;
      inboundVoice = voiceMerge.inboundVoice;

      if (inboundVoice) {
        const transcriptParts = [
          voiceMerge.voiceTranscripts.filter(Boolean).join('\n'),
          turnBody.trim(),
        ].filter(Boolean);
        const voiceMedia = (prepared ?? []).filter(isVoiceLikeAttachment).map((att) => ({
          uri: att.uri,
          mimeType: att.mimeType,
          name: att.name,
        }));
        pushVisible({
          type: 'user_transcript',
          text: transcriptParts.join('\n\n'),
          media: voiceMedia,
        });
      }

      const armAbort = () => {
        if (abortHandled) {
          return;
        }
        abortHandled = true;
        userAborted = true;
        void abortEmbeddedRun(sessionKey);
        queue.close();
      };
      if (signal) {
        if (signal.aborted) {
          armAbort();
          return;
        }
        signal.addEventListener('abort', armAbort, { once: true });
      }

      const slash = await tryRunSlashCommand(
        deps,
        {
          sessionKey,
          channel,
          chatId,
          senderId: context.senderId,
          isGroup: context.isGroup,
          inboundMetadata: context.metadata,
        },
        mergedUserText,
        {
          skipResetCommands: resetTriggeredAtInit,
          emitEvent: (event) => {
            pushVisible({ ...event, runId: input.runId });
            const traceRow = reviewTraceContextEntryFromCommandEvent(event, input.runId);
            if (traceRow) {
              slashTraceRows.push(traceRow);
            }
          },
        },
      );
      if (slash.matched) {
        ranSlashCommand = true;
        slashCommandMetadata = slash.metadata;
        const text = slash.aggregatedText.trim();
        if (text) {
          webchatSlashReceipt = text;
          pushAssistantReceipt(queue, text, input.runId, slashCommandMetadata);
        } else if (channel === 'webchat') {
          webchatSlashReceipt =
            'Command finished with no assistant text. An Task continuation may still be scheduled automatically.';
          pushAssistantReceipt(queue, webchatSlashReceipt, input.runId);
        }
        const workflowRun = slash.metadata?.workflowRun;
        if (workflowRun && typeof workflowRun === 'object') {
          queue.push({
            type: 'workflow_run_started',
            runId: input.runId,
            payload: { workflowRun },
          });
        }
        return;
      }

      const skillTurn = deps.agentManager.prepareSkillTurn(sessionKey, mergedUserText);
      const textForAgent = skillTurn.text;
      const userMessage = await deps.buildTranscriptUserMessage(textForAgent, prepared, sessionKey);
      let sourceEnrichedUserMessage: AgentMessage = userMessage;
      let sourceImages: ImageContent[] | undefined;
      if (deps.sourceContextResolver) {
        const metadata = await deps.sessionStore.getMetadata(sessionKey).catch(() => null);
        const sourceBinding = metadata?.customData && typeof metadata.customData === 'object'
          ? (metadata.customData as Record<string, unknown>).sourceBinding
          : undefined;
        if (isSessionSourceBinding(sourceBinding)) {
          const sourceContext = await deps.sourceContextResolver(sourceBinding, sessionKey);
          sourceEnrichedUserMessage = injectSourceContextIntoUserMessage(userMessage, sourceContext);
          sourceImages = sourceContext?.images;
        }
      }

      if (channel === 'webchat') {
        pushVisible({
          type: 'user_message',
          timestamp: userMessage.timestamp ?? Date.now(),
          content: readAgentMessageContent(userMessage),
          media: userMessage.media,
        });
        if (textForAgent.trim()) {
          deps.enqueueProvisionalSessionTitle?.(sessionKey, textForAgent);
        }
      }

      const pendingUserMessage = userMessage as TranscriptUserMessage;
      setPendingTranscriptUserMessage(sessionKey, pendingUserMessage);

      try {
        const result = await deps.agentManager.withSkillCapabilities(
          sessionKey,
          skillTurn.activatedCapabilityNames,
          () =>
            runDirectAgentTurn(
              {
                sessionStore: deps.sessionStore,
                agentManager: deps.agentManager,
                modelManager: deps.modelManager,
                config: deps.getConfig(),
              },
              {
                sessionKey,
                userMessage: sourceEnrichedUserMessage,
                abortSignal: signal,
                sourceImages,
                runId: input.runId,
                onEvent: (embeddedEvent) => {
                  const event = { ...embeddedEvent };
                  if (event.type === 'error' && typeof event.content === 'string') {
                    event.content = formatStreamError(event.content);
                  }
                  pushVisible(event);
                },
              },
            ),
        );

        if (result.lastAssistantText) {
          deps.onTurnComplete?.(sessionKey, result.lastAssistantText);
        }
        if (!result.ok && result.errorMessage && !abortHandled) {
          pushVisible({ type: 'error', content: formatStreamError(result.errorMessage) });
        }
      } finally {
        clearPendingTranscriptUserMessage(sessionKey, pendingUserMessage);
      }
    } catch (err) {
      if (!abortHandled) {
        const em = err instanceof Error ? err.message : String(err);
        pushVisible({ type: 'error', content: formatStreamError(em) });
      }
    } finally {
      if (!userAborted && channel === 'webchat') {
        try {
          const ttsAudioEvent = await deps.maybeEmitWebchatTts(sessionKey, inboundVoice);
          if (ttsAudioEvent) {
            queue.push(ttsAudioEvent);
          }
        } catch (ttsErr) {
          deps.log.warn({ err: ttsErr, sessionKey }, 'Failed to emit TTS audio before stream close');
        }
      }
      queue.close();
    }
  })();

  try {
    for await (const event of queue) {
      yield event;
    }
    await taskPromise;

    if (channel === 'webchat' && ranSlashCommand) {
      try {
        const userMsg = {
          role: 'user' as const,
          content: [{ type: 'text' as const, text: mergedUserText }],
          timestamp: Date.now(),
        } as AgentMessage;
        await deps.sessionStore.appendTranscriptMessage(sessionKey, userMsg);
        for (const traceRow of slashTraceRows) {
          await deps.sessionStore.appendTranscriptContextEntry(sessionKey, traceRow);
        }
        if (webchatSlashReceipt?.trim()) {
          const assistantMsg = {
            role: 'assistant' as const,
            content: isReviewOutput(slashCommandMetadata?.review)
              ? [slashCommandMetadata.review]
              : [{ type: 'text' as const, text: webchatSlashReceipt.trim() }],
            timestamp: Date.now(),
            ...(slashCommandMetadata && Object.keys(slashCommandMetadata).length > 0
              ? { metadata: slashCommandMetadata }
              : {}),
          } as AgentMessage;
          await deps.sessionStore.appendTranscriptMessage(sessionKey, assistantMsg);
        }
        deps.reloadWebchatTranscript?.(sessionKey);
      } catch (err) {
        deps.log.warn({ err, sessionKey }, 'Failed to persist webchat slash command receipt');
      }
    }

    deps.recordTaskReviewStreamHint?.(sessionKey, { skipTaskReview: ranSlashCommand });
  } finally {
    if (channel === 'webchat') {
      deps.unregisterWebchatStreamPublisher(sessionKey);
    }
    deps.endDirectRequestContext();
  }
}
