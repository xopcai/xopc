import { storage } from '../../storage/mmkv';

const PREFIX = 'chat.sessionSyncCursor:v1:';

export type SessionSyncCursor = {
  transcriptId?: string;
  revision: number;
};

function key(gatewayId: string | null, conversationId: string): string {
  return `${PREFIX}${encodeURIComponent(gatewayId ?? 'unassigned')}:${encodeURIComponent(conversationId)}`;
}

export function readSessionSyncCursor(gatewayId: string | null, conversationId: string): SessionSyncCursor | null {
  try {
    const value = JSON.parse(storage.getString(key(gatewayId, conversationId)) ?? 'null') as Partial<SessionSyncCursor> | null;
    if (!value || typeof value.revision !== 'number' || value.revision < 0) return null;
    return {
      revision: value.revision,
      ...(typeof value.transcriptId === 'string' ? { transcriptId: value.transcriptId } : {}),
    };
  } catch {
    return null;
  }
}

export function writeSessionSyncCursor(
  gatewayId: string | null,
  conversationId: string,
  cursor: SessionSyncCursor,
): void {
  const previous = readSessionSyncCursor(gatewayId, conversationId);
  if (previous && previous.transcriptId === cursor.transcriptId && previous.revision > cursor.revision) return;
  storage.set(key(gatewayId, conversationId), JSON.stringify(cursor));
}
