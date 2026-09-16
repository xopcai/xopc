import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';

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
import type { ReviewOutput } from '../../review/review-types.js';

export type RunProcessDirectDeps = {
  log: ProcessDirectStreamLog;
  config: Config;
  resolveSessionEndpoint: (conversationId: string) => Promise<{ channel: string; chatId: string }>;
  initSessionContext: (
    conversationId: string,
    channel: string,
    chatId: string,
    origin: TurnOrigin,
  ) => void;
  hydrateSessionWorkspaceFromStore: (conversationId: string) => Promise<void>;
  hydrateSessionModelFromStore: (conversationId: string) => Promise<void>;
  agentManager: AgentInstanceGateway;
  sessionStore: SessionStore;
  modelManager: ModelManager;
  applyResolvedThinkingLevel: (conversationId: string, thinking?: string | null) => Promise<void>;
  prepareInboundAttachments: (
    conversationId: string,
    attachments?: InboundAttachmentInput[],
  ) => Promise<MediaRef[] | undefined>;
  commandHandler: Pick<CommandHandler, 'executeCommandAndAggregateReply'>;
  onTurnComplete?: (conversationId: string, lastAssistantText?: string) => void;
  endDirectRequestContext: () => void;
  resetSession: (conversationId: string) => Promise<{ transcriptId: string; previousTranscriptId: string } | null>;
};

function isReviewOutput(value: unknown): value is ReviewOutput {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (value as { type?: unknown }).type === 'review';
}

export async function runProcessDirect(
  deps: RunProcessDirectDeps,
  input: {
    content: string;
    conversationId: string;
    origin: TurnOrigin;
    attachments?: InboundAttachmentInput[];
    thinking?: string;
    signal?: AbortSignal;
    runId?: string;
    deadlineAtMs?: number;
  },
): Promise<string> {
  const { channel, chatId } = await deps.resolveSessionEndpoint(input.conversationId);
  deps.initSessionContext(input.conversationId, channel, chatId, input.origin);

  try {
    let turnBody = input.content;
    let resetTriggeredAtInit = false;
    const turn = await initSessionTurn({
      cfg: deps.config,
      conversationId: input.conversationId,
      body: input.content,
      resetSession: deps.resetSession,
    });
    resetTriggeredAtInit = turn.resetTriggered;
    if (turn.bareReset && turn.ackMessage) {
      return turn.ackMessage;
    }
    turnBody = turn.bodyStripped;

    await hydratePerTurnState(deps, input.conversationId, input.thinking);
    const prepared = await deps.prepareInboundAttachments(input.conversationId, input.attachments);

    const slash = await tryRunSlashCommand(
      deps,
      { conversationId: input.conversationId, channel, chatId },
      turnBody,
      { skipResetCommands: resetTriggeredAtInit },
    );
    if (slash.matched) {
      const trimmed = slash.aggregatedText.trim();
      if (trimmed) {
        await deps.sessionStore.appendTranscriptMessage(input.conversationId, {
          role: 'assistant',
          content: isReviewOutput(slash.metadata?.review)
            ? [slash.metadata.review]
            : [{ type: 'text', text: trimmed }],
          timestamp: Date.now(),
          ...(slash.metadata && Object.keys(slash.metadata).length > 0
            ? { metadata: slash.metadata }
            : {}),
        } as AgentMessage);
        if (input.origin.type === 'system' && input.origin.source === 'automation') {
          await deps.sessionStore.updateMetadata(input.conversationId, { hiddenFromSessionList: false });
        }
        deps.onTurnComplete?.(input.conversationId, trimmed);
      }
      return slash.aggregatedText ?? '';
    }

    const skillTurn = deps.agentManager.prepareSkillTurn(input.conversationId, turnBody);
    const textForDirect = skillTurn.text;
    const userMessage = await buildDirectUserMessageContent({
      content: textForDirect,
      attachments: prepared,
      conversationId: input.conversationId,
      config: deps.config,
      agentManager: deps.agentManager,
      modelManager: deps.modelManager,
    });

    const pendingUserMessage = userMessage as TranscriptUserMessage;
    setPendingTranscriptUserMessage(input.conversationId, pendingUserMessage);

    const result = await (async () => {
      try {
        return await deps.agentManager.withSkillCapabilities(
          input.conversationId,
          skillTurn.activatedCapabilityNames,
          () =>
            runDirectAgentTurn(
              { ...deps, config: deps.config },
              {
                conversationId: input.conversationId,
                runId: input.runId,
                userMessage,
                abortSignal: input.signal,
                deadlineAtMs: input.deadlineAtMs,
              },
            ),
        );
      } finally {
        clearPendingTranscriptUserMessage(input.conversationId, pendingUserMessage);
      }
    })();

    deps.onTurnComplete?.(input.conversationId, result.lastAssistantText);
    if (!result.ok) {
      throw new Error(result.errorMessage ?? 'Agent turn failed');
    }

    return result.lastAssistantText ?? '';
  } finally {
    deps.endDirectRequestContext();
  }
}
