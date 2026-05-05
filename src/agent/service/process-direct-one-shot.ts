import type { AgentMessage } from '@mariozechner/pi-agent-core';

import { parseSlashCommand } from '../../chat-commands/command-parse.js';
import { commandRegistry } from '../../chat-commands/index.js';
import type { CommandHandler } from '../messaging/command-handler.js';
import { extractAgentUserPlainText } from '../memory/user-message-text.js';
import { runAgentTurnWithModelFallbacks } from '../orchestration/run-agent-turn-with-fallbacks.js';
import type { ProcessDirectStreamLog } from './process-direct-streaming.js';
import type { AgentManager } from '../agent-manager.js';
import type { ModelManager } from '../models/index.js';
import type { SessionStore } from '../../session/index.js';
import type { Config } from '../../config/schema.js';
import { buildDirectUserMessageContent, type DirectInboundAttachment } from './build-direct-message-content.js';

export type RunProcessDirectDeps = {
  log: ProcessDirectStreamLog;
  config: Config;
  parseSessionKey: (sessionKey: string) => { channel: string; chatId: string };
  initSessionContext: (sessionKey: string, channel: string, chatId: string) => void;
  hydrateSessionWorkspaceFromStore: (sessionKey: string) => Promise<void>;
  hydrateSessionModelFromStore: (sessionKey: string) => Promise<void>;
  agentManager: AgentManager;
  sessionStore: SessionStore;
  prepareLoadedSessionMessages: (sessionKey: string, messages: AgentMessage[]) => AgentMessage[];
  modelManager: ModelManager;
  applyResolvedThinkingLevel: (sessionKey: string, thinking?: string | null) => Promise<void>;
  prepareInboundAttachments: (
    sessionKey: string,
    attachments?: DirectInboundAttachment[],
  ) => Promise<DirectInboundAttachment[] | undefined>;
  commandHandler: Pick<CommandHandler, 'executeCommandAndAggregateReply'>;
  persistAgentSessionMessages: (sessionKey: string) => Promise<void>;
  endDirectRequestContext: () => void;
};

export async function runProcessDirect(
  deps: RunProcessDirectDeps,
  input: {
    content: string;
    sessionKey: string;
    attachments?: DirectInboundAttachment[];
    thinking?: string;
  },
): Promise<string> {
  const { channel, chatId } = deps.parseSessionKey(input.sessionKey);
  deps.initSessionContext(input.sessionKey, channel, chatId);

  try {
    await deps.hydrateSessionWorkspaceFromStore(input.sessionKey);
    const agent = deps.agentManager.getOrCreateAgent(input.sessionKey);

    await deps.hydrateSessionModelFromStore(input.sessionKey);

    const loaded = await deps.sessionStore.load(input.sessionKey);
    agent.state.messages = deps.prepareLoadedSessionMessages(input.sessionKey, loaded);

    await deps.modelManager.applyModelForSession(agent, input.sessionKey);
    await deps.applyResolvedThinkingLevel(input.sessionKey, input.thinking);

    const prepared = await deps.prepareInboundAttachments(input.sessionKey, input.attachments);

    const cmd = parseSlashCommand(input.content);
    if (cmd && commandRegistry.has(cmd.command)) {
      const { aggregatedText } = await deps.commandHandler.executeCommandAndAggregateReply(cmd.command, cmd.args, {
        sessionKey: input.sessionKey,
        channel,
        chatId,
        senderId: '',
        isGroup: false,
      });
      await deps.persistAgentSessionMessages(input.sessionKey);
      return aggregatedText;
    }

    const textForDirect = input.content.trimStart().startsWith('/skill:')
      ? deps.agentManager.expandSkillUserText(input.content)
      : input.content;
    const messageContent = await buildDirectUserMessageContent({
      content: textForDirect,
      attachments: prepared,
      sessionKey: input.sessionKey,
      config: deps.config,
      agentManager: deps.agentManager,
      modelManager: deps.modelManager,
    });

    const userMessage = {
      role: 'user' as const,
      content: messageContent,
      timestamp: Date.now(),
    };
    const userPlain = extractAgentUserPlainText(userMessage);
    const userMessageForModel = await deps.agentManager.applyMemoryPrefetchToUserMessage(
      userMessage,
      input.sessionKey,
    );

    await runAgentTurnWithModelFallbacks({
      agent,
      sessionKey: input.sessionKey,
      modelManager: deps.modelManager,
      userMessage: userMessageForModel,
      log: deps.log,
      getConfig: () => deps.config,
      beforeUserPrompt: () => deps.agentManager.beginBackgroundReviewUserTurn(input.sessionKey),
    });

    deps.agentManager.afterAgentTurn(input.sessionKey, userPlain);
    deps.agentManager.scheduleBackgroundReviewAfterUserTurn(input.sessionKey);

    const response = deps.agentManager.getLastAssistantContent(input.sessionKey) || '';
    await deps.persistAgentSessionMessages(input.sessionKey);

    return response;
  } finally {
    deps.endDirectRequestContext();
  }
}
