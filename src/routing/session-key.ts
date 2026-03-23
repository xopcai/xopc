/**
 * Session key construction and parsing.
 *
 * Format: {agentId}:{source}:{accountId}:{peerKind}:{peerId}[:thread:{threadId}][:scope:{scopeId}]
 *
 * Examples:
 * - main:telegram:acc_default:dm:123456
 * - main:discord:acc_work:channel:987654:thread:789
 * - subagent:main:abc123:telegram:acc_default:dm:123456
 * - main:acp:{uuid}
 */

// Precompiled regexes for segment validation
const VALID_SEGMENT_RE = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

/**
 * Sanitize a segment to allowed chars a-z0-9_-
 */
export function sanitizeSegment(value: string | undefined | null, options?: { allowLeadingDash?: boolean }): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return '';
  }
  
  // Strip disallowed characters
  let cleaned = trimmed
    .toLowerCase()
    .replace(INVALID_CHARS_RE, '-');
  
  // Trim leading/trailing dashes unless a leading dash is allowed (e.g. negative IDs)
  if (!options?.allowLeadingDash) {
    cleaned = cleaned
      .replace(LEADING_DASH_RE, '')
      .replace(TRAILING_DASH_RE, '');
  } else {
    // When leading dash is allowed, only strip trailing dashes
    cleaned = cleaned.replace(TRAILING_DASH_RE, '');
  }
  
  if (!cleaned) {
    return '';
  }
  
  return cleaned.slice(0, 64);
}

/**
 * Whether the segment matches the allowed pattern and length.
 */
export function isValidSegment(value: string | undefined | null): boolean {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return false;
  }
  
  if (trimmed.length > 64) {
    return false;
  }
  
  return VALID_SEGMENT_RE.test(trimmed);
}

/**
 * Fields used to build a session key.
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
    // peerId may start with '-' (e.g. Telegram supergroup id -1001234567890)
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
 * Parsed session key components.
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
  
  // Optional :thread: and :scope: suffix segments
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
 * Whether the key refers to a subagent session.
 */
export function isSubagentSessionKey(sessionKey: string | undefined | null): boolean {
  const parsed = parseSessionKey(sessionKey);
  return parsed?.agentId === 'subagent';
}

/**
 * Whether the key is an ACP session.
 */
export function isAcpSessionKey(sessionKey: string | undefined | null): boolean {
  const parsed = parseSessionKey(sessionKey);
  return parsed?.source === 'acp';
}

/**
 * Whether the key is a cron-driven session.
 */
export function isCronSessionKey(sessionKey: string | undefined | null): boolean {
  const parsed = parseSessionKey(sessionKey);
  return parsed?.source === 'cron';
}

/**
 * Nesting depth from repeated `subagent` prefixes in the colon-separated key.
 * e.g. `subagent:...` => 1, `subagent:subagent:...` => 2
 */
export function getSubagentDepth(sessionKey: string | undefined | null): number {
  const raw = (sessionKey ?? '').trim();
  if (!raw) {
    return 0;
  }
  
  const parts = raw.split(':');
  let depth = 0;
  
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
 * Parameters for building a subagent session key.
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
 * Parent session key without a :thread: suffix, if any.
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
 * Normalize a session key (trim + lowercase).
 */
export function normalizeSessionKey(sessionKey: string | undefined | null): string {
  return (sessionKey ?? '').trim().toLowerCase();
}
