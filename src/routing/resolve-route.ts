/**
 * Route resolution
 *
 * Combines binding rules, identity links, and config to pick an agent and session keys.
 */

import type { BindingRule, RouteInput, RouteResult } from './bindings.js';

/**
 * Route context type (alias for RouteInput)
 */
export type RouteContext = RouteInput;
import { parseBindingRules, resolveRoute as resolveBindingRoute } from './bindings.js';
import { buildSessionKey, normalizeSessionKey, parseSessionKey } from './session-key.js';
import { normalizeAccountId } from './account-id.js';

/**
 * Identity link map: canonical peer id -> aliases across channels.
 *
 * Shape: `{ canonicalName: [alias1, alias2, ...] }`
 */
export type IdentityLinks = Record<string, string[]>;

/**
 * Session-related routing options.
 */
export interface SessionConfig {
  /** How DM sessions are scoped / merged */
  dmScope?: 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';
  /** Cross-channel identity aliases */
  identityLinks?: IdentityLinks;
  /** Optional session store tuning */
  storage?: {
    pruneAfterMs?: number;
    maxEntries?: number;
  };
}

/**
 * Agent list and default id from config.
 */
export interface AgentConfig {
  /** Default agent id */
  default?: string;
  /** Registered agents */
  list?: Array<{
    id: string;
    name?: string;
    enabled?: boolean;
  }>;
}

/**
 * Subset of app config used for routing.
 */
export interface RoutingConfig {
  agents?: AgentConfig;
  bindings?: BindingRule[] | any[];
  session?: SessionConfig;
}

/**
 * Input to `resolveRoute`.
 */
export interface ResolveRouteInput extends RouteInput {
  /** Routing config snapshot */
  config: RoutingConfig;
  /** Optional thread id for threaded channels */
  threadId?: string | null;
}

/**
 * Resolved route including session keys.
 */
export interface ResolveRouteResult extends RouteResult {
  /** Active session key for this turn */
  sessionKey: string;
  /** Main session key (DM merge target) */
  mainSessionKey: string;
  /** Whether routing used the main or a per-session key */
  lastRoutePolicy: 'main' | 'session';
}

/**
 * Apply identity links and return a canonical lowercased peer id.
 */
export function applyIdentityLinks(
  peerId: string,
  channel: string,
  identityLinks?: IdentityLinks
): string {
  if (!identityLinks) {
    return peerId.toLowerCase();
  }
  
  const normalizedPeerId = peerId.trim().toLowerCase();
  if (!normalizedPeerId) {
    return normalizedPeerId;
  }
  
  const candidates = new Set<string>();
  candidates.add(normalizedPeerId);
  
  const channelPrefix = channel.trim().toLowerCase();
  if (channelPrefix) {
    candidates.add(`${channelPrefix}:${normalizedPeerId}`);
  }
  
  // Match any alias to its canonical id
  for (const [canonical, aliases] of Object.entries(identityLinks)) {
    if (!Array.isArray(aliases)) {
      continue;
    }
    
    for (const alias of aliases) {
      const normalizedAlias = alias.trim().toLowerCase();
      if (candidates.has(normalizedAlias)) {
        return canonical.trim().toLowerCase();
      }
    }
  }
  
  return normalizedPeerId;
}

/**
 * Default agent id from config, falling back to `main`.
 */
export function getDefaultAgentId(config: RoutingConfig): string {
  // Try 'default' field first (RoutingConfig interface)
  if ((config.agents as any)?.default) {
    return (config.agents as any).default;
  }
  
  // Try to find first enabled agent from list
  const agentList = config.agents?.list;
  if (Array.isArray(agentList)) {
    const firstEnabled = agentList.find((a: any) => a.enabled !== false);
    if (firstEnabled?.id) {
      return firstEnabled.id;
    }
  }
  
  return 'main';
}

/**
 * Whether `agentId` appears in the enabled agent list (or list is absent).
 */
export function agentExists(agentId: string, config: RoutingConfig): boolean {
  if (!config.agents?.list) {
    return true; // No list: treat every id as valid
  }
  
  return config.agents.list.some(
    (agent) => agent.enabled !== false && agent.id.toLowerCase() === agentId.toLowerCase()
  );
}

/**
 * Return `agentId` if listed, otherwise the default agent id.
 */
export function pickFirstExistingAgentId(agentId: string, config: RoutingConfig): string {
  if (!agentId) {
    return getDefaultAgentId(config);
  }
  
  if (agentExists(agentId, config)) {
    return agentId.toLowerCase();
  }
  
  return getDefaultAgentId(config);
}

/**
 * Thin wrapper around `buildSessionKey` for route inputs.
 */
export function buildRouteSessionKey(
  agentId: string,
  channel: string,
  accountId: string,
  peerKind: string,
  peerId: string,
  threadId?: string | null,
  scopeId?: string | null
): string {
  return buildSessionKey({
    agentId,
    source: channel,
    accountId,
    peerKind,
    peerId,
    threadId: threadId || undefined,
    scopeId: scopeId || undefined,
  });
}

/**
 * Map session vs main key to policy label.
 */
export function deriveLastRoutePolicy(
  sessionKey: string,
  mainSessionKey: string
): 'main' | 'session' {
  return sessionKey === mainSessionKey ? 'main' : 'session';
}

/**
 * Resolve agent and session keys from channel context and config.
 */
export function resolveRoute(input: ResolveRouteInput): ResolveRouteResult {
  const { config, threadId } = input;
  
  const channel = (input.channel ?? '').trim().toLowerCase() || 'unknown';
  const accountId = normalizeAccountId(input.accountId);
  const peerKind = (input.peerKind ?? 'dm').toLowerCase();
  const rawPeerId = (input.peerId ?? '').trim();
  
  const peerId = applyIdentityLinks(rawPeerId, channel, config.session?.identityLinks ?? {});
  
  const rules = Array.isArray(config.bindings)
    ? parseBindingRules({ bindings: config.bindings })
    : [];
  
  const bindingResult = resolveBindingRoute(
    {
      channel,
      accountId,
      peerKind: input.peerKind,
      peerId: rawPeerId,
      guildId: input.guildId,
      teamId: input.teamId,
      memberRoleIds: input.memberRoleIds,
    },
    rules,
    getDefaultAgentId(config)
  );
  
  const agentId = pickFirstExistingAgentId(bindingResult.agentId, config);
  
  const dmScope = config.session?.dmScope ?? 'per-account-channel-peer';
  
  let sessionKey: string;
  let mainSessionKey: string;
  
  if (peerKind === 'dm' || peerKind === 'direct') {
    // DM: merge or split sessions depending on dmScope
    mainSessionKey = buildRouteSessionKey(agentId, channel, accountId, 'dm', 'main');
    
    switch (dmScope) {
      case 'per-peer':
        sessionKey = buildRouteSessionKey(agentId, channel, accountId, 'dm', peerId);
        break;
      case 'per-channel-peer':
        sessionKey = buildRouteSessionKey(agentId, channel, 'default', 'dm', peerId);
        break;
      case 'per-account-channel-peer':
        sessionKey = buildRouteSessionKey(agentId, 'default', 'default', 'dm', peerId);
        break;
      case 'main':
      default:
        sessionKey = mainSessionKey;
        break;
    }
  } else {
    // Group / channel / other peer kinds
    sessionKey = buildRouteSessionKey(agentId, channel, accountId, peerKind, peerId, threadId);
    mainSessionKey = buildRouteSessionKey(agentId, channel, accountId, peerKind, 'main');
  }
  
  if (threadId && !sessionKey.includes(':thread:')) {
    sessionKey = `${sessionKey}:thread:${threadId.toLowerCase()}`;
  }
  
  sessionKey = normalizeSessionKey(sessionKey);
  mainSessionKey = normalizeSessionKey(mainSessionKey);
  
  return {
    ...bindingResult,
    agentId,
    sessionKey,
    mainSessionKey,
    lastRoutePolicy: deriveLastRoutePolicy(sessionKey, mainSessionKey),
  };
}

/**
 * Parse basic routing fields from a session key string.
 */
export function resolveRouteFromSessionKey(
  sessionKey: string,
  _config: RoutingConfig
): { agentId: string; source: string; accountId: string; peerKind: string; peerId: string } | null {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) {
    return null;
  }
  
  return {
    agentId: parsed.agentId,
    source: parsed.source,
    accountId: parsed.accountId,
    peerKind: parsed.peerKind,
    peerId: parsed.peerId,
  };
}
