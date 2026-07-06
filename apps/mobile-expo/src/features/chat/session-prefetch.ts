import { createSession } from '../../query/sessions';
import { useGatewayStore } from '../../stores/gateway-store';

const TTL_MS = 5 * 60_000;

type PrefetchedEntry = {
  sessionKey: string;
  expiresAt: number;
};

const cache = new Map<string, PrefetchedEntry>();
const pendingCreates = new Map<string, Promise<string>>();

function cacheKeyOf(agentId: string | undefined): string {
  return (agentId ?? 'main').trim().toLowerCase() || 'main';
}

function dropExpired(now: number): void {
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
}

async function createServerSession(agentId: string | undefined): Promise<string> {
  await useGatewayStore.getState().refreshActiveBaseUrl();
  return createSession(agentId);
}

function startCreate(agentId: string | undefined): Promise<string> {
  const key = cacheKeyOf(agentId);
  const existing = pendingCreates.get(key);
  if (existing) return existing;

  const promise = createServerSession(agentId).then((sessionKey) => {
    cache.set(key, { sessionKey, expiresAt: Date.now() + TTL_MS });
    pendingCreates.delete(key);
    return sessionKey;
  });
  promise.catch(() => {
    pendingCreates.delete(key);
  });
  pendingCreates.set(key, promise);
  return promise;
}

export function prefetchNewChatSession(agentId?: string): void {
  const now = Date.now();
  dropExpired(now);
  const key = cacheKeyOf(agentId);
  if (cache.has(key) || pendingCreates.has(key)) return;
  void startCreate(agentId).catch(() => {});
}

export async function takeNewChatSessionKey(agentId?: string): Promise<string> {
  const now = Date.now();
  dropExpired(now);
  const key = cacheKeyOf(agentId);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    return cached.sessionKey;
  }
  const sessionKey = await startCreate(agentId);
  cache.delete(key);
  return sessionKey;
}

export function resetSessionPrefetchCacheForTests(): void {
  cache.clear();
  pendingCreates.clear();
}
