/**
 * Binding rules
 *
 * Priority-ordered rules with optional glob patterns on peer id and related fields.
 */

import { normalizeAccountId } from './account-id.js';
import { sanitizeSegment } from './session-key.js';

/**
 * Single binding match clause.
 */
export interface BindingMatch {
  /** Channel id (required) */
  channel: string;
  /** Account id pattern (`*` allowed) */
  accountId?: string;
  /** Peer kind (dm, group, channel, …) */
  peerKind?: string;
  /** Peer id glob */
  peerId?: string;
  /** Discord guild id */
  guildId?: string;
  /** Slack team id */
  teamId?: string;
  /** Role ids (any match wins) */
  memberRoleIds?: string[];
}

/**
 * One routing rule with priority.
 */
export interface BindingRule {
  /** Stable rule id */
  id: string;
  /** Target agent id */
  agentId: string;
  /** Lower number = higher priority */
  priority: number;
  /** Match clause */
  match: BindingMatch;
  /** Disabled rules are skipped */
  enabled?: boolean;
}

/**
 * Incoming message context for binding resolution.
 */
export interface RouteInput {
  channel: string;
  accountId?: string | null;
  peerKind?: string | null;
  peerId?: string | null;
  guildId?: string | null;
  teamId?: string | null;
  memberRoleIds?: string[];
}

/**
 * Result of binding resolution.
 */
export interface RouteResult {
  agentId: string;
  accountId: string;
  matchedRule?: BindingRule;
  matchedBy: 'binding' | 'default';
}

/**
 * Simple glob match (`*` only).
 */
export function globMatch(pattern: string, value: string): boolean {
  if (pattern === '*') {
    return true;
  }
  
  const regexPattern = pattern
    .split('*')
    .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  
  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(value);
}

/**
 * Whether `input` satisfies `match`.
 */
export function matchesBinding(input: RouteInput, match: BindingMatch): boolean {
  if (input.channel.toLowerCase() !== match.channel.toLowerCase()) {
    return false;
  }
  
  if (match.accountId && match.accountId !== '*') {
    const inputAccountId = normalizeAccountId(input.accountId);
    const patternAccountId = normalizeAccountId(match.accountId);
    if (!globMatch(patternAccountId, inputAccountId)) {
      return false;
    }
  }
  
  if (match.peerKind) {
    const inputPeerKind = (input.peerKind ?? '').toLowerCase();
    if (inputPeerKind !== match.peerKind.toLowerCase()) {
      return false;
    }
  }
  
  if (match.peerId) {
    const inputPeerId = (input.peerId ?? '').toLowerCase();
    if (!globMatch(match.peerId.toLowerCase(), inputPeerId)) {
      return false;
    }
  }
  
  if (match.guildId) {
    const inputGuildId = (input.guildId ?? '').toLowerCase();
    if (inputGuildId !== match.guildId.toLowerCase()) {
      return false;
    }
  }
  
  if (match.teamId) {
    const inputTeamId = (input.teamId ?? '').toLowerCase();
    if (inputTeamId !== match.teamId.toLowerCase()) {
      return false;
    }
  }
  
  if (match.memberRoleIds && match.memberRoleIds.length > 0) {
    const inputRoleIds = new Set((input.memberRoleIds ?? []).map((r) => r.toLowerCase()));
    const hasMatchingRole = match.memberRoleIds.some((role) =>
      inputRoleIds.has(role.toLowerCase())
    );
    if (!hasMatchingRole) {
      return false;
    }
  }
  
  return true;
}

/**
 * Parse binding rules from config JSON.
 */
export function parseBindingRules(config: any): BindingRule[] {
  const rules: BindingRule[] = [];
  
  if (!config?.bindings || !Array.isArray(config.bindings)) {
    return rules;
  }
  
  for (const [index, raw] of Object.entries(config.bindings)) {
    const rule = parseBindingRule(raw, Number(index));
    if (rule) {
      rules.push(rule);
    }
  }
  
  return rules.sort((a, b) => b.priority - a.priority);
}

/**
 * Parse one raw binding object or return null.
 */
export function parseBindingRule(raw: any, index: number): BindingRule | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  
  const match = raw.match;
  if (!match || typeof match !== 'object' || !match.channel) {
    return null;
  }
  
  return {
    id: raw.id ?? `binding-${index}`,
    agentId: sanitizeSegment(raw.agentId) || 'main',
    priority: typeof raw.priority === 'number' ? raw.priority : index,
    match: {
      channel: match.channel.toLowerCase(),
      accountId: match.accountId,
      peerKind: match.peerKind,
      peerId: match.peerId,
      guildId: match.guildId,
      teamId: match.teamId,
      memberRoleIds: Array.isArray(match.memberRoleIds) ? match.memberRoleIds : undefined,
    },
    enabled: raw.enabled !== false,
  };
}

/**
 * Pick the first matching rule or fall back to `defaultAgentId`.
 */
export function resolveRoute(
  input: RouteInput,
  rules: BindingRule[],
  defaultAgentId: string = 'main'
): RouteResult {
  const normalizedAccountId = normalizeAccountId(input.accountId);
  
  for (const rule of rules) {
    if (rule.enabled === false) {
      continue;
    }
    
    if (matchesBinding(input, rule.match)) {
      return {
        agentId: rule.agentId,
        accountId: normalizedAccountId,
        matchedRule: rule,
        matchedBy: 'binding',
      };
    }
  }
  
  return {
    agentId: defaultAgentId,
    accountId: normalizedAccountId,
    matchedBy: 'default',
  };
}
