/**
 * Channel Security - Unified access control
 */

import type { DmPolicy, GroupPolicy } from './plugin-types.js';

// ============================================
// Allowlist Matching
// ============================================

export interface AllowlistMatch {
  allowed: boolean;
  matchKey?: string;
  matchSource?: 'wildcard' | 'id' | 'name' | 'username' | 'prefixed-id' | 'prefixed-user';
}

interface CompiledAllowlist {
  set: ReadonlySet<string>;
  wildcard: boolean;
}

export function compileAllowlist(entries: ReadonlyArray<string | number>): CompiledAllowlist {
  const set = new Set(
    entries.map(e => String(e).trim().toLowerCase()).filter(Boolean)
  );
  return { set, wildcard: set.has('*') };
}

export function resolveAllowlistMatch(params: {
  allowFrom: ReadonlyArray<string | number>;
  senderId: string;
  senderUsername?: string | null;
  allowNameMatching?: boolean;
}): AllowlistMatch {
  const compiled = compileAllowlist(params.allowFrom);
  if (compiled.set.size === 0) return { allowed: false };
  if (compiled.wildcard) return { allowed: true, matchKey: '*', matchSource: 'wildcard' };
  
  const senderId = params.senderId.toLowerCase();
  if (compiled.set.has(senderId)) return { allowed: true, matchKey: senderId, matchSource: 'id' };
  
  if (params.allowNameMatching && params.senderUsername) {
    const senderUsername = params.senderUsername.toLowerCase();
    if (compiled.set.has(senderUsername)) return { allowed: true, matchKey: senderUsername, matchSource: 'username' };
  }
  
  for (const entry of compiled.set) {
    if (entry.endsWith(':') && senderId.startsWith(entry)) {
      return { allowed: true, matchKey: entry, matchSource: 'prefixed-id' };
    }
  }
  return { allowed: false };
}

export function resolveAllowlistMatchSimple(params: {
  allowFrom: ReadonlyArray<string | number>;
  senderId: string;
  senderName?: string | null;
  allowNameMatching?: boolean;
}): AllowlistMatch {
  return resolveAllowlistMatch(params);
}

// ============================================
// Policy Resolution
// ============================================

export interface SecurityContext {
  channel: string;
  accountId: string;
  chatId: string;
  senderId: string;
  senderName?: string;
  isGroup: boolean;
  isDm: boolean;
  threadId?: string;
}

export interface SecurityResult {
  allowed: boolean;
  reason?: string;
  policy: DmPolicy | GroupPolicy;
  match?: AllowlistMatch;
}

export function resolveDmPolicy(configValue?: DmPolicy, defaultValue: DmPolicy = 'open'): DmPolicy {
  return configValue ?? defaultValue;
}

export function resolveGroupPolicy(configValue?: GroupPolicy, defaultValue: GroupPolicy = 'open'): GroupPolicy {
  return configValue ?? defaultValue;
}

export function evaluateAccess(params: {
  context: SecurityContext;
  dmPolicy?: DmPolicy;
  groupPolicy?: GroupPolicy;
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  allowNameMatching?: boolean;
}): SecurityResult {
  const { context } = params;
  if (context.isDm) {
    return evaluateDmAccess({
      context,
      policy: resolveDmPolicy(params.dmPolicy),
      allowFrom: params.allowFrom ?? [],
      allowNameMatching: params.allowNameMatching,
    });
  }
  return evaluateGroupAccess({
    context,
    policy: resolveGroupPolicy(params.groupPolicy),
    allowFrom: params.groupAllowFrom ?? params.allowFrom ?? [],
    allowNameMatching: params.allowNameMatching,
  });
}

function evaluateDmAccess(params: {
  context: SecurityContext;
  policy: DmPolicy;
  allowFrom: Array<string | number>;
  allowNameMatching?: boolean;
}): SecurityResult {
  const { context, policy, allowFrom } = params;
  if (policy === 'disabled') return { allowed: false, reason: 'DM is disabled', policy };
  if (policy === 'open') return { allowed: true, policy };

  if (policy === 'pairing') return { allowed: true, policy };

  if (policy === 'allowlist') {
    const match = resolveAllowlistMatchSimple({
      allowFrom,
      senderId: context.senderId,
      senderName: context.senderName,
      allowNameMatching: params.allowNameMatching,
    });
    return { allowed: match.allowed, reason: match.allowed ? undefined : 'Not in DM allowlist', policy, match };
  }
  return { allowed: false, reason: 'Unknown policy', policy: policy as DmPolicy };
}

function evaluateGroupAccess(params: {
  context: SecurityContext;
  policy: GroupPolicy;
  allowFrom: Array<string | number>;
  allowNameMatching?: boolean;
}): SecurityResult {
  const { context, policy, allowFrom } = params;
  if (policy === 'block') return { allowed: false, reason: 'Group messages are blocked', policy };
  if (policy === 'open') return { allowed: true, policy };
  
  if (policy === 'allowlist') {
    const match = resolveAllowlistMatchSimple({
      allowFrom,
      senderId: context.senderId,
      senderName: context.senderName,
      allowNameMatching: params.allowNameMatching,
    });
    return { allowed: match.allowed, reason: match.allowed ? undefined : 'Not in group allowlist', policy, match };
  }
  return { allowed: false, reason: 'Unknown policy', policy: policy as GroupPolicy };
}

// ============================================
// Mention Detection
// ============================================

export function hasBotMention(params: { text: string; botUsername: string; entities?: Array<{ type: string; offset: number; length: number }> }): boolean {
  const { text, botUsername, entities } = params;
  const lowerText = text.toLowerCase();
  const lowerUsername = botUsername.toLowerCase();
  if (lowerText.includes(`@${lowerUsername}`)) return true;
  if (entities) {
    for (const entity of entities) {
      if (entity.type === 'mention') {
        const mentioned = text.slice(entity.offset, entity.offset + entity.length);
        if (mentioned.toLowerCase().includes(lowerUsername)) return true;
      }
    }
  }
  return false;
}

export function removeBotMention(params: { text: string; botUsername: string }): string {
  const { text, botUsername } = params;
  const lowerUsername = botUsername.toLowerCase();
  let result = text.replace(new RegExp(`@${lowerUsername}`, 'gi'), '');
  result = result.replace(new RegExp(`@${botUsername}`, 'g'), '');
  return result.replace(/\s+/g, ' ').trim();
}
