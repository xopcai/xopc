import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { CommandHandler } from '../messaging/command-handler.js';
import type { AgentInstanceGateway } from '../agent-instance-gateway.js';
import type { ModelManager } from '../models/index.js';
import type { SessionStore } from '../../session/index.js';
import type { Config } from '../../config/schema.js';
import { initSessionTurn } from '../../session/index.js';
import {
  buildDirectUserMessageContent,
} from './build-direct-message-content.js';
import type { ProcessDirectStreamLog } from './process-direct-streaming.js';
import type {
  InboundAttachmentInput,
  MediaRef,
} from '../../channels/attachments/inbound-persist.js';
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

export type RunProcessDirectDeps = {
  log: ProcessDirectStreamLog;
  config: Config;
  resolveSessionEndpoint: (sessionKey: string) => Promise<{ channel: string; chatId: string }>;
  initSessionContext: (sessionKey: string, channel: string, chatId: string) => void;
  hydrateSessionWorkspaceFromStore: (sessionKey: string) => Promise<void>;
  hydrateSessionModelFromStore: (sessionKey: string) => Promise<void>;
  agentManager: AgentInstanceGateway;
  sessionStore: SessionStore;
  modelManager: ModelManager;
  applyResolvedThinkingLevel: (sessionKey: string, thinking?: string | null) => Promise<void>;
  prepareInboundAttachments: (
    sessionKey: string,
    attachments?: InboundAttachmentInput[],
  ) => Promise<MediaRef[] | undefined>;
  commandHandler: Pick<CommandHandler, 'executeCommandAndAggregateReply'>;
  onTurnComplete?: (sessionKey: string, lastAssistantText?: string) => void;
  endDirectRequestContext: () => void;
  resetSession: (sessionKey: string) => Promise<{ sessionId: string; previousSessionId: string } | null>;
};

export async function runProcessDirect(
  deps: RunProcessDirectDeps,
  input: {
    content: string;
    sessionKey: string;
    attachments?: InboundAttachmentInput[];
    thinking?: string;
  },
): Promise<string> {
  const { channel, chatId } = await deps.resolveSessionEndpoint(input.sessionKey);
  deps.initSessionContext(input.sessionKey, channel, chatId);

  try {
    let turnBody = input.content;
    let resetTriggeredAtInit = false;
    const turn = await initSessionTurn({
      cfg: deps.config,
      sessionKey: input.sessionKey,
      body: input.content,
      resetSession: deps.resetSession,
    });
    resetTriggeredAtInit = turn.resetTriggered;
    if (turn.bareReset && turn.ackMessage) {
      return turn.ackMessage;
    }
    turnBody = turn.bodyStripped;

    await hydratePerTurnState(deps, input.sessionKey, input.thinking);
    const prepared = await deps.prepareInboundAttachments(input.sessionKey, input.attachments);

    const slash = await tryRunSlashCommand(
      deps,
      { sessionKey: input.sessionKey, channel, chatId },
      turnBody,
      { skipResetCommands: resetTriggeredAtInit },
    );
    if (slash.matched) {
      const trimmed = slash.aggregatedText.trim();
      if (trimmed) {
        await deps.sessionStore.appendTranscriptMessage(input.sessionKey, {
          role: 'assistant',
          content: [{ type: 'text', text: trimmed }],
          timestamp: Date.now(),
        } as AgentMessage);
      }
      return slash.aggregatedText ?? '';
    }

    const textForDirect = turnBody.trimStart().startsWith('/skill:')
      ? deps.agentManager.expandSkillUserText(turnBody)
      : turnBody;
    const userMessage = await buildDirectUserMessageContent({
      content: textForDirect,
      attachments: prepared,
      sessionKey: input.sessionKey,
      config: deps.config,
      agentManager: deps.agentManager,
      modelManager: deps.modelManager,
    });

    const pendingUserMessage = userMessage as TranscriptUserMessage;
    setPendingTranscriptUserMessage(input.sessionKey, pendingUserMessage);

    const result = await (async () => {
      try {
        return await runDirectAgentTurn(
          { ...deps, config: deps.config },
          {
            sessionKey: input.sessionKey,
            userMessage,
          },
        );
      } finally {
        clearPendingTranscriptUserMessage(input.sessionKey, pendingUserMessage);
      }
    })();

    if (result.lastAssistantText) {
      deps.onTurnComplete?.(input.sessionKey, result.lastAssistantText);
    }

    return result.lastAssistantText ?? '';
  } finally {
    deps.endDirectRequestContext();
  }
}
