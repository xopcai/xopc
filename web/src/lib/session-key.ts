/**
 * Session key parsing for the gateway console.
 *
 * Canonical format: `agent:{agentId}:{rest}`
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

type ParsedAgentSessionKey = { agentId: string; rest: string };

function parseAgentSessionKey(sessionKey: string | undefined | null): ParsedAgentSessionKey | null {
  const raw = (sessionKey ?? '').trim().toLowerCase();
  if (!raw) return null;
  const parts = raw.split(':').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'agent') return null;
  const agentId = parts[1];
  const rest = parts.slice(2).join(':');
  if (!agentId || !rest) return null;
  return { agentId, rest };
}

function parseThreadSuffix(raw: string): { baseSessionKey: string; threadId?: string } {
  const lower = raw.toLowerCase();
  const idx = lower.lastIndexOf(':thread:');
  if (idx === -1) return { baseSessionKey: raw };
  return {
    baseSessionKey: raw.slice(0, idx),
    threadId: raw.slice(idx + ':thread:'.length),
  };
}

export function parseSessionKey(sessionKey: string | undefined | null): ParsedSessionKey | null {
  const raw = (sessionKey ?? '').trim();
  if (!raw) return null;

  const { baseSessionKey, threadId } = parseThreadSuffix(raw);
  const agentParsed = parseAgentSessionKey(baseSessionKey);
  if (!agentParsed) return null;

  const rest = agentParsed.rest;
  if (rest === 'main') {
    return {
      agentId: agentParsed.agentId,
      source: 'cli',
      accountId: 'default',
      peerKind: 'direct',
      peerId: 'main',
      threadId,
    };
  }

  const parts = rest.split(':').filter(Boolean);

  if (parts.length >= 4 && parts[2] === 'direct') {
    return {
      agentId: agentParsed.agentId,
      source: parts[0]!,
      accountId: parts[1]!,
      peerKind: 'direct',
      peerId: parts.slice(3).join(':'),
      threadId,
    };
  }

  if (parts.length >= 3 && parts[1] === 'direct') {
    return {
      agentId: agentParsed.agentId,
      source: parts[0]!,
      accountId: 'default',
      peerKind: 'direct',
      peerId: parts.slice(2).join(':'),
      threadId,
    };
  }

  if (parts.length >= 2 && parts[0] === 'direct') {
    return {
      agentId: agentParsed.agentId,
      source: 'cli',
      accountId: 'default',
      peerKind: 'direct',
      peerId: parts.slice(1).join(':'),
      threadId,
    };
  }

  if (parts.length >= 3 && (parts[1] === 'group' || parts[1] === 'channel')) {
    return {
      agentId: agentParsed.agentId,
      source: parts[0]!,
      accountId: 'default',
      peerKind: parts[1]!,
      peerId: parts.slice(2).join(':'),
      threadId,
    };
  }

  return {
    agentId: agentParsed.agentId,
    source: 'cli',
    accountId: 'default',
    peerKind: 'direct',
    peerId: rest,
    threadId,
  };
}

export function resolveAgentIdFromSessionKey(sessionKey: string | undefined | null): string {
  return parseAgentSessionKey(sessionKey)?.agentId ?? 'main';
}

export function buildAgentMainSessionKey(agentId: string, mainKey = 'main'): string {
  return `agent:${agentId}:${mainKey}`;
}

export function defaultMainSessionKey(agentId = 'main', mainKey = 'main'): string {
  return buildAgentMainSessionKey(agentId, mainKey);
}
