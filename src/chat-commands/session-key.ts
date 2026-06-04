/**
 * Session Key Generator — OpenClaw `agent:{agentId}:{rest}` format.
 */

import type { MessageSource } from './types.js';
import {
  buildAgentMainSessionKey,
  buildAgentPeerSessionKey,
  parseSessionKey as parseRoutingSessionKey,
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

export function parseSessionKey(sessionKey: string): {
  source: MessageSource;
  type: 'dm' | 'group' | 'thread' | 'direct' | 'other';
  chatId: string;
  threadId?: string;
  agentId?: string;
  accountId?: string;
} {
  const parsed = parseRoutingSessionKey(sessionKey);

  if (!parsed) {
    return {
      source: 'system',
      type: 'other',
      chatId: 'unknown',
    };
  }

  let type: 'dm' | 'group' | 'thread' | 'direct' | 'other';
  switch (parsed.peerKind) {
    case 'dm':
    case 'direct':
      type = parsed.peerKind === 'direct' && parsed.peerId === 'main' ? 'direct' : 'dm';
      break;
    case 'group':
    case 'channel':
      type = parsed.threadId ? 'thread' : 'group';
      break;
    default:
      type = 'other';
  }

  return {
    source: parsed.source as MessageSource,
    type,
    chatId: parsed.peerId,
    threadId: parsed.threadId,
    agentId: parsed.agentId,
    accountId: parsed.accountId,
  };
}

export function isValidSessionKey(sessionKey: string): boolean {
  return parseRoutingSessionKey(sessionKey) !== null;
}

export function getSessionDisplayName(sessionKey: string): string {
  const parsed = parseSessionKey(sessionKey);

  switch (parsed.type) {
    case 'dm':
      return `Private Chat (${parsed.source})`;
    case 'group':
      return `Group (${parsed.source})`;
    case 'thread':
      return `Thread (${parsed.source})`;
    case 'direct':
      return parsed.chatId === 'main' ? 'Main session' : `Direct (${parsed.source})`;
    default:
      return `${parsed.source}:${parsed.chatId}`;
  }
}

export function getRoutingInfo(sessionKey: string): {
  channel: string;
  chatId: string;
  threadId?: string;
} {
  const parsed = parseSessionKey(sessionKey);

  return {
    channel: parsed.source,
    chatId: parsed.chatId,
    threadId: parsed.threadId,
  };
}
