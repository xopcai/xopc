/**
 * Binding 规则管理
 * 
 * 支持优先级匹配、glob 模式匹配 peerId、多条件匹配
 */

import { normalizeAccountId } from './account-id.js';
import { sanitizeSegment } from './session-key.js';

/**
 * Binding 匹配条件
 */
export interface BindingMatch {
  /** Channel ID（必需） */
  channel: string;
  /** Account ID 模式（支持 * 通配符） */
  accountId?: string;
  /** Peer 类型（dm, group, channel 等） */
  peerKind?: string;
  /** Peer ID（支持 glob 模式） */
  peerId?: string;
  /** Guild ID（Discord 服务器） */
  guildId?: string;
  /** Team ID（Slack 工作区） */
  teamId?: string;
  /** 角色 ID 列表（用于基于角色的路由） */
  memberRoleIds?: string[];
}

/**
 * Binding 规则
 */
export interface BindingRule {
  /** 规则 ID */
  id: string;
  /** 目标 Agent ID */
  agentId: string;
  /** 优先级（数字越小优先级越高） */
  priority: number;
  /** 匹配条件 */
  match: BindingMatch;
  /** 是否启用 */
  enabled?: boolean;
}

/**
 * 路由决策输入
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
 * 路由决策结果
 */
export interface RouteResult {
  agentId: string;
  accountId: string;
  matchedRule?: BindingRule;
  matchedBy: 'binding' | 'default';
}

/**
 * 简单的 glob 匹配（支持 * 通配符）
 */
export function globMatch(pattern: string, value: string): boolean {
  if (pattern === '*') {
    return true;
  }
  
  // 转义特殊字符，将 * 转换为 .*
  const regexPattern = pattern
    .split('*')
    .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  
  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(value);
}

/**
 * 检查输入是否匹配 binding 规则
 */
export function matchesBinding(input: RouteInput, match: BindingMatch): boolean {
  // Channel 必须匹配
  if (input.channel.toLowerCase() !== match.channel.toLowerCase()) {
    return false;
  }
  
  // Account ID 匹配（支持 * 通配符）
  if (match.accountId && match.accountId !== '*') {
    const inputAccountId = normalizeAccountId(input.accountId);
    const patternAccountId = normalizeAccountId(match.accountId);
    if (!globMatch(patternAccountId, inputAccountId)) {
      return false;
    }
  }
  
  // PeerKind 匹配
  if (match.peerKind) {
    const inputPeerKind = (input.peerKind ?? '').toLowerCase();
    if (inputPeerKind !== match.peerKind.toLowerCase()) {
      return false;
    }
  }
  
  // PeerId 匹配（支持 glob 模式）
  if (match.peerId) {
    const inputPeerId = (input.peerId ?? '').toLowerCase();
    if (!globMatch(match.peerId.toLowerCase(), inputPeerId)) {
      return false;
    }
  }
  
  // GuildId 匹配
  if (match.guildId) {
    const inputGuildId = (input.guildId ?? '').toLowerCase();
    if (inputGuildId !== match.guildId.toLowerCase()) {
      return false;
    }
  }
  
  // TeamId 匹配
  if (match.teamId) {
    const inputTeamId = (input.teamId ?? '').toLowerCase();
    if (inputTeamId !== match.teamId.toLowerCase()) {
      return false;
    }
  }
  
  // MemberRoleIds 匹配（任一匹配即可）
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
 * 从配置中解析 binding 规则
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
  
  // 按优先级排序（高优先级在前）
  return rules.sort((a, b) => b.priority - a.priority);
}

/**
 * 解析单个 binding 规则
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
 * 解析路由决策
 */
export function resolveRoute(
  input: RouteInput,
  rules: BindingRule[],
  defaultAgentId: string = 'main'
): RouteResult {
  const normalizedAccountId = normalizeAccountId(input.accountId);
  
  // 查找第一个匹配的规则
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
  
  // 默认路由
  return {
    agentId: defaultAgentId,
    accountId: normalizedAccountId,
    matchedBy: 'default',
  };
}
