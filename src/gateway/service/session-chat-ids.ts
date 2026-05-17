import type { SessionIndex } from '../../session/index.js';

export async function getDistinctSessionChatIds(
  sessionIndex: SessionIndex,
  channel?: string,
): Promise<
  Array<{
    channel: string;
    chatId: string;
    lastActive: string;
    accountId?: string;
    peerKind?: string;
    peerId?: string;
  }>
> {
  const result = await sessionIndex.listSessions({
    limit: 1000,
    sortBy: 'lastAccessedAt',
    sortOrder: 'desc',
    ...(channel ? { channel } : {}),
  });

  const seen = new Set<string>();
  const chatIds: Array<{
    channel: string;
    chatId: string;
    lastActive: string;
    accountId?: string;
    peerKind?: string;
    peerId?: string;
  }> = [];

  for (const session of result.items) {
    const key = `${session.sourceChannel}:${session.sourceChatId}`;
    if (!seen.has(key) && session.sourceChannel && session.sourceChatId) {
      seen.add(key);
      const r = session.routing;
      chatIds.push({
        channel: session.sourceChannel,
        chatId: session.sourceChatId,
        lastActive: session.lastAccessedAt,
        ...(r
          ? {
              accountId: r.accountId,
              peerKind: r.peerKind,
              peerId: r.peerId,
            }
          : {}),
      });
    }
  }

  return chatIds;
}
