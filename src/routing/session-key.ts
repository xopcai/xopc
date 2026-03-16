/**
 * Session Key 生成和解析工具
 * 
 * Session Key 格式：{agentId}:{source}:{accountId}:{peerKind}:{peerId}[:thread:{threadId}][:scope:{scopeId}]
 * 
 * 示例：
 * - main:telegram:acc_default:dm:123456
 * - main:discord:acc_work:channel:987654:thread:789
 * - subagent:main:abc123:telegram:acc_default:dm:123456
 * - main:acp:{uuid}
 */

// 预编译的正则表达式
const VALID_SEGMENT_RE = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

/**
 * 清理段内容，只允许 a-z0-9_-
 */
export function sanitizeSegment(value: string | undefined | null, options?: { allowLeadingDash?: boolean }): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return '';
  }
  
  // 清理无效字符
  let cleaned = trimmed
    .toLowerCase()
    .replace(INVALID_CHARS_RE, '-');
  
  // 除非明确允许，否则移除前导和尾随的短横线
  if (!options?.allowLeadingDash) {
    cleaned = cleaned
      .replace(LEADING_DASH_RE, '')
      .replace(TRAILING_DASH_RE, '');
  } else {
    // 允许前导短横线时，只移除尾随的
    cleaned = cleaned.replace(TRAILING_DASH_RE, '');
  }
  
  // 如果清理后为空，返回空字符串
  if (!cleaned) {
    return '';
  }
  
  // 截断到 64 字符
  return cleaned.slice(0, 64);
}

/**
 * 验证段是否有效
 */
export function isValidSegment(value: string | undefined | null): boolean {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return false;
  }
  
  // 检查长度
  if (trimmed.length > 64) {
    return false;
  }
  
  // 使用正则表达式验证格式
  return VALID_SEGMENT_RE.test(trimmed);
}

/**
 * 构建 Session Key
 */
export interface BuildSessionKeyParams {
  agentId: string;
  source: string;
  accountId: string;
  peerKind: string;
  peerId: string;
  threadId?: string | null;
  scopeId?: string | null;
}

export function buildSessionKey(params: BuildSessionKeyParams): string {
  const segments = [
    sanitizeSegment(params.agentId) || 'main',
    sanitizeSegment(params.source) || 'unknown',
    sanitizeSegment(params.accountId) || 'default',
    sanitizeSegment(params.peerKind) || 'unknown',
    // peerId 可能包含前导负号（如 Telegram 群 ID: -1001234567）
    sanitizeSegment(params.peerId, { allowLeadingDash: true }) || 'unknown',
  ];
  
  if (params.threadId) {
    segments.push('thread', sanitizeSegment(params.threadId, { allowLeadingDash: true }) || 'unknown');
  }
  
  if (params.scopeId) {
    segments.push('scope', sanitizeSegment(params.scopeId, { allowLeadingDash: true }) || 'default');
  }
  
  return segments.join(':');
}

/**
 * 解析 Session Key
 */
export interface ParsedSessionKey {
  agentId: string;
  source: string;
  accountId: string;
  peerKind: string;
  peerId: string;
  threadId?: string;
  scopeId?: string;
}

export function parseSessionKey(sessionKey: string | undefined | null): ParsedSessionKey | null {
  const raw = (sessionKey ?? '').trim();
  if (!raw) {
    return null;
  }
  
  const parts = raw.split(':').filter(Boolean);
  
  // Handle ACP session key format: {agentId}:acp:{uuid}
  if (parts.length === 3 && parts[1]?.toLowerCase() === 'acp') {
    const [agentId, source, acpId] = parts;
    return {
      agentId: agentId.toLowerCase(),
      source: source.toLowerCase(),
      accountId: '_',
      peerKind: 'direct',
      peerId: acpId.toLowerCase(),
    };
  }
  
  // Handle subagent ACP session key format: subagent:{parentId}:{parentSessionId}:acp:{uuid}
  if (parts.length === 5 && parts[0]?.toLowerCase() === 'subagent' && parts[3]?.toLowerCase() === 'acp') {
    const [_subagent, parentId, parentSessionId, source, acpId] = parts;
    return {
      agentId: `subagent:${parentId.toLowerCase()}:${parentSessionId.toLowerCase()}`,
      source: source.toLowerCase(),
      accountId: '_',
      peerKind: 'direct',
      peerId: acpId.toLowerCase(),
    };
  }
  
  if (parts.length < 5) {
    return null;
  }
  
  const [agentId, source, accountId, peerKind, peerId, ...rest] = parts;
  
  if (!agentId || !source || !accountId || !peerKind || !peerId) {
    return null;
  }
  
  const result: ParsedSessionKey = {
    agentId: agentId.toLowerCase(),
    source: source.toLowerCase(),
    accountId: accountId.toLowerCase(),
    peerKind: peerKind.toLowerCase(),
    peerId: peerId.toLowerCase(),
  };
  
  // 解析可选的 thread 和 scope
  let i = 0;
  while (i < rest.length) {
    const marker = rest[i]?.toLowerCase();
    const value = rest[i + 1];
    
    if (marker === 'thread' && value) {
      result.threadId = value.toLowerCase();
      i += 2;
    } else if (marker === 'scope' && value) {
      result.scopeId = value.toLowerCase();
      i += 2;
    } else {
      i++;
    }
  }
  
  return result;
}

/**
 * 检查是否是 subagent session key
 */
export function isSubagentSessionKey(sessionKey: string | undefined | null): boolean {
  const parsed = parseSessionKey(sessionKey);
  return parsed?.agentId === 'subagent';
}

/**
 * 检查是否是 ACP session key
 */
export function isAcpSessionKey(sessionKey: string | undefined | null): boolean {
  const parsed = parseSessionKey(sessionKey);
  return parsed?.source === 'acp';
}

/**
 * 检查是否是 cron session key
 */
export function isCronSessionKey(sessionKey: string | undefined | null): boolean {
  const parsed = parseSessionKey(sessionKey);
  return parsed?.source === 'cron';
}

/**
 * 获取 subagent 深度
 * 
 * 通过解析 session key 的 agentId 部分来计算深度
 * subagent:xxx:... = depth 1
 * subagent:subagent:xxx:... = depth 2
 */
export function getSubagentDepth(sessionKey: string | undefined | null): number {
  const raw = (sessionKey ?? '').trim();
  if (!raw) {
    return 0;
  }
  
  const parts = raw.split(':');
  let depth = 0;
  
  // 计算连续的 subagent 前缀
  for (const part of parts) {
    if (part.toLowerCase() === 'subagent') {
      depth++;
    } else {
      break;
    }
  }
  
  return depth;
}

/**
 * 构建 subagent session key
 */
export interface BuildSubagentSessionKeyParams extends BuildSessionKeyParams {
  parentSessionKey: string;
}

export function buildSubagentSessionKey(params: BuildSubagentSessionKeyParams): string {
  const parentParsed = parseSessionKey(params.parentSessionKey);
  if (!parentParsed) {
    throw new Error(`Invalid parent session key: ${params.parentSessionKey}`);
  }
  
  return buildSessionKey({
    agentId: 'subagent',
    source: parentParsed.agentId,
    accountId: parentParsed.accountId,
    peerKind: parentParsed.peerKind,
    peerId: parentParsed.peerId,
    threadId: params.threadId,
    scopeId: params.scopeId,
  });
}

/**
 * 获取 session key 的父级（移除 thread 后缀）
 */
export function getParentSessionKey(sessionKey: string | undefined | null): string | null {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) {
    return null;
  }
  
  if (!parsed.threadId) {
    return null;
  }
  
  return buildSessionKey({
    agentId: parsed.agentId,
    source: parsed.source,
    accountId: parsed.accountId,
    peerKind: parsed.peerKind,
    peerId: parsed.peerId,
  });
}

/**
 * 标准化 session key（统一小写）
 */
export function normalizeSessionKey(sessionKey: string | undefined | null): string {
  return (sessionKey ?? '').trim().toLowerCase();
}
