import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import type { InboundAttachmentInput, MediaRef } from '../../channels/attachments/inbound-persist.js';
import { readAgentMessageContent } from '../memory/agent-message-access.js';
import {
  isVoiceLikeAttachment,
  mergeVoiceTranscriptsIntoUserText,
  mergeSttConfigFromAppConfig,
} from '../../channels/attachments/voice-stt-webchat.js';
import {
  resolveEffectiveReasoningLevel,
  initSessionTurn,
  type SessionConfigStore,
  type SessionStore,
} from '../../session/index.js';
import type { SessionContext } from '../session/index.js';
import { applyReasoningVisibilityToSseEvent } from '../streaming/reasoning-visibility-sse.js';
import type { ReasoningLevel } from '../transcript/thinking-types.js';
import { formatAgentRunErrorForClient } from '../client-error-format.js';
import { abortEmbeddedRun } from '../embedded/runs.js';
import { mapEmbeddedEventToGatewaySse } from '../embedded/map-stream-events.js';
import type { AgentInstanceGateway } from '../agent-instance-gateway.js';
import type { CommandHandler } from '../messaging/command-handler.js';
import type { ModelManager } from '../models/index.js';

import { AsyncQueue } from './async-queue.js';
import {
  hydratePerTurnState,
  runDirectAgentTurn,
  tryRunSlashCommand,
} from './direct-turn-helpers.js';
import {
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
  parseSessionKey: (sessionKey: string) => { channel: string; chatId: string };
  initDirectStreamingSession: (
    sessionKey: string,
    channel: string,
    chatId: string,
  ) => SessionContext;
  registerWebchatSsePublisher: (
    sessionKey: string,
    publisher: (event: { type: string; [key: string]: unknown }) => void,
  ) => void;
  unregisterWebchatSsePublisher: (sessionKey: string) => void;
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
  recordPersistentGoalStreamOutcome?: (
    sessionKey: string,
    outcome: { skipPersistentGoalPostTurn: boolean },
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
}

export interface ProcessDirectStreamingInput {
  content: string;
  sessionKey?: string;
  attachments?: DirectStreamInboundAttachment[];
  thinking?: string;
  signal?: AbortSignal;
}

export type ProcessDirectStreamingSseEvent = { type: string; [key: string]: unknown };

export async function* runProcessDirectStreaming(
  deps: ProcessDirectStreamingDeps,
  input: ProcessDirectStreamingInput,
): AsyncGenerator<ProcessDirectStreamingSseEvent, void, unknown> {
  const sessionKey = input.sessionKey ?? 'agent:main:main';
  const { channel, chatId } = deps.parseSessionKey(sessionKey);
  const context = deps.initDirectStreamingSession(sessionKey, channel, chatId);

  const queue = new AsyncQueue<ProcessDirectStreamingSseEvent>();
  let reasoningLevel: ReasoningLevel = 'stream';

  const pushVisible = (event: ProcessDirectStreamingSseEvent) => {
    const visible = applyReasoningVisibilityToSseEvent(event, reasoningLevel);
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
    deps.registerWebchatSsePublisher(sessionKey, pushVisible);
  }

  const signal = input.signal;
  let userAborted = false;
  let abortHandled = false;
  let inboundVoice = false;
  let ranSlashCommand = false;
  let mergedUserText = input.content;
  let webchatSlashReceipt: string | undefined;

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
          pushVisible({ type: 'token', content: turn.ackMessage });
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
        const defReason = (deps.getConfig()?.agents?.defaults?.reasoningDefault ?? 'stream') as ReasoningLevel;
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
        { skipResetCommands: resetTriggeredAtInit },
      );
      if (slash.matched) {
        ranSlashCommand = true;
        const text = slash.aggregatedText.trim();
        if (text) {
          webchatSlashReceipt = text;
          pushVisible({ type: 'token', content: text });
        } else if (channel === 'webchat') {
          webchatSlashReceipt =
            'Command finished with no assistant text. If you used `/goal`, a follow-up turn may still be scheduled automatically.';
          pushVisible({ type: 'token', content: webchatSlashReceipt });
        }
        return;
      }

      const textForAgent = mergedUserText.trimStart().startsWith('/skill:')
        ? deps.agentManager.expandSkillUserText(mergedUserText)
        : mergedUserText;
      const userMessage = await deps.buildTranscriptUserMessage(textForAgent, prepared, sessionKey);

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

      setPendingTranscriptUserMessage(sessionKey, userMessage as TranscriptUserMessage);

      const result = await runDirectAgentTurn(
        {
          sessionStore: deps.sessionStore,
          agentManager: deps.agentManager,
          modelManager: deps.modelManager,
          config: deps.getConfig(),
        },
        {
          sessionKey,
          userMessage,
          abortSignal: signal,
          onEvent: (embeddedEvent) => {
            const mapped = mapEmbeddedEventToGatewaySse(embeddedEvent);
            if (mapped) {
              if (mapped.type === 'error' && typeof mapped.content === 'string') {
                mapped.content = formatStreamError(mapped.content);
              }
              pushVisible(mapped);
            }
          },
        },
      );

      if (result.lastAssistantText) {
        deps.onTurnComplete?.(sessionKey, result.lastAssistantText);
      }
      if (!result.ok && result.errorMessage && !abortHandled) {
        pushVisible({ type: 'error', content: formatStreamError(result.errorMessage) });
      }
    } catch (err) {
      if (!abortHandled) {
        const em = err instanceof Error ? err.message : String(err);
        pushVisible({ type: 'error', content: formatStreamError(em) });
      }
    } finally {
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
        if (webchatSlashReceipt?.trim()) {
          const assistantMsg = {
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text: webchatSlashReceipt.trim() }],
            timestamp: Date.now(),
          } as AgentMessage;
          await deps.sessionStore.appendTranscriptMessage(sessionKey, assistantMsg);
        }
        deps.reloadWebchatTranscript?.(sessionKey);
      } catch (err) {
        deps.log.warn({ err, sessionKey }, 'Failed to persist webchat slash command receipt');
      }
    }

    if (!userAborted) {
      const ttsAudioEvent = await deps.maybeEmitWebchatTts(sessionKey, inboundVoice);
      if (ttsAudioEvent) {
        yield ttsAudioEvent;
      }
    }

    deps.recordPersistentGoalStreamOutcome?.(sessionKey, { skipPersistentGoalPostTurn: ranSlashCommand });
  } finally {
    if (channel === 'webchat') {
      deps.unregisterWebchatSsePublisher(sessionKey);
    }
    deps.endDirectRequestContext();
  }
}
