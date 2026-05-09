import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import type { InternalAttachmentRoots } from '../../channels/attachments/inbound-persist.js';
import { commandRegistry } from '../../chat-commands/index.js';
import { parseSlashCommand } from '../../chat-commands/command-parse.js';
import {
  mergeVoiceTranscriptsIntoUserText,
  mergeSttConfigFromAppConfig,
} from '../../channels/attachments/voice-stt-webchat.js';
import {
  resolveEffectiveReasoningLevel,
  stripTrailingWebchatEarlySaveUserIfPresent,
  type SessionConfigStore,
  type SessionStore,
} from '../../session/index.js';
import type { SessionContext } from '../session/index.js';
import {
  extractTextContent,
  extractThinkingContent,
  extractThinkingFromAssistantMessage,
} from '../context/workspace.js';
import { extractAgentUserPlainText } from '../memory/user-message-text.js';
import { runAgentTurnWithModelFallbacks } from '../orchestration/run-agent-turn-with-fallbacks.js';
import { applyReasoningVisibilityToSseEvent } from '../streaming/reasoning-visibility-sse.js';
import type { ReasoningLevel } from '../transcript/thinking-types.js';
import { serializeAgentToolResultForSse } from '../service-inbound-utils.js';
import type { AgentManager } from '../agent-manager.js';
import type { AgentEventHandler } from '../orchestration/agent-event-handler.js';
import type { AgentOrchestrator } from '../orchestration/agent-orchestrator.js';
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

/** Logger shape expected by {@link runAgentTurnWithModelFallbacks}. */
export type ProcessDirectStreamLog = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  debug?: (obj: Record<string, unknown>, msg: string) => void;
};

/**
 * Explicit collaborators for {@link runProcessDirectStreaming} (gateway webchat / CLI direct stream).
 * Bound by `AgentService` from its private fields and methods.
 */
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
  agentEventHandler: AgentEventHandler;
  sessionStore: SessionStore;
  prepareLoadedSessionMessages: (sessionKey: string, messages: AgentMessage[]) => AgentMessage[];
  modelManager: ModelManager;
  applyResolvedThinkingLevel: (sessionKey: string, thinking?: string | null) => Promise<void>;
  getConfig: () => Config | undefined;
  sessionConfigStore: SessionConfigStore;
  attachmentRootsForSession: (sessionKey: string) => InternalAttachmentRoots;
  agentOrchestrator: Pick<AgentOrchestrator, 'abort'>;
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
  persistAgentSessionMessages: (sessionKey: string) => Promise<void>;
  /** Direct stream path — gates built-in persistent `/goal` post-turn when a slash command handled the turn. */
  recordPersistentGoalStreamOutcome?: (
    sessionKey: string,
    outcome: { skipPersistentGoalPostTurn: boolean },
  ) => void;
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
    agentEventHandler,
    sessionStore,
    prepareLoadedSessionMessages,
    modelManager,
    applyResolvedThinkingLevel,
    getConfig,
    sessionConfigStore,
    attachmentRootsForSession,
    agentOrchestrator,
    commandHandler,
    prepareInboundAttachments,
    buildMessageContent,
    persistAgentSessionMessages,
    recordPersistentGoalStreamOutcome,
    maybeEmitWebchatTts,
    endDirectRequestContext,
  } = deps;

  const sessionKey = input.sessionKey ?? 'cli:direct';
  const { channel, chatId } = parseSessionKey(sessionKey);
  const context = initDirectStreamingSession(sessionKey, channel, chatId);

  const eventQueue: ProcessDirectStreamingSseEvent[] = [];
  let resolveWaiting: (() => void) | null = null;
  let agentDone = false;

  let lastSentContent = '';
  let lastSentThinking = '';
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

  await hydrateSessionWorkspaceFromStore(sessionKey);
  const agent = agentManager.getOrCreateAgent(sessionKey);
  await hydrateSessionModelFromStore(sessionKey);
  const unsubscribeStreaming = agent.subscribe((event: AgentEvent) => {
    agentEventHandler.handle(event, context);

    switch (event.type) {
      case 'tool_execution_start': {
        const toolEvent = event as Extract<AgentEvent, { type: 'tool_execution_start' }>;
        const toolName =
          typeof toolEvent.toolName === 'string' && toolEvent.toolName.trim()
            ? toolEvent.toolName.trim()
            : 'unknown';
        pushEvent({
          type: 'tool_start',
          toolCallId: toolEvent.toolCallId,
          toolName,
          args: toolEvent.args,
        });
        break;
      }
      case 'tool_execution_end': {
        const toolEvent = event as Extract<AgentEvent, { type: 'tool_execution_end' }>;
        const toolName =
          typeof toolEvent.toolName === 'string' && toolEvent.toolName.trim()
            ? toolEvent.toolName.trim()
            : 'unknown';
        pushEvent({
          type: 'tool_end',
          toolCallId: toolEvent.toolCallId,
          toolName,
          isError: toolEvent.isError,
          result: serializeAgentToolResultForSse(toolEvent.result),
        });
        break;
      }
      case 'message_update': {
        const msgEvent = event as Extract<AgentEvent, { type: 'message_update' }>;
        if (msgEvent.message?.role === 'assistant') {
          const msgContent = msgEvent.message.content;
          const blocks = Array.isArray(msgContent)
            ? (msgContent as Array<{ type: string; text?: string }>)
            : undefined;
          const fullText = blocks ? extractTextContent(blocks) : String(msgContent);
          const thinkingFromBlocks = blocks ? extractThinkingContent(blocks) : '';
          const thinkingFromReasoning = extractThinkingFromAssistantMessage(msgEvent.message);
          const thinkingText =
            thinkingFromReasoning.length >= thinkingFromBlocks.length
              ? thinkingFromReasoning
              : thinkingFromBlocks;

          if (fullText.length > lastSentContent.length) {
            const delta = fullText.slice(lastSentContent.length);
            if (delta) {
              pushEvent({ type: 'token', content: delta });
              lastSentContent = fullText;
            }
          } else if (fullText.length < lastSentContent.length) {
            pushEvent({ type: 'token', content: fullText });
            lastSentContent = fullText;
          }

          if (thinkingText.length > lastSentThinking.length) {
            const thDelta = thinkingText.slice(lastSentThinking.length);
            if (thDelta) {
              pushEvent({ type: 'thinking', content: thDelta, delta: true });
              lastSentThinking = thinkingText;
            }
          } else if (thinkingText.length < lastSentThinking.length) {
            pushEvent({ type: 'thinking', content: thinkingText, delta: false });
            lastSentThinking = thinkingText;
          }
        }
        break;
      }
      case 'message_start': {
        const msgEvent = event as Extract<AgentEvent, { type: 'message_start' }>;
        if (msgEvent.message?.role === 'assistant') {
          lastSentContent = '';
          lastSentThinking = '';
          pushEvent({ type: 'thinking', status: 'started' });
        }
        break;
      }
      case 'message_end': {
        pushEvent({ type: 'message_end' });
        break;
      }
      case 'agent_start': {
        pushEvent({ type: 'progress', stage: 'thinking', message: 'Thinking...' });
        break;
      }
      case 'agent_end': {
        pushEvent({ type: 'progress', stage: 'idle', message: 'Done' });
        break;
      }
      default:
        break;
    }
  });

  try {
    const prepared = await prepareInboundAttachments(sessionKey, input.attachments);
    let loaded = await sessionStore.load(sessionKey);
    const lastMsg = loaded[loaded.length - 1] as { role?: string; webchatEarlySave?: boolean } | undefined;
    if (lastMsg?.role === 'user' && lastMsg.webchatEarlySave === true) {
      loaded = loaded.slice(0, -1);
    }
    agent.state.messages = prepareLoadedSessionMessages(sessionKey, loaded);

    await modelManager.applyModelForSession(agent, sessionKey);
    await applyResolvedThinkingLevel(sessionKey, input.thinking);
    {
      const defReason = (getConfig()?.agents?.defaults?.reasoningDefault ?? 'stream') as ReasoningLevel;
      reasoningLevel = await resolveEffectiveReasoningLevel(sessionConfigStore, sessionKey, defReason);
    }

    const sttCfg = mergeSttConfigFromAppConfig(getConfig()?.tools?.media?.audio);
    const { text: mergedUserText, inboundVoice } = await mergeVoiceTranscriptsIntoUserText(
      attachmentRootsForSession(sessionKey),
      prepared,
      input.content,
      sttCfg,
    );

    const armAbort = () => {
      if (abortHandled) {
        return;
      }
      abortHandled = true;
      userAborted = true;
      agentOrchestrator.abort(sessionKey);
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
    /** Plain text to persist for webchat slash turns (SSE can be dropped by the UI; disk is source of truth). */
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

    let messageContent:
      | Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
      | undefined;
    if (!abortHandled && !ranSlashCommand) {
      const textForAgent = mergedUserText.trimStart().startsWith('/skill:')
        ? agentManager.expandSkillUserText(mergedUserText)
        : mergedUserText;
      messageContent = await buildMessageContent(textForAgent, prepared, sessionKey);
    }

    if (!abortHandled && !ranSlashCommand && messageContent !== undefined) {
      const agentPromise = (async () => {
        const userMessage = {
          role: 'user' as const,
          content: messageContent,
          timestamp: Date.now(),
        };
        const userPlain = extractAgentUserPlainText(userMessage);
        const userMessageForModel = await agentManager.applyMemoryPrefetchToUserMessage(
          userMessage,
          sessionKey,
        );
        await runAgentTurnWithModelFallbacks({
          agent,
          sessionKey,
          modelManager,
          userMessage: userMessageForModel,
          log,
          getConfig,
          beforeUserPrompt: () => agentManager.beginBackgroundReviewUserTurn(sessionKey),
        });
        agentManager.afterAgentTurn(sessionKey, userPlain);
        agentManager.scheduleBackgroundReviewAfterUserTurn(sessionKey);
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

    // Persist slash command text to the session file so the gateway console can show a receipt even when
    // the browser drops SSE tokens (e.g. session key mismatch during hydration).
    if (channel === 'webchat' && ranSlashCommand && webchatSlashReceipt?.trim()) {
      try {
        const loaded = await sessionStore.load(sessionKey);
        const text = webchatSlashReceipt.trim();
        // Minimal assistant row for session JSON; full AssistantMessage metadata is LLM-turn specific.
        const assistantMsg = {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text }],
          timestamp: Date.now(),
        } as AgentMessage;
        await sessionStore.save(sessionKey, [...loaded, assistantMsg]);
      } catch (err) {
        log.warn({ err, sessionKey }, 'Failed to persist webchat slash command receipt');
      }
    }

    // Slash-only turns never hydrate the early-saved user row into pi-agent state; persisting here would
    // write an empty/stale transcript over the gateway `SessionManager` copy (and break e.g. `/goal`).
    if (!ranSlashCommand) {
      if (userAborted && channel === 'webchat') {
        try {
          await stripTrailingWebchatEarlySaveUserIfPresent(sessionStore, sessionKey);
        } catch (stripErr) {
          log.warn({ err: stripErr, sessionKey }, 'Failed to strip trailing webchat early-save after abort');
        }
      }
      await persistAgentSessionMessages(sessionKey);
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
    unsubscribeStreaming();
    endDirectRequestContext();
  }
}
