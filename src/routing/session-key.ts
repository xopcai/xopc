/**
 * Session key parsing helpers for `agent:{agentId}:{rest}` keys.
 *
 * Re-exports the OpenClaw-aligned builder/parser surface from agent-session-key.ts.
 */

import {
  buildAgentPeerSessionKey,
  defaultMainSessionKey,
  normalizeAgentId,
  normalizeMainKey,
  parseAgentSessionKey,
  resolveThreadSessionKeys,
  type PeerKind,
} from './agent-session-key.js';

export * from './agent-session-key.js';
export * from './session-key-utils.js';

const VALID_SEGMENT_RE = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

export function sanitizeSegment(
  value: string | undefined | null,
  options?: { allowLeadingDash?: boolean },
): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return '';
  }

  let cleaned = trimmed.toLowerCase().replace(INVALID_CHARS_RE, '-');

  if (!options?.allowLeadingDash) {
    cleaned = cleaned.replace(LEADING_DASH_RE, '').replace(TRAILING_DASH_RE, '');
  } else {
    cleaned = cleaned.replace(TRAILING_DASH_RE, '');
  }

  if (!cleaned) {
    return '';
  }

  return cleaned.slice(0, 64);
}

export function isValidSegment(value: string | undefined | null): boolean {
  const trimmed = (value ?? '').trim();
  if (!trimmed || trimmed.length > 64) {
    return false;
  }
  return VALID_SEGMENT_RE.test(trimmed);
}

/** Structured view of an agent session key rest segment. */
export interface ParsedSessionKey {
  agentId: string;
  source: string;
  accountId: string;
  peerKind: string;
  peerId: string;
  threadId?: string;
  scopeId?: string;
}

export interface BuildSessionKeyParams {
  agentId: string;
  source: string;
  accountId: string;
  peerKind: string;
  peerId: string;
  threadId?: string | null;
  scopeId?: string | null;
  mainKey?: string;
  dmScope?: 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';
  identityLinks?: Record<string, string[]>;
}

/** Build an OpenClaw-style agent session key from routing segments. */
export function buildSessionKey(params: BuildSessionKeyParams): string {
  const peerKind = (params.peerKind === 'dm' ? 'direct' : params.peerKind) as PeerKind;
  let key = buildAgentPeerSessionKey({
    agentId: params.agentId,
    mainKey: params.mainKey,
    channel: params.source,
    accountId: params.accountId,
    peerKind,
    peerId: params.peerId,
    identityLinks: params.identityLinks,
    dmScope:
      params.dmScope ??
      (peerKind === 'direct' ? 'per-account-channel-peer' : undefined),
  });

  if (params.threadId) {
    key = resolveThreadSessionKeys({ baseSessionKey: key, threadId: params.threadId }).sessionKey;
  }

  if (params.scopeId) {
    key = `${key}:scope:${sanitizeSegment(params.scopeId, { allowLeadingDash: true }) || 'default'}`;
  }

  return key;
}

/** Parse `agent:{agentId}:{rest}` into routing segments. Returns null for invalid keys. */
export function parseSessionKey(sessionKey: string | undefined | null): ParsedSessionKey | null {
  const raw = (sessionKey ?? '').trim();
  if (!raw) {
    return null;
  }

  const { baseSessionKey, threadId } = parseThreadSuffix(raw);
  const agentParsed = parseAgentSessionKey(baseSessionKey);
  if (!agentParsed) {
    return null;
  }

  const scopeParts = parseScopeSuffix(agentParsed.rest);
  const rest = scopeParts.rest;
  const scopeId = scopeParts.scopeId;

  const mainKey = normalizeMainKey(undefined);
  if (rest === mainKey) {
    return {
      agentId: agentParsed.agentId,
      source: 'cli',
      accountId: 'default',
      peerKind: 'direct',
      peerId: mainKey,
      threadId,
      scopeId,
    };
  }

  if (rest.startsWith('subagent:')) {
    return parseSubagentRest(agentParsed.agentId, rest, threadId, scopeId);
  }

  if (rest.startsWith('cron:')) {
    const parts = rest.split(':');
    return {
      agentId: agentParsed.agentId,
      source: 'cron',
      accountId: 'default',
      peerKind: 'direct',
      peerId: parts.slice(1).join(':') || 'cron',
      threadId,
      scopeId,
    };
  }

  const parts = rest.split(':').filter(Boolean);

  // channel:account:direct:peer
  if (parts.length >= 4 && parts[2] === 'direct') {
    return {
      agentId: agentParsed.agentId,
      source: parts[0]!,
      accountId: parts[1]!,
      peerKind: 'direct',
      peerId: parts.slice(3).join(':'),
      threadId,
      scopeId,
    };
  }

  // channel:direct:peer
  if (parts.length >= 3 && parts[1] === 'direct') {
    return {
      agentId: agentParsed.agentId,
      source: parts[0]!,
      accountId: 'default',
      peerKind: 'direct',
      peerId: parts.slice(2).join(':'),
      threadId,
      scopeId,
    };
  }

  // direct:peer
  if (parts.length >= 2 && parts[0] === 'direct') {
    return {
      agentId: agentParsed.agentId,
      source: 'cli',
      accountId: 'default',
      peerKind: 'direct',
      peerId: parts.slice(1).join(':'),
      threadId,
      scopeId,
    };
  }

  // channel:group|channel:peer
  if (parts.length >= 3 && (parts[1] === 'group' || parts[1] === 'channel')) {
    return {
      agentId: agentParsed.agentId,
      source: parts[0]!,
      accountId: 'default',
      peerKind: parts[1]!,
      peerId: parts.slice(2).join(':'),
      threadId,
      scopeId,
    };
  }

  // Custom rest (e.g. tui-uuid)
  return {
    agentId: agentParsed.agentId,
    source: 'cli',
    accountId: 'default',
    peerKind: 'direct',
    peerId: rest,
    threadId,
    scopeId,
  };
}

function parseThreadSuffix(raw: string): { baseSessionKey: string; threadId?: string } {
  const lower = raw.toLowerCase();
  const idx = lower.lastIndexOf(':thread:');
  if (idx === -1) {
    return { baseSessionKey: raw };
  }
  return {
    baseSessionKey: raw.slice(0, idx),
    threadId: raw.slice(idx + ':thread:'.length),
  };
}

function parseScopeSuffix(rest: string): { rest: string; scopeId?: string } {
  const lower = rest.toLowerCase();
  const idx = lower.lastIndexOf(':scope:');
  if (idx === -1) {
    return { rest };
  }
  return {
    rest: rest.slice(0, idx),
    scopeId: rest.slice(idx + ':scope:'.length),
  };
}

function parseSubagentRest(
  parentAgentId: string,
  rest: string,
  threadId?: string,
  scopeId?: string,
): ParsedSessionKey {
  const body = rest.replace(/^subagent:/, '');
  const parentKey = body ? `agent:${parentAgentId}:${body}` : '';
  const parentParsed = parentKey ? parseSessionKey(parentKey) : null;
  if (parentParsed) {
    return {
      ...parentParsed,
      agentId: 'subagent',
      threadId: threadId ?? parentParsed.threadId,
      scopeId: scopeId ?? parentParsed.scopeId,
    };
  }
  return {
    agentId: 'subagent',
    source: parentAgentId,
    accountId: 'default',
    peerKind: 'direct',
    peerId: body || 'unknown',
    threadId,
    scopeId,
  };
}

export interface BuildSubagentSessionKeyParams extends BuildSessionKeyParams {
  parentSessionKey: string;
}

export function buildSubagentSessionKey(params: BuildSubagentSessionKeyParams): string {
  const parentParsed = parseAgentSessionKey(params.parentSessionKey);
  if (!parentParsed) {
    throw new Error(`Invalid parent session key: ${params.parentSessionKey}`);
  }
  const parentRest = parentParsed.rest;
  let key = `agent:${normalizeAgentId(parentParsed.agentId)}:subagent:${parentRest}`;
  if (params.threadId) {
    key = resolveThreadSessionKeys({ baseSessionKey: key, threadId: params.threadId }).sessionKey;
  }
  return key;
}

export function getParentSessionKey(sessionKey: string | undefined | null): string | null {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed?.threadId) {
    return null;
  }
  return buildSessionKey({
    agentId: parsed.agentId,
    source: parsed.source,
    accountId: parsed.accountId,
    peerKind: parsed.peerKind,
    peerId: parsed.peerId,
    scopeId: parsed.scopeId,
  });
}

export { defaultMainSessionKey };
