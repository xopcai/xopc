import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { CommandHandler } from '../messaging/command-handler.js';
import type { AgentInstanceGateway } from '../agent-instance-gateway.js';
import type { ModelManager } from '../models/index.js';
import type { SessionStore } from '../../session/index.js';
import type { Config } from '../../config/schema.js';
import { appendPiTranscriptMessage } from '../../session/parity/jsonl-transcript-io.js';
import { buildDirectUserMessageContent, type DirectInboundAttachment } from './build-direct-message-content.js';
import type { ProcessDirectStreamLog } from './process-direct-streaming.js';
import {
  hydratePerTurnState,
  runDirectAgentTurn,
  tryRunSlashCommand,
} from './direct-turn-helpers.js';

export type RunProcessDirectDeps = {
  log: ProcessDirectStreamLog;
  config: Config;
  parseSessionKey: (sessionKey: string) => { channel: string; chatId: string };
  initSessionContext: (sessionKey: string, channel: string, chatId: string) => void;
  hydrateSessionWorkspaceFromStore: (sessionKey: string) => Promise<void>;
  hydrateSessionModelFromStore: (sessionKey: string) => Promise<void>;
  agentManager: AgentInstanceGateway;
  sessionStore: SessionStore;
  modelManager: ModelManager;
  applyResolvedThinkingLevel: (sessionKey: string, thinking?: string | null) => Promise<void>;
  prepareInboundAttachments: (
    sessionKey: string,
    attachments?: DirectInboundAttachment[],
  ) => Promise<DirectInboundAttachment[] | undefined>;
  commandHandler: Pick<CommandHandler, 'executeCommandAndAggregateReply'>;
  onTurnComplete?: (sessionKey: string, lastAssistantText?: string) => void;
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
    await hydratePerTurnState(deps, input.sessionKey, input.thinking);
    const prepared = await deps.prepareInboundAttachments(input.sessionKey, input.attachments);

    const slash = await tryRunSlashCommand(
      deps,
      { sessionKey: input.sessionKey, channel, chatId },
      input.content,
    );
    if (slash.matched) {
      const trimmed = slash.aggregatedText.trim();
      if (trimmed) {
        const { absPath } = await deps.sessionStore.resolveTranscriptPath(input.sessionKey);
        const workspaceDir = deps.agentManager.getResolvedWorkspaceForSession(input.sessionKey);
        await appendPiTranscriptMessage({
          absPath,
          cwd: workspaceDir,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: trimmed }],
            timestamp: Date.now(),
          } as AgentMessage,
          sessionKey: input.sessionKey,
        });
      }
      return slash.aggregatedText ?? '';
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

    const result = await runDirectAgentTurn(
      { ...deps, config: deps.config },
      { sessionKey: input.sessionKey, userMessage },
    );

    if (result.lastAssistantText) {
      deps.onTurnComplete?.(input.sessionKey, result.lastAssistantText);
    }

    return result.lastAssistantText ?? '';
  } finally {
    deps.endDirectRequestContext();
  }
}
