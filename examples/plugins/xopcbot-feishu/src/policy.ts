/**
 * Feishu Policy - Access control and allowlist management
 */

import type { FeishuConfig } from './types.js';

export interface AllowlistMatch {
  allowed: boolean;
  matchedEntry?: string;
}

/**
 * Check if sender is in allowlist
 */
export function checkAllowlist(params: {
  allowFrom: string[];
  senderId: string;
  senderName?: string;
}): AllowlistMatch {
  const { allowFrom, senderId, senderName } = params;

  if (!allowFrom || allowFrom.length === 0) {
    return { allowed: false };
  }

  // Check for wildcard
  if (allowFrom.includes('*')) {
    return { allowed: true, matchedEntry: '*' };
  }

  // Normalize for comparison
  const normalizedSenderId = senderId.toLowerCase().trim();
  const normalizedSenderName = senderName?.toLowerCase().trim();

  for (const entry of allowFrom) {
    const normalizedEntry = String(entry).toLowerCase().trim();

    // Direct match
    if (normalizedEntry === normalizedSenderId) {
      return { allowed: true, matchedEntry: entry };
    }

    // Match by name if provided
    if (normalizedSenderName && normalizedEntry === normalizedSenderName) {
      return { allowed: true, matchedEntry: entry };
    }
  }

  return { allowed: false };
}

/**
 * Check DM policy
 */
export function checkDMPolicy(params: {
  config: FeishuConfig;
  senderOpenId: string;
  senderName?: string;
}): { allowed: boolean; reason?: string } {
  const { config, senderOpenId, senderName } = params;
  const policy = config.dmPolicy || 'pairing';

  switch (policy) {
    case 'open':
      return { allowed: true };

    case 'allowlist':
      const match = checkAllowlist({
        allowFrom: config.allowFrom || [],
        senderId: senderOpenId,
        senderName,
      });
      if (match.allowed) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'Sender not in allowlist' };

    case 'pairing':
      // Pairing mode: requires explicit approval (handled by session management)
      // For now, allow and let the bot's auth system handle it
      return { allowed: true };

    default:
      return { allowed: false, reason: `Unknown policy: ${policy}` };
  }
}

/**
 * Check group policy
 */
export function checkGroupPolicy(params: {
  config: FeishuConfig;
  chatId: string;
  senderOpenId: string;
  senderName?: string;
  mentionedBot: boolean;
}): { allowed: boolean; requireMention: boolean; reason?: string } {
  const { config, chatId, senderOpenId, senderName, mentionedBot } = params;
  const policy = config.groupPolicy || 'allowlist';
  const requireMention = config.requireMention !== false;

  switch (policy) {
    case 'disabled':
      return { allowed: false, requireMention, reason: 'Group chat is disabled' };

    case 'open':
      return { allowed: true, requireMention };

    case 'allowlist':
      // Check if chat is in allowlist
      const chatMatch = checkAllowlist({
        allowFrom: config.groupAllowFrom || [],
        senderId: chatId,
      });
      if (!chatMatch.allowed) {
        return { allowed: false, requireMention, reason: 'Chat not in allowlist' };
      }

      // Also check sender allowlist if configured
      const senderMatch = checkAllowlist({
        allowFrom: config.allowFrom || [],
        senderId: senderOpenId,
        senderName,
      });
      if (config.allowFrom?.length && !senderMatch.allowed) {
        return { allowed: false, requireMention, reason: 'Sender not in allowlist' };
      }

      return { allowed: true, requireMention };

    default:
      return { allowed: false, requireMention, reason: `Unknown policy: ${policy}` };
  }
}

/**
 * Resolve sender display name (best effort)
 */
const senderNameCache = new Map<
  string,
  { name: string; expireAt: number }
>();
const SENDER_NAME_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function resolveSenderName(params: {
  config: FeishuConfig;
  senderOpenId: string;
  log?: (msg: string) => void;
}): Promise<string | undefined> {
  const { config, senderOpenId, log } = params;

  if (!senderOpenId) return undefined;

  // Check cache
  const now = Date.now();
  const cached = senderNameCache.get(senderOpenId);
  if (cached && cached.expireAt > now) {
    return cached.name;
  }

  // We don't have a direct way to get user info without contact permissions
  // This would require contact:user.base:readonly permission
  // For now, just return undefined and let the system use open_id

  return undefined;
}
