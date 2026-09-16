/**
 * Chat-command session display helpers.
 *
 * Session routing is resolved from SessionMetadata, not by parsing session keys.
 */

import type { MessageSource } from './types.js';
import {
  resolveAgentMainConversationId,
  resolveAgentPeerConversationId,
} from '../routing/session-key.js';

export interface ConversationIdContext {
  source: MessageSource;
  channelId?: string;
  chatId: string;
  senderId: string;
  isGroup: boolean;
  threadId?: string;
  agentId?: string;
  accountId?: string;
  mainKey?: string;
  dmScope?: 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';
  identityLinks?: Record<string, string[]>;
}

export function generateConversationId(ctx: ConversationIdContext): string {
  const effectiveAgentId = ctx.agentId ?? 'main';
  const effectiveAccountId = ctx.accountId ?? 'default';
  const channel = ctx.source === 'webui' ? 'webchat' : ctx.source;

  if (ctx.source === 'cli') {
    if (ctx.chatId === 'direct' || ctx.chatId === 'main') {
      return resolveAgentMainConversationId({ agentId: effectiveAgentId, mainKey: ctx.mainKey });
    }
    return resolveAgentPeerConversationId({
      agentId: effectiveAgentId,
      mainKey: ctx.mainKey,
      channel: 'cli',
      accountId: effectiveAccountId,
      peerKind: 'direct',
      peerId: ctx.chatId,
      dmScope: 'per-peer',
    });
  }

  if (!ctx.isGroup) {
    const key = resolveAgentPeerConversationId({
      agentId: effectiveAgentId,
      mainKey: ctx.mainKey,
      channel,
      accountId: effectiveAccountId,
      peerKind: 'direct',
      peerId: ctx.senderId,
      identityLinks: ctx.identityLinks,
      threadId: ctx.threadId,
      dmScope: ctx.dmScope ?? 'per-account-channel-peer',
    });
    return key;
  }

  let key = resolveAgentPeerConversationId({
    agentId: effectiveAgentId,
    mainKey: ctx.mainKey,
    channel,
    accountId: effectiveAccountId,
    peerKind: 'group',
    threadId: ctx.threadId,
    peerId: ctx.chatId,
    identityLinks: ctx.identityLinks,
  });
  return key;
}

export function getSessionDisplayName(conversationId: string): string {
  const trimmed = conversationId.trim();
  return trimmed || 'Session';
}
