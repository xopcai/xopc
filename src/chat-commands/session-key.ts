/**
 * Session Key Generator
 * 
 * Uses the new routing system session key format:
 * {agentId}:{source}:{accountId}:{peerKind}:{peerId}[:thread:{threadId}][:scope:{scopeId}]
 * 
 * Examples:
 * - main:telegram:default:dm:123456
 * - main:telegram:default:group:-100123456
 * - main:gateway:default:direct:chat_abc123
 * - main:cli:default:direct:cli
 */

import type { MessageSource } from './types.js';
import { buildSessionKey, parseSessionKey as parseRoutingSessionKey } from '../routing/session-key.js';

export interface SessionKeyContext {
  source: MessageSource;
  channelId?: string;      // e.g., 'telegram:default'
  chatId: string;          // Platform-specific chat ID
  senderId: string;        // Sender's platform ID
  isGroup: boolean;
  threadId?: string;       // For forum/thread support
  /** Agent ID (defaults to 'main') */
  agentId?: string;
  /** Account ID (defaults to 'default') */
  accountId?: string;
}

/**
 * Generate a unified session key using the new routing format
 * 
 * Format: {agentId}:{source}:{accountId}:{peerKind}:{peerId}[:thread:{threadId}]
 * 
 * Examples:
 * - telegram DM: main:telegram:default:dm:123456
 * - telegram Group: main:telegram:default:group:-100123456
 * - gateway: main:gateway:default:direct:chat_abc123
 * - cli: main:cli:default:direct:cli
 */
export function generateSessionKey(ctx: SessionKeyContext): string {
  const { source, chatId, senderId, isGroup, threadId, agentId, accountId } = ctx;
  
  const effectiveAgentId = agentId ?? 'main';
  const effectiveAccountId = accountId ?? 'default';

  // CLI special handling
  if (source === 'cli') {
    return buildSessionKey({
      agentId: effectiveAgentId,
      source: 'cli',
      accountId: effectiveAccountId,
      peerKind: 'direct',
      peerId: chatId === 'direct' ? 'cli' : chatId,
    });
  }
  
  // Web UI / Gateway special handling
  if (source === 'webui' || source === 'gateway') {
    return buildSessionKey({
      agentId: effectiveAgentId,
      source: source === 'webui' ? 'gateway' : source,
      accountId: effectiveAccountId,
      peerKind: 'direct',
      peerId: chatId,
    });
  }
  
  // API special handling
  if (source === 'api') {
    return buildSessionKey({
      agentId: effectiveAgentId,
      source: 'api',
      accountId: effectiveAccountId,
      peerKind: 'direct',
      peerId: chatId,
    });
  }
  
  // System messages
  if (source === 'system') {
    return buildSessionKey({
      agentId: effectiveAgentId,
      source: 'system',
      accountId: effectiveAccountId,
      peerKind: 'direct',
      peerId: chatId,
    });
  }
  
  // Private/DM chat
  if (!isGroup) {
    // Use senderId for private chats (consistent regardless of who initiates)
    return buildSessionKey({
      agentId: effectiveAgentId,
      source,
      accountId: effectiveAccountId,
      peerKind: 'dm',
      peerId: senderId,
      threadId,
    });
  }
  
  // Group chat
  return buildSessionKey({
    agentId: effectiveAgentId,
    source,
    accountId: effectiveAccountId,
    peerKind: 'group',
    peerId: chatId,
    threadId,
  });
}

/**
 * Parse a session key into its components
 * 
 * Returns legacy-compatible format for backward compatibility in UI/components
 */
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
    // Fallback for unparseable keys
    const parts = sessionKey.split(':');
    return {
      source: (parts[0] as MessageSource) || 'system',
      type: 'other',
      chatId: parts[parts.length - 1] || 'unknown',
    };
  }
  
  // Map peerKind to legacy type
  let type: 'dm' | 'group' | 'thread' | 'direct' | 'other';
  switch (parsed.peerKind) {
    case 'dm':
      type = 'dm';
      break;
    case 'group':
      type = parsed.threadId ? 'thread' : 'group';
      break;
    case 'channel':
      type = parsed.threadId ? 'thread' : 'group';
      break;
    case 'direct':
      type = 'direct';
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

/**
 * Check if a session key is valid
 */
export function isValidSessionKey(sessionKey: string): boolean {
  if (!sessionKey || typeof sessionKey !== 'string') return false;
  
  const parsed = parseRoutingSessionKey(sessionKey);
  return parsed !== null;
}

/**
 * Get display name for a session key
 */
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
      return parsed.source === 'cli' ? 'CLI Direct' : `Direct (${parsed.source})`;
    default:
      return `${parsed.source}:${parsed.chatId}`;
  }
}

/**
 * Extract channel info from session key for reply routing
 */
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
