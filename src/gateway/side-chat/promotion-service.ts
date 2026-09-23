import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { AgentService } from '../../agent/service.js';
import { isRuntimeOnlyTranscriptMessage, type XopcTranscriptSideChatOriginEntry } from '../../session/session-context-for-llm.js';
import type { SessionIndex } from '../../session/manager.js';
import type { SessionMetadata } from '../../session/types.js';
import { createLogger } from '../../utils/logger.js';
import { EphemeralSideChatManager, SideChatError } from './manager.js';

const log = createLogger('Gateway:SideChatPromotion');

export interface SideChatPromotionResult {
  conversationId: string;
  created: boolean;
  session: SessionMetadata;
}

export interface SideChatPromotionServiceOptions {
  manager: EphemeralSideChatManager;
  sessionIndex: SessionIndex;
  getAgentService: () => AgentService;
}

export class SideChatPromotionService {
  constructor(private readonly options: SideChatPromotionServiceOptions) {}

  async promote(sideChatId: string, clientInstanceId: string): Promise<SideChatPromotionResult> {
    const existing = await this.options.sessionIndex.getSessionMetadata(sideChatId);
    if (existing) {
      if (existing.customData?.promotedFromSideChatId !== sideChatId) {
        throw new SideChatError('A session already uses this side chat id', 'CONFLICT');
      }
      return { conversationId: sideChatId, created: false, session: existing };
    }

    const snapshot = this.options.manager.beginPromotion(sideChatId, clientInstanceId);
    const parent = snapshot.parentMetadata;
    const agentId = parent.routing?.agentId?.trim() || parent.agentId;
    const chatId = `chat_${sideChatId}`;
    const origin: XopcTranscriptSideChatOriginEntry = {
      type: 'side_chat_origin',
      version: 1,
      parentConversationId: snapshot.context.parentConversationId,
      parentTranscriptId: snapshot.context.parentTranscriptId,
      createdAt: snapshot.context.createdAt,
      contentHash: snapshot.context.contentHash,
      contextMessages: snapshot.contextMessages,
    };
    const rows = [
      origin,
      ...snapshot.conversationRows.filter((row) => !isRuntimeOnlyTranscriptMessage(row)),
    ];

    try {
      await this.options.sessionIndex.createSessionFromRows({
        targetKey: sideChatId,
        cwd: parent.cwd || '',
        metadata: {
          agentId,
          sourceChannel: 'webchat',
          sourceChatId: `default:direct:${chatId}`,
          sessionType: 'chat',
          tags: [...new Set([...(parent.tags ?? []), 'side-chat'])],
          projectId: parent.projectId,
          parentConversationId: snapshot.context.parentConversationId,
          hiddenFromSessionList: false,
          routing: {
            agentId,
            source: 'webchat',
            accountId: 'default',
            peerKind: 'direct',
            peerId: chatId,
          },
          customData: {
            genericNewChatShell: false,
            promotedFromSideChatId: sideChatId,
            promotedFromParentTranscriptId: snapshot.context.parentTranscriptId,
            sideChatContextHash: snapshot.context.contentHash,
            promotedAt: new Date().toISOString(),
          },
        },
        rows,
        config: {
          ...(snapshot.parentConfig ?? {}),
          modelOverride: snapshot.config.modelRef,
          thinkingLevel: snapshot.config.thinkingLevel,
        },
      });
    } catch (error) {
      this.options.manager.cancelPromotion(sideChatId, clientInstanceId);
      throw error;
    }

    const firstUserText = snapshot.conversationRows
      .find((row): row is AgentMessage => isAgentMessageWithRole(row, 'user'));
    if (firstUserText) {
      try {
        this.options.getAgentService().enqueueProvisionalSessionTitle(sideChatId, messageText(firstUserText));
      } catch (err) {
        log.warn({ err, sideChatId, phase: 'side_chat_promote_title' }, 'Saved side chat but title generation could not start');
      }
    }
    await this.options.manager.disposePromoted(sideChatId, clientInstanceId).catch((err) => {
      log.warn({ err, sideChatId, phase: 'side_chat_promote_cleanup' }, 'Saved side chat but cleanup failed');
    });

    const session = await this.options.sessionIndex.getSessionMetadata(sideChatId);
    if (!session) throw new Error(`Promoted session not found: ${sideChatId}`);
    return { conversationId: sideChatId, created: true, session };
  }
}

function isAgentMessageWithRole(row: unknown, role: string): row is AgentMessage {
  return Boolean(row && typeof row === 'object' && (row as { role?: unknown }).role === role);
}

function messageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((part): part is { type: 'text'; text: string } => (
      Boolean(part && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
        && typeof (part as { text?: unknown }).text === 'string')
    ))
    .map((part) => part.text)
    .join('\n')
    .trim();
}
