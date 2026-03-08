/**
 * Session Key Generator
 * 
 * Provides a unified strategy for generating session keys across all platforms.
 * This ensures consistency between Telegram, Feishu, Web UI, and CLI.
 */

import type { MessageSource } from './types.js';

export interface SessionKeyContext {
  source: MessageSource;
  channelId?: string;      // e.g., 'telegram:default'
  chatId: string;          // Platform-specific chat ID
  senderId: string;        // Sender's platform ID
  isGroup: boolean;
  threadId?: string;       // For forum/thread support
}

/**
 * Generate a unified session key
 * 
 * Format:
 * - Private: {source}:{dm|p}:{senderId}  
 *   e.g., telegram:dm:123456, feishu:p:ou_abc123
 * - Group: {source}:g:{chatId}[:t:{threadId}]
 *   e.g., telegram:g:-100123456, telegram:g:-100123456:t:789
 * - CLI: cli:direct or cli:{sessionName}
 * - Web UI: webui:{sessionId}
 */
export function generateSessionKey(ctx: SessionKeyContext): string {
  const { source, chatId, senderId, isGroup, threadId } = ctx;
  
  // CLI special handling
  if (source === 'cli') {
    return chatId === 'direct' ? 'cli:direct' : `cli:${chatId}`;
  }
  
  // Web UI special handling
  if (source === 'webui') {
    return `webui:${chatId}`;
  }
  
  // API special handling
  if (source === 'api') {
    return `api:${chatId}`;
  }
  
  // System messages
  if (source === 'system') {
    return `system:${chatId}`;
  }
  
  // Private/DM chat
  if (!isGroup) {
    // Use senderId for private chats (consistent regardless of who initiates)
    return `${source}:dm:${senderId}`;
  }
  
  // Group chat
  if (threadId) {
    // Forum/topic thread
    return `${source}:g:${chatId}:t:${threadId}`;
  }
  
  // Regular group
  return `${source}:g:${chatId}`;
}

/**
 * Parse a session key into its components
 */
export function parseSessionKey(sessionKey: string): {
  source: MessageSource;
  type: 'dm' | 'group' | 'thread' | 'direct' | 'other';
  chatId: string;
  threadId?: string;
} {
  const parts = sessionKey.split(':');
  const source = parts[0] as MessageSource;
  
  // CLI: cli:direct or cli:name
  if (source === 'cli') {
    return {
      source,
      type: parts[1] === 'direct' ? 'direct' : 'other',
      chatId: parts[1] || 'direct',
    };
  }
  
  // Web UI: webui:{id}
  if (source === 'webui') {
    return {
      source,
      type: 'other',
      chatId: parts[1] || 'default',
    };
  }
  
  // API: api:{id}
  if (source === 'api') {
    return {
      source,
      type: 'other',
      chatId: parts[1] || 'default',
    };
  }
  
  // System: system:{id}
  if (source === 'system') {
    return {
      source,
      type: 'other',
      chatId: parts[1] || 'default',
    };
  }
  
  // Private/DM: {source}:dm:{senderId}
  if (parts[1] === 'dm' || parts[1] === 'p') {
    return {
      source,
      type: 'dm',
      chatId: parts[2] || '',
    };
  }
  
  // Group with thread: {source}:g:{chatId}:t:{threadId}
  if (parts[1] === 'g' && parts[3] === 't') {
    return {
      source,
      type: 'thread',
      chatId: parts[2] || '',
      threadId: parts[4],
    };
  }
  
  // Regular group: {source}:g:{chatId}
  if (parts[1] === 'g') {
    return {
      source,
      type: 'group',
      chatId: parts[2] || '',
    };
  }
  
  // Legacy format fallback: {source}:{chatId}
  return {
    source,
    type: 'other',
    chatId: parts[1] || '',
  };
}

/**
 * Check if a session key is valid
 */
export function isValidSessionKey(sessionKey: string): boolean {
  if (!sessionKey || typeof sessionKey !== 'string') return false;
  
  const parts = sessionKey.split(':');
  if (parts.length < 2) return false;
  
  const source = parts[0];
  const validSources = ['telegram', 'feishu', 'discord', 'slack', 'webui', 'cli', 'api', 'system'];
  
  return validSources.includes(source);
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
      return 'CLI Direct';
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
    channel: parsed.source === 'cli' || parsed.source === 'webui' || parsed.source === 'api' 
      ? parsed.source 
      : parsed.source,
    chatId: parsed.chatId,
    threadId: parsed.threadId,
  };
}
