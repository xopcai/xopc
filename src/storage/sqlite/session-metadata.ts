import { SessionStatus, type SessionMetadata } from '../../session/types.js';

export type SessionMetadataSeed = Partial<Omit<SessionMetadata, 'key' | 'transcriptId'>>;

export function buildDefaultSessionMetadata(
  conversationId: string,
  seed: SessionMetadataSeed = {},
): SessionMetadata {
  const now = new Date().toISOString();
  return {
    ...seed,
    key: conversationId,
    agentId: seed.agentId ?? seed.routing?.agentId ?? '',
    status: seed.status ?? SessionStatus.ACTIVE,
    tags: seed.tags ?? [],
    createdAt: seed.createdAt ?? now,
    updatedAt: seed.updatedAt ?? now,
    lastAccessedAt: seed.lastAccessedAt ?? now,
    messageCount: seed.messageCount ?? 0,
    estimatedTokens: seed.estimatedTokens ?? 0,
    compactedCount: seed.compactedCount ?? 0,
    flushCount: seed.flushCount ?? 0,
    sourceChannel: seed.sourceChannel ?? '',
    sourceChatId: seed.sourceChatId ?? '',
    sessionType: seed.sessionType ?? 'chat',
    routing: seed.routing,
    customData: seed.customData,
    stats: seed.stats ?? { messageCount: 0, tokenCount: 0 },
  };
}
