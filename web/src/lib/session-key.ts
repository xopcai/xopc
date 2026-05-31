/**
 * Session key parsing — aligned with gateway `src/routing/session-key.ts`.
 *
 * Format: `{agentId}:{source}:{accountId}:{peerKind}:{peerId}[:thread:{threadId}][:scope:{scopeId}]`
 * Alternate: `gateway:{agentId}:{source}:{accountId}:{peerKind}:{peerId}…`
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

  if (parts.length >= 6 && parts[0]?.toLowerCase() === 'gateway') {
    const agentId = parts[1] ?? '';
    const source = parts[2] ?? '';
    const accountId = parts[3] ?? '';
    const peerKind = parts[4] ?? '';
    const peerId = parts[5] ?? '';
    const rest = parts.slice(6);
    const result: ParsedSessionKey = {
      agentId: agentId.toLowerCase(),
      source: source.toLowerCase(),
      accountId: accountId.toLowerCase(),
      peerKind: peerKind.toLowerCase(),
      peerId: peerId.toLowerCase(),
    };
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
