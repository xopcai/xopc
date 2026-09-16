import { validateConversationId } from '@xopcai/gateway-contract';

import { requireConversation, resolveRoutedConversation } from '../storage/sqlite/conversation-repository.js';
import { normalizeLowercaseStringOrEmpty } from '../utils/string-coerce.js';

export { DEFAULT_ACCOUNT_ID, normalizeAccountId, normalizeOptionalAccountId } from './account-id.js';
export const DEFAULT_AGENT_ID = 'main';
export const DEFAULT_MAIN_KEY = 'main';
export type PeerKind = 'direct' | 'group' | 'channel' | 'dm';
const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

export function normalizeMainKey(value: string | undefined | null): string {
  return normalizeLowercaseStringOrEmpty(value) || DEFAULT_MAIN_KEY;
}

export function normalizeAgentId(value: string | undefined | null): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return DEFAULT_AGENT_ID;
  }
  const normalized = normalizeLowercaseStringOrEmpty(trimmed);
  if (VALID_ID_RE.test(trimmed)) {
    return normalized;
  }
  return (
    normalized
      .replace(INVALID_CHARS_RE, '-')
      .replace(LEADING_DASH_RE, '')
      .replace(TRAILING_DASH_RE, '')
      .slice(0, 64) || DEFAULT_AGENT_ID
  );
}

export function isValidAgentId(value: string | undefined | null): boolean {
  const trimmed = (value ?? '').trim();
  return Boolean(trimmed) && VALID_ID_RE.test(trimmed);
}

export function sanitizeAgentId(value: string | undefined | null): string {
  return normalizeAgentId(value);
}


export function getConversation(conversationId: string | null | undefined) {
  return conversationId ? requireConversation(conversationId) : null;
}

export function resolveAgentIdFromConversationId(conversationId: string): string {
  return requireConversation(conversationId).agentId;
}

export function resolveAgentMainConversationId(params: { agentId: string; mainKey?: string }): string {
  return resolveRoutedConversation({
    agentId: params.agentId, source: 'cli', peerKind: 'direct', peerId: params.mainKey || 'main',
    dmScope: 'main', mainKey: params.mainKey,
  });
}

export function resolveAgentPeerConversationId(params: {
  agentId: string; mainKey?: string; channel: string; accountId?: string | null;
  peerKind?: PeerKind | null; peerId?: string | null; threadId?: string;
  identityLinks?: Record<string, string[]>;
  dmScope?: 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';
}): string {
  return resolveRoutedConversation({
    ...params, source: params.channel, accountId: params.accountId ?? undefined,
    peerKind: params.peerKind ?? 'direct', peerId: params.peerId ?? '', dmScope: params.dmScope ?? 'main',
  });
}

export function defaultMainConversationId(agentId = DEFAULT_AGENT_ID, mainKey?: string): string {
  return resolveAgentMainConversationId({ agentId, mainKey });
}

export function isCronConversationId(id: string | null | undefined): boolean {
  return !!id && requireConversation(id).sessionType === 'cron';
}

export function isSubagentConversationId(id: string | null | undefined): boolean {
  return !!id && requireConversation(id).sessionType === 'workflow-subagent';
}

export function assertAgentConversationId(id: string): void {
  validateConversationId(id);
}
