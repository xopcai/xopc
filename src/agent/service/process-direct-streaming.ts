import crypto from 'node:crypto';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import type { InternalAttachmentRoots } from '../../channels/attachments/inbound-persist.js';
import { commandRegistry } from '../../chat-commands/index.js';
import { parseSlashCommand } from '../../chat-commands/command-parse.js';
import {
  isVoiceLikeAttachment,
  mergeVoiceTranscriptsIntoUserText,
  mergeSttConfigFromAppConfig,
} from '../../channels/attachments/voice-stt-webchat.js';
import {
  resolveEffectiveReasoningLevel,
  type SessionConfigStore,
  type SessionStore,
} from '../../session/index.js';
import { appendPiTranscriptMessage } from '../../session/parity/jsonl-transcript-io.js';
import type { SessionContext } from '../session/index.js';
import { extractAgentUserPlainText } from '../memory/user-message-text.js';
import { applyReasoningVisibilityToSseEvent } from '../streaming/reasoning-visibility-sse.js';
import type { ReasoningLevel } from '../transcript/thinking-types.js';
import { runEmbeddedTurnForSession } from '../embedded/run-for-session.js';
import { abortEmbeddedRun } from '../embedded/runs.js';
import { mapEmbeddedEventToGatewaySse } from '../embedded/map-stream-events.js';
import type { AgentManager } from '../agent-manager.js';
import type { CommandHandler } from '../messaging/command-handler.js';
import type { ModelManager } from '../models/index.js';

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
  agentManager: AgentManager;
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
  const {
    log,
    parseSessionKey,
    initDirectStreamingSession,
    registerWebchatSsePublisher,
    unregisterWebchatSsePublisher,
    agentManager,
    hydrateSessionWorkspaceFromStore,
    hydrateSessionModelFromStore,
    sessionStore,
    modelManager,
    applyResolvedThinkingLevel,
    getConfig,
    sessionConfigStore,
    attachmentRootsForSession,
    commandHandler,
    prepareInboundAttachments,
    buildMessageContent,
    recordPersistentGoalStreamOutcome,
    onTurnComplete,
    reloadWebchatTranscript,
    maybeEmitWebchatTts,
    endDirectRequestContext,
  } = deps;

  const sessionKey = input.sessionKey ?? 'cli:direct';
  const { channel, chatId } = parseSessionKey(sessionKey);
  const context = initDirectStreamingSession(sessionKey, channel, chatId);
  const runId = crypto.randomUUID();

  const eventQueue: ProcessDirectStreamingSseEvent[] = [];
  let resolveWaiting: (() => void) | null = null;
  let agentDone = false;

  let reasoningLevel: ReasoningLevel = 'stream';

  const enqueueSseEvent = (event: ProcessDirectStreamingSseEvent) => {
    eventQueue.push(event);
    if (resolveWaiting) {
      resolveWaiting();
      resolveWaiting = null;
    }
  };

  const pushEvent = (event: ProcessDirectStreamingSseEvent) => {
    const visible = applyReasoningVisibilityToSseEvent(event, reasoningLevel);
    if (visible !== null) {
      enqueueSseEvent(visible);
    }
  };

  if (channel === 'webchat') {
    registerWebchatSsePublisher(sessionKey, (e) => pushEvent(e));
  }

  const signal = input.signal;
  let userAborted = false;
  let abortHandled = false;

  try {
    await hydrateSessionWorkspaceFromStore(sessionKey);
    await hydrateSessionModelFromStore(sessionKey);
    await applyResolvedThinkingLevel(sessionKey, input.thinking);
    {
      const defReason = (getConfig()?.agents?.defaults?.reasoningDefault ?? 'stream') as ReasoningLevel;
      reasoningLevel = await resolveEffectiveReasoningLevel(sessionConfigStore, sessionKey, defReason);
    }

    const prepared = await prepareInboundAttachments(sessionKey, input.attachments);

    const sttCfg = mergeSttConfigFromAppConfig(getConfig()?.tools?.media?.audio, getConfig()?.tools?.media);
    const { text: mergedUserText, inboundVoice, voiceTranscripts } =
      await mergeVoiceTranscriptsIntoUserText(
        attachmentRootsForSession(sessionKey),
        prepared,
        input.content,
        sttCfg,
      );

    if (inboundVoice) {
      const transcriptParts = [
        voiceTranscripts.filter(Boolean).join('\n'),
        input.content.trim(),
      ].filter(Boolean);
      const voiceAttachments = (prepared ?? []).filter(isVoiceLikeAttachment).map((att) => ({
        workspaceRelativePath: att.workspaceRelativePath,
        mimeType: att.mimeType,
        name: att.name,
      }));
      pushEvent({
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
      agentDone = true;
      pushEvent({ type: '__done__' });
    };
    if (signal) {
      if (signal.aborted) {
        armAbort();
      } else {
        signal.addEventListener('abort', armAbort, { once: true });
      }
    }

    const commandInfo = parseSlashCommand(mergedUserText);
    let ranSlashCommand = false;
    let webchatSlashReceipt: string | undefined;
    if (!abortHandled && commandInfo) {
      if (commandRegistry.has(commandInfo.command)) {
        ranSlashCommand = true;
        try {
          const { aggregatedText } = await commandHandler.executeCommandAndAggregateReply(
            commandInfo.command,
            commandInfo.args,
            {
              sessionKey,
              channel,
              chatId,
              senderId: context.senderId,
              isGroup: context.isGroup,
              inboundMetadata: {},
            },
          );
          if (aggregatedText?.trim()) {
            webchatSlashReceipt = aggregatedText.trim();
            pushEvent({ type: 'token', content: webchatSlashReceipt });
          } else if (channel === 'webchat') {
            webchatSlashReceipt =
              'Command finished with no assistant text. If you used `/goal`, a follow-up turn may still be scheduled automatically.';
            pushEvent({ type: 'token', content: webchatSlashReceipt });
          }
        } catch (cmdErr) {
          const em = cmdErr instanceof Error ? cmdErr.message : String(cmdErr);
          log.warn({ err: cmdErr, sessionKey, command: commandInfo.command }, `Slash command failed: ${em}`);
          webchatSlashReceipt = `Command error: ${em}`;
          pushEvent({ type: 'token', content: webchatSlashReceipt });
        }
        pushEvent({ type: '__done__' });
        agentDone = true;
      }
    }

    if (!abortHandled && !ranSlashCommand) {
      const textForAgent = mergedUserText.trimStart().startsWith('/skill:')
        ? agentManager.expandSkillUserText(mergedUserText)
        : mergedUserText;
      const messageContent = await buildMessageContent(textForAgent, prepared, sessionKey);

      const userMessage = {
        role: 'user' as const,
        content: messageContent,
        timestamp: Date.now(),
      };
      const userPlain = extractAgentUserPlainText(userMessage);
      if (channel === 'webchat') {
        pushEvent({
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
      const userMessageForModel = await agentManager.applyMemoryPrefetchToUserMessage(
        userMessage,
        sessionKey,
      );

      const agentPromise = (async () => {
        const result = await runEmbeddedTurnForSession({
          sessionKey,
          runId,
          userMessage: userMessageForModel,
          sessionStore,
          agentManager,
          modelManager,
          getConfig,
          abortSignal: signal,
          beforeTurn: () => agentManager.beginBackgroundReviewUserTurn(sessionKey),
          onEvent: (embeddedEvent) => {
            const mapped = mapEmbeddedEventToGatewaySse(embeddedEvent);
            if (mapped) {
              pushEvent(mapped);
            }
          },
        });
        agentManager.afterAgentTurn(sessionKey, userPlain);
        agentManager.scheduleBackgroundReviewAfterUserTurn(sessionKey);
        if (result.lastAssistantText) {
          onTurnComplete?.(sessionKey, result.lastAssistantText);
        }
        if (!result.ok && result.errorMessage && !abortHandled) {
          pushEvent({ type: 'error', content: result.errorMessage });
        }
      })();

      agentPromise
        .then(() => {
          if (abortHandled) {
            return;
          }
          agentDone = true;
          pushEvent({ type: '__done__' });
        })
        .catch((err) => {
          if (abortHandled) {
            return;
          }
          agentDone = true;
          pushEvent({ type: 'error', content: err instanceof Error ? err.message : String(err) });
          pushEvent({ type: '__done__' });
        });
    }

    while (true) {
      if (eventQueue.length > 0) {
        const event = eventQueue.shift()!;
        if (event.type === '__done__') break;
        yield event;
      } else if (agentDone) {
        break;
      } else {
        await new Promise<void>((resolve) => {
          resolveWaiting = resolve;
        });
      }
    }

    while (eventQueue.length > 0) {
      const event = eventQueue.shift()!;
      if (event.type === '__done__') continue;
      yield event;
    }

    if (channel === 'webchat' && ranSlashCommand) {
      try {
        const { absPath } = await sessionStore.resolveTranscriptPath(sessionKey);
        const workspaceDir = agentManager.getResolvedWorkspaceForSession(sessionKey);
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
          reloadWebchatTranscript?.(sessionKey);
        } else {
          reloadWebchatTranscript?.(sessionKey);
        }
      } catch (err) {
        log.warn({ err, sessionKey }, 'Failed to persist webchat slash command receipt');
      }
    }

    if (!userAborted) {
      const ttsAudioEvent = await maybeEmitWebchatTts(sessionKey, inboundVoice);
      if (ttsAudioEvent) {
        yield ttsAudioEvent;
      }
    }

    recordPersistentGoalStreamOutcome?.(sessionKey, { skipPersistentGoalPostTurn: ranSlashCommand });
  } finally {
    if (channel === 'webchat') {
      unregisterWebchatSsePublisher(sessionKey);
    }
    endDirectRequestContext();
  }
}
