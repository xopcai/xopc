import { normalizeAccountId } from './account-id.js';

export type DirectConversationScope = 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';

export interface ConversationRouteInput {
  agentId: string;
  source: string;
  accountId?: string;
  peerKind: string;
  peerId: string;
  threadId?: string | null;
  scopeId?: string | null;
  mainKey?: string;
  dmScope?: DirectConversationScope;
  identityLinks?: Record<string, string[]>;
}

export interface ConversationRoute {
  agentId: string;
  scope: DirectConversationScope | 'group';
  channel: string;
  accountId: string;
  peerKind: string;
  peerId: string;
  threadId: string;
  scopeId: string;
}

function normalized(value?: string | null): string {
  return value?.trim().toLowerCase() ?? '';
}

export function resolveLinkedConversationPeer(
  peerId: string,
  source: string,
  links?: Record<string, string[]>,
): string {
  const peer = normalized(peerId);
  const candidates = new Set([peer, `${normalized(source)}:${peer}`]);
  for (const [canonical, aliases] of Object.entries(links ?? {})) {
    if (canonical.trim() && aliases.some(alias => candidates.has(normalized(alias)))) {
      return normalized(canonical);
    }
  }
  return peer;
}

/** Computes routing equivalence, independently of conversation identity or storage. */
export function resolveConversationRoute(input: ConversationRouteInput): ConversationRoute {
  const agentId = normalized(input.agentId);
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(agentId)) throw new Error('Invalid conversation agent ID');
  const direct = input.peerKind === 'direct' || input.peerKind === 'dm';
  const scope = direct ? input.dmScope ?? 'per-account-channel-peer' : 'group';
  const peer = scope === 'main'
    ? normalized(input.mainKey) || 'main'
    : direct ? resolveLinkedConversationPeer(input.peerId, input.source, input.identityLinks) : normalized(input.peerId);
  if (!peer) throw new Error('Conversation route requires a peer ID');
  return {
    agentId,
    scope,
    channel: scope === 'main' || scope === 'per-peer' ? '' : normalized(input.source) || 'unknown',
    accountId: scope === 'per-account-channel-peer' ? normalizeAccountId(input.accountId) : '',
    peerKind: direct ? 'direct' : normalized(input.peerKind),
    peerId: peer,
    threadId: normalized(input.threadId),
    scopeId: input.scopeId ? normalized(input.scopeId).replace(/[^a-z0-9_-]+/g, '-').slice(0, 64) || 'default' : '',
  };
}

/** A collision-free lookup tuple; never a public conversation identifier. */
export function conversationRouteKey(route: ConversationRoute): string {
  return JSON.stringify([
    route.agentId, route.scope, route.channel, route.accountId,
    route.peerKind, route.peerId, route.threadId, route.scopeId,
  ]);
}
