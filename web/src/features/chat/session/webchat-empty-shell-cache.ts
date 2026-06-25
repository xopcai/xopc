import type { SessionInfo } from '@/features/chat/chat.types';

const TTL_MS = 30_000;

type CacheSnapshot = {
  sessions: SessionInfo[];
  fetchedAt: number;
};

let snapshot: CacheSnapshot | null = null;

/** Called after each successful webchat session list fetch. */
export function upsertWebchatEmptyShellCache(sessions: SessionInfo[]): void {
  snapshot = { sessions: [...sessions], fetchedAt: Date.now() };
}

/** Track a freshly created empty shell before the next list fetch. */
export function addWebchatEmptyShellToCache(session: SessionInfo): void {
  const key = session.key.trim();
  if (!key) return;
  const now = new Date().toISOString();
  const row: SessionInfo = {
    ...session,
    key,
    messageCount: session.messageCount ?? 0,
    updatedAt: session.updatedAt ?? now,
  };
  const rest = (snapshot?.sessions ?? []).filter((s) => s.key.trim() !== key);
  snapshot = { sessions: [row, ...rest], fetchedAt: Date.now() };
}

export function readWebchatEmptyShellCache(): SessionInfo[] | null {
  if (!snapshot) return null;
  if (Date.now() - snapshot.fetchedAt > TTL_MS) {
    snapshot = null;
    return null;
  }
  return snapshot.sessions;
}

export function invalidateWebchatEmptyShellCache(): void {
  snapshot = null;
}

/** Test-only reset. */
export function resetWebchatEmptyShellCacheForTests(): void {
  snapshot = null;
}
