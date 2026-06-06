import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import type { InternalAttachmentRoots } from '../../channels/attachments/inbound-persist.js';
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
import { appendPiTranscriptMessage } from '../../session/parity/jsonl-transcript-io.js';
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

export type DirectStreamInboundAttachment = {
  type: string;
  mimeType?: string;
  data?: string;
  name?: string;
  size?: number;
  workspaceRelativePath?: string;
};

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
  attachmentRootsForSession: (sessionKey: string) => InternalAttachmentRoots;
  commandHandler: Pick<CommandHandler, 'executeCommandAndAggregateReply'>;
  prepareInboundAttachments: (
    sessionKey: string,
    attachments?: DirectStreamInboundAttachment[],
  ) => Promise<DirectStreamInboundAttachment[] | undefined>;
  buildMessageContent: (
    content: string,
    attachments: DirectStreamInboundAttachment[] | undefined,
    sessionKey: string,
  ) => Promise<Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>>;
  recordPersistentGoalStreamOutcome?: (
    sessionKey: string,
    outcome: { skipPersistentGoalPostTurn: boolean },
  ) => void;
  onTurnComplete?: (sessionKey: string, lastAssistantText?: string) => void;
  /** Disk-only transcript sync (slash receipt already streamed as tokens). */
  reloadWebchatTranscript?: (sessionKey: string) => void;
  maybeEmitWebchatTts: (
    sessionKey: string,
    hadInboundVoice: boolean,
  ) => Promise<{ type: 'tts_audio'; workspaceRelativePath: string; mimeType: string; name: string } | null>;
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

  // Kick off the agent task in the background; events stream into `queue` as they happen
  // and the generator below drains `queue` until the task closes it.
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
      const voiceMerge = await mergeVoiceTranscriptsIntoUserText(
        deps.attachmentRootsForSession(sessionKey),
        prepared,
        turnBody,
        sttCfg,
      );
      mergedUserText = voiceMerge.text;
      inboundVoice = voiceMerge.inboundVoice;

      if (inboundVoice) {
        const transcriptParts = [
          voiceMerge.voiceTranscripts.filter(Boolean).join('\n'),
          turnBody.trim(),
        ].filter(Boolean);
        const voiceAttachments = (prepared ?? []).filter(isVoiceLikeAttachment).map((att) => ({
          workspaceRelativePath: att.workspaceRelativePath,
          mimeType: att.mimeType,
          name: att.name,
        }));
        pushVisible({
          type: 'user_transcript',
          text: transcriptParts.join('\n\n'),
          attachments: voiceAttachments,
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
        { sessionKey, channel, chatId, senderId: context.senderId, isGroup: context.isGroup },
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
      const messageContent = await deps.buildMessageContent(textForAgent, prepared, sessionKey);

      const userMessage = {
        role: 'user' as const,
        content: messageContent,
        timestamp: Date.now(),
      };
      if (channel === 'webchat') {
        pushVisible({
          type: 'user_message',
          timestamp: userMessage.timestamp,
          content: userMessage.content,
          attachments: prepared?.map((att) => ({
            type: att.type,
            mimeType: att.mimeType,
            name: att.name,
            size: att.size,
            workspaceRelativePath: att.workspaceRelativePath,
          })),
        });
      }

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
    await taskPromise; // surface unexpected throws

    if (channel === 'webchat' && ranSlashCommand) {
      try {
        const { absPath } = await deps.sessionStore.resolveTranscriptPath(sessionKey);
        const workspaceDir = deps.agentManager.getResolvedWorkspaceForSession(sessionKey);
        const userMsg = {
          role: 'user' as const,
          content: [{ type: 'text' as const, text: mergedUserText }],
          timestamp: Date.now(),
        } as AgentMessage;
        await appendPiTranscriptMessage({
          absPath,
          cwd: workspaceDir,
          message: userMsg,
          sessionKey,
        });
        if (webchatSlashReceipt?.trim()) {
          const assistantMsg = {
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text: webchatSlashReceipt.trim() }],
            timestamp: Date.now(),
          } as AgentMessage;
          await appendPiTranscriptMessage({
            absPath,
            cwd: workspaceDir,
            message: assistantMsg,
            sessionKey,
          });
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
