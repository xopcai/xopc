/**
 * 路由决策引擎
 * 
 * 综合 binding 规则、identity links 和配置，决定消息应该路由到哪个 agent。
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
 * Identity Link 配置
 * 
 * 用于跨平台用户身份合并
 * 格式：{ canonicalName: [alias1, alias2, ...] }
 */
export type IdentityLinks = Record<string, string[]>;

/**
 * 会话配置
 */
export interface SessionConfig {
  /** DM 会话作用域策略 */
  dmScope?: 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';
  /** 身份链接 */
  identityLinks?: IdentityLinks;
  /** 存储配置 */
  storage?: {
    pruneAfterMs?: number;
    maxEntries?: number;
  };
}

/**
 * Agent 配置
 */
export interface AgentConfig {
  /** 默认 Agent ID */
  default?: string;
  /** Agent 列表 */
  list?: Array<{
    id: string;
    name?: string;
    enabled?: boolean;
  }>;
}

/**
 * 完整配置
 */
export interface RoutingConfig {
  agents?: AgentConfig;
  bindings?: BindingRule[] | any[];
  session?: SessionConfig;
}

/**
 * 路由输入
 */
export interface ResolveRouteInput extends RouteInput {
  /** 配置对象 */
  config: RoutingConfig;
  /** 线程 ID（可选） */
  threadId?: string | null;
}

/**
 * 路由结果
 */
export interface ResolveRouteResult extends RouteResult {
  /** 生成的 session key */
  sessionKey: string;
  /** 主 session key（用于 DM 会话合并） */
  mainSessionKey: string;
  /** 最后路由策略 */
  lastRoutePolicy: 'main' | 'session';
}

/**
 * 应用 Identity Links，解析规范化的 peer ID
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
  
  // 构建候选 ID 集合
  const candidates = new Set<string>();
  candidates.add(normalizedPeerId);
  
  // 添加带 channel 前缀的候选
  const channelPrefix = channel.trim().toLowerCase();
  if (channelPrefix) {
    candidates.add(`${channelPrefix}:${normalizedPeerId}`);
  }
  
  // 查找匹配的 canonical name
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
 * 获取默认 Agent ID
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
 * 检查 Agent 是否存在
 */
export function agentExists(agentId: string, config: RoutingConfig): boolean {
  if (!config.agents?.list) {
    return true; // 没有配置列表时认为所有 agent 都存在
  }
  
  return config.agents.list.some(
    (agent) => agent.enabled !== false && agent.id.toLowerCase() === agentId.toLowerCase()
  );
}

/**
 * 选择第一个存在的 Agent ID
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
 * 构建 session key
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
 * 推导最后路由策略
 */
export function deriveLastRoutePolicy(
  sessionKey: string,
  mainSessionKey: string
): 'main' | 'session' {
  return sessionKey === mainSessionKey ? 'main' : 'session';
}

/**
 * 解析路由决策（主函数）
 */
export function resolveRoute(input: ResolveRouteInput): ResolveRouteResult {
  const { config, threadId } = input;
  
  // 规范化输入
  const channel = (input.channel ?? '').trim().toLowerCase() || 'unknown';
  const accountId = normalizeAccountId(input.accountId);
  const peerKind = (input.peerKind ?? 'dm').toLowerCase();
  const rawPeerId = (input.peerId ?? '').trim();
  
  // 应用 identity links
  const peerId = applyIdentityLinks(rawPeerId, channel, config.session?.identityLinks ?? {});
  
  // 解析 binding 规则
  const rules = Array.isArray(config.bindings)
    ? parseBindingRules({ bindings: config.bindings })
    : [];
  
  // 解析 binding 路由
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
  
  // 选择存在的 agent
  const agentId = pickFirstExistingAgentId(bindingResult.agentId, config);
  
  // 确定 DM scope
  const dmScope = config.session?.dmScope ?? 'per-account-channel-peer';
  
  // 构建 session key
  let sessionKey: string;
  let mainSessionKey: string;
  
  if (peerKind === 'dm' || peerKind === 'direct') {
    // DM 会话：根据 scope 策略决定是否合并
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
    // 群组/频道会话
    sessionKey = buildRouteSessionKey(agentId, channel, accountId, peerKind, peerId, threadId);
    mainSessionKey = buildRouteSessionKey(agentId, channel, accountId, peerKind, 'main');
  }
  
  // 添加 thread 后缀（如果有）
  if (threadId && !sessionKey.includes(':thread:')) {
    sessionKey = `${sessionKey}:thread:${threadId.toLowerCase()}`;
  }
  
  // 标准化 session keys
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
 * 从 session key 解析路由信息
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
