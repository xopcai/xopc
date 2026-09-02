import {
  newSessionCacheKey,
  type ResolvedNewSessionSpec,
  type SessionInitialAgentConfig,
} from '@xopcai/gateway-contract';

import { createSession } from '../../query/sessions';
import { setSessionInitialAgentConfig } from '../../query/models';
import { useGatewayStore } from '../../stores/gateway-store';

const TTL_MS = 5 * 60_000;

type PrefetchedEntry = {
  sessionKey: string;
  expiresAt: number;
};

const cache = new Map<string, PrefetchedEntry>();
const pendingCreates = new Map<string, Promise<string>>();

function cacheKeyOf(spec: Pick<ResolvedNewSessionSpec, 'agentId' | 'projectId'>): string {
  return newSessionCacheKey(useGatewayStore.getState().activeGatewayId ?? 'default', spec);
}

function dropExpired(now: number): void {
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
}

async function createServerSession(
  spec: Pick<ResolvedNewSessionSpec, 'agentId' | 'projectId'>,
  initialAgentConfig?: SessionInitialAgentConfig,
): Promise<string> {
  return createSession({
    agentId: spec.agentId,
    ...(spec.projectId ? { projectId: spec.projectId } : {}),
    ...(initialAgentConfig ? { initialAgentConfig } : {}),
  });
}

function startCreate(
  spec: Pick<ResolvedNewSessionSpec, 'agentId' | 'projectId'>,
  initialAgentConfig?: SessionInitialAgentConfig,
): Promise<string> {
  const key = cacheKeyOf(spec);
  const existing = pendingCreates.get(key);
  if (existing) return existing;

  const promise = createServerSession(spec, initialAgentConfig).then((sessionKey) => {
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

export function prefetchNewChatSession(
  spec: Pick<ResolvedNewSessionSpec, 'agentId' | 'projectId'>,
): void {
  const now = Date.now();
  dropExpired(now);
  const key = cacheKeyOf(spec);
  if (cache.has(key) || pendingCreates.has(key)) return;
  void startCreate(spec).catch(() => {});
}

export async function takeNewChatSessionKey(
  spec: Pick<ResolvedNewSessionSpec, 'agentId' | 'projectId'>,
  initialAgentConfig?: SessionInitialAgentConfig,
): Promise<string> {
  const now = Date.now();
  dropExpired(now);
  const key = cacheKeyOf(spec);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    if (initialAgentConfig) await setSessionInitialAgentConfig(cached.sessionKey, initialAgentConfig);
    return cached.sessionKey;
  }
  const sessionKey = await startCreate(spec, initialAgentConfig);
  cache.delete(key);
  return sessionKey;
}

export function resetSessionPrefetchCacheForTests(): void {
  cache.clear();
  pendingCreates.clear();
}
