/**
 * Channel Access Control Utilities
 * 
 * Implements hierarchical access control for groups and topics
 * Inspired by openclaw's group-access.ts and bot-access.ts
 */

import type {
  NormalizedAllowFrom,
  AllowFromMatch,
  GroupAccessResult,
  TelegramGroupConfig,
  TelegramTopicConfig,
  GroupPolicy,
} from './types.js';

// ============================================
// AllowFrom Normalization
// ============================================

/**
 * Normalize allowFrom list to structured format
 */
export function normalizeAllowFrom(list?: Array<string | number>): NormalizedAllowFrom {
  const entries = (list ?? []).map((value) => String(value).trim()).filter(Boolean);
  const hasWildcard = entries.includes('*');
  const normalized = entries
    .filter((value) => value !== '*')
    .map((value) => value.replace(/^(telegram|tg):/i, ''));
  const ids = normalized.filter((value) => /^\d+$/.test(value));
  
  return {
    entries: ids,
    hasWildcard,
    hasEntries: ids.length > 0,
  };
}

/**
 * Normalize allowFrom combining config and store
 */
export function normalizeAllowFromWithStore(params: {
  allowFrom?: Array<string | number>;
  storeAllowFrom?: string[];
}): NormalizedAllowFrom {
  const combined = [
    ...(params.allowFrom ?? []),
    ...(params.storeAllowFrom ?? []),
  ]
    .map((value) => String(value).trim())
    .filter(Boolean);
  return normalizeAllowFrom(combined);
}

/**
 * Check if sender is allowed based on normalized allowFrom
 */
export function isSenderAllowed(params: {
  allow: NormalizedAllowFrom;
  senderId?: string;
  senderUsername?: string;
}): boolean {
  const { allow, senderId } = params;
  
  // No entries = allow all
  if (!allow.hasEntries) {
    return true;
  }
  
  // Wildcard = allow all
  if (allow.hasWildcard) {
    return true;
  }
  
  // Check if sender ID is in allowlist
  if (senderId && allow.entries.includes(senderId)) {
    return true;
  }
  
  return false;
}

/**
 * Resolve sender allowlist match
 */
export function resolveSenderAllowMatch(params: {
  allow: NormalizedAllowFrom;
  senderId?: string;
  senderUsername?: string;
}): AllowFromMatch {
  const { allow, senderId } = params;
  
  if (allow.hasWildcard) {
    return { allowed: true, matchKey: '*', matchSource: 'wildcard' };
  }
  
  if (!allow.hasEntries) {
    return { allowed: false };
  }
  
  if (senderId && allow.entries.includes(senderId)) {
    return { allowed: true, matchKey: senderId, matchSource: 'id' };
  }
  
  return { allowed: false };
}

// ============================================
// Group Access Control
// ============================================

/**
 * Evaluate base group access (group/topic enabled, allowFrom override)
 */
export function evaluateGroupBaseAccess(params: {
  isGroup: boolean;
  groupConfig?: TelegramGroupConfig;
  topicConfig?: TelegramTopicConfig;
  hasGroupAllowOverride: boolean;
  effectiveGroupAllow: NormalizedAllowFrom;
  senderId?: string;
  senderUsername?: string;
}): GroupAccessResult {
  // Not a group = always allowed
  if (!params.isGroup) {
    return { allowed: true };
  }
  
  // Check if group is disabled
  if (params.groupConfig?.enabled === false) {
    return { allowed: false, reason: 'group-disabled' };
  }
  
  // Check if topic is disabled
  if (params.topicConfig?.enabled === false) {
    return { allowed: false, reason: 'topic-disabled' };
  }
  
  // Check allowFrom override if present
  if (params.hasGroupAllowOverride) {
    const senderId = params.senderId ?? '';
    if (!senderId) {
      return { allowed: false, reason: 'unauthorized' };
    }
    
    const allowed = isSenderAllowed({
      allow: params.effectiveGroupAllow,
      senderId,
      senderUsername: params.senderUsername,
    });
    
    if (!allowed) {
      return { allowed: false, reason: 'unauthorized' };
    }
  }
  
  return { allowed: true };
}

/**
 * Evaluate group policy access (open/disabled/allowlist)
 */
export function evaluateGroupPolicyAccess(params: {
  isGroup: boolean;
  groupPolicy: GroupPolicy;
  effectiveGroupAllow: NormalizedAllowFrom;
  senderId?: string;
  senderUsername?: string;
}): GroupAccessResult {
  const { isGroup, groupPolicy, effectiveGroupAllow, senderId, senderUsername } = params;
  
  // Not a group or policy not enforced = always allowed
  if (!isGroup) {
    return { allowed: true, groupPolicy };
  }
  
  // Disabled policy = block all
  if (groupPolicy === 'disabled') {
    return { allowed: false, reason: 'policy-blocked', groupPolicy };
  }
  
  // Open policy = allow all (mention gating handled separately)
  if (groupPolicy === 'open') {
    return { allowed: true, groupPolicy };
  }
  
  // Allowlist policy = check allowFrom
  if (groupPolicy === 'allowlist') {
    if (!effectiveGroupAllow.hasEntries && !effectiveGroupAllow.hasWildcard) {
      return { allowed: false, reason: 'policy-blocked', groupPolicy };
    }
    
    const allowed = isSenderAllowed({
      allow: effectiveGroupAllow,
      senderId,
      senderUsername,
    });
    
    if (!allowed) {
      return { allowed: false, reason: 'policy-blocked', groupPolicy };
    }
  }
  
  return { allowed: true, groupPolicy };
}

/**
 * Resolve group policy from config hierarchy
 */
export function resolveGroupPolicy(params: {
  topicConfig?: TelegramTopicConfig;
  groupConfig?: TelegramGroupConfig;
  accountGroupPolicy?: GroupPolicy;
  defaultGroupPolicy?: GroupPolicy;
}): GroupPolicy {
  // Priority: topic > group > account > default
  return (
    params.topicConfig?.groupPolicy ??
    params.groupConfig?.groupPolicy ??
    params.accountGroupPolicy ??
    params.defaultGroupPolicy ??
    'open'
  );
}

/**
 * Resolve requireMention from config hierarchy
 */
export function resolveRequireMention(params: {
  topicConfig?: TelegramTopicConfig;
  groupConfig?: TelegramGroupConfig;
  defaultRequireMention?: boolean;
}): boolean {
  return (
    params.topicConfig?.requireMention ??
    params.groupConfig?.requireMention ??
    params.defaultRequireMention ??
    true
  );
}

// ============================================
// Mention Detection
// ============================================

/**
 * Build mention regexes for bot username
 */
export function buildMentionRegex(botUsername: string): RegExp {
  const escaped = botUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`@${escaped}`, 'i');
}

/**
 * Check if message has bot mention (text or entity)
 */
export function hasBotMention(params: {
  botUsername: string;
  text?: string;
  entities?: Array<{ type: string; offset: number; length: number }>;
}): boolean {
  const { botUsername, text = '', entities = [] } = params;
  const botUsernameLower = botUsername.toLowerCase();
  const textLower = text.toLowerCase();
  
  // Check text mention
  if (textLower.includes(`@${botUsernameLower}`)) {
    return true;
  }
  
  // Check entity mentions
  for (const ent of entities) {
    if (ent.type === 'mention') {
      const mentionText = text.slice(ent.offset, ent.offset + ent.length);
      if (mentionText.toLowerCase() === `@${botUsernameLower}`) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Remove bot mention from text
 */
export function removeBotMention(text: string, botUsername: string): string {
  const botUsernameLower = botUsername.toLowerCase();
  return text.replace(new RegExp(`@${botUsernameLower}\\s*`, 'gi'), '').trim();
}
