/**
 * Chat-command session display helpers.
 *
 * Session routing is resolved from SessionMetadata, not by parsing session keys.
 */

import type { MessageSource } from './types.js';
import {
  buildAgentMainSessionKey,
  buildAgentPeerSessionKey,
} from '../routing/session-key.js';

export interface SessionKeyContext {
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

export function generateSessionKey(ctx: SessionKeyContext): string {
  const effectiveAgentId = ctx.agentId ?? 'main';
  const effectiveAccountId = ctx.accountId ?? 'default';
  const channel = ctx.source === 'webui' ? 'webchat' : ctx.source;

  if (ctx.source === 'cli') {
    if (ctx.chatId === 'direct' || ctx.chatId === 'main') {
      return buildAgentMainSessionKey({ agentId: effectiveAgentId, mainKey: ctx.mainKey });
    }
    return buildAgentPeerSessionKey({
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
    const key = buildAgentPeerSessionKey({
      agentId: effectiveAgentId,
      mainKey: ctx.mainKey,
      channel,
      accountId: effectiveAccountId,
      peerKind: 'direct',
      peerId: ctx.senderId,
      identityLinks: ctx.identityLinks,
      dmScope: ctx.dmScope ?? 'per-account-channel-peer',
    });
    if (ctx.threadId) {
      return `${key}:thread:${ctx.threadId.toLowerCase()}`;
    }
    return key;
  }

  let key = buildAgentPeerSessionKey({
    agentId: effectiveAgentId,
    mainKey: ctx.mainKey,
    channel,
    accountId: effectiveAccountId,
    peerKind: 'group',
    peerId: ctx.chatId,
    identityLinks: ctx.identityLinks,
  });
  if (ctx.threadId) {
    key = `${key}:thread:${ctx.threadId.toLowerCase()}`;
  }
  return key;
}

export function getSessionDisplayName(sessionKey: string): string {
  const trimmed = sessionKey.trim();
  return trimmed || 'Session';
}
