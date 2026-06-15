import { parseSessionKey as parseRoutingSessionKey } from '../../routing/session-key.js';
import { SessionStatus, type SessionMetadata } from '../../session/types.js';

export function resolveAgentIdFromSessionKey(sessionKey: string): string {
  const parsed = parseRoutingSessionKey(sessionKey);
  return parsed?.agentId?.toLowerCase() || 'main';
}

export function parseSessionKeySource(key: string): { channel: string; chatId: string } {
  const parts = key.split(':');
  if (parts.length >= 2 && parts[0] === 'heartbeat') {
    return { channel: 'heartbeat', chatId: parts.slice(1).join(':') };
  }
  const parsed = parseRoutingSessionKey(key);
  if (parsed) {
    if (parsed.source === 'cron') {
      return { channel: 'cron', chatId: parsed.peerId };
    }
    return {
      channel: parsed.source,
      chatId: [parsed.accountId, parsed.peerKind, parsed.peerId].join(':'),
    };
  }
  return { channel: 'unknown', chatId: key };
}

export function extractRoutingFromSessionKey(key: string): SessionMetadata['routing'] {
  const parsed = parseRoutingSessionKey(key);
  if (!parsed) {
    return undefined;
  }
  return {
    agentId: parsed.agentId?.toLowerCase() || 'main',
    source: parsed.source?.toLowerCase() || 'unknown',
    accountId: parsed.accountId?.toLowerCase() || 'default',
    peerKind: parsed.peerKind?.toLowerCase() || 'dm',
    peerId: parsed.peerId?.toLowerCase() || 'unknown',
    threadId: parsed.threadId,
    scopeId: parsed.scopeId,
  };
}

export function buildDefaultSessionMetadata(sessionKey: string): SessionMetadata {
  const { channel, chatId } = parseSessionKeySource(sessionKey);
  const routing = extractRoutingFromSessionKey(sessionKey);
  const isCronSession = channel === 'cron';
  const isHeartbeatSession = channel === 'heartbeat';
  const now = new Date().toISOString();
  return {
    key: sessionKey,
    status: SessionStatus.ACTIVE,
    tags: [],
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    messageCount: 0,
    estimatedTokens: 0,
    compactedCount: 0,
    sourceChannel: channel,
    sourceChatId: chatId,
    routing,
    ...(isCronSession ? { sessionType: 'cron', customData: { cronJobId: chatId } } : {}),
    ...(isHeartbeatSession ? { sessionType: 'heartbeat', customData: { heartbeatTarget: chatId } } : {}),
    stats: { messageCount: 0, tokenCount: 0 },
  };
}
