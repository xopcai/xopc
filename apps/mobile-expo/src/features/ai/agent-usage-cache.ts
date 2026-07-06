import { storage } from '../../storage/mmkv';
import type { ChatAgentOption } from '../../query/agents';

export type AgentUsageStat = {
  count: number;
  lastUsedAt: number;
  firstUsedAt: number;
};

export type AgentUsageMap = Record<string, AgentUsageStat>;

const STORAGE_PREFIX = 'agents.recentUsage:';
const MAX_RECENT_AGENTS = 50;
const MEDIUM_USAGE_COUNT = 3;
const HIGH_USAGE_COUNT = 8;

function storageKey(gatewayId: string | null | undefined): string {
  return `${STORAGE_PREFIX}${gatewayId?.trim() || 'default'}`;
}

function normalizeUsageStat(value: unknown): AgentUsageStat | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const count = typeof raw.count === 'number' && Number.isFinite(raw.count) ? raw.count : 0;
  const lastUsedAt = typeof raw.lastUsedAt === 'number' && Number.isFinite(raw.lastUsedAt)
    ? raw.lastUsedAt
    : 0;
  const firstUsedAt = typeof raw.firstUsedAt === 'number' && Number.isFinite(raw.firstUsedAt)
    ? raw.firstUsedAt
    : lastUsedAt;
  if (count <= 0 || lastUsedAt <= 0) return null;
  return {
    count: Math.floor(count),
    lastUsedAt,
    firstUsedAt: firstUsedAt > 0 ? firstUsedAt : lastUsedAt,
  };
}

export function parseAgentUsage(raw: string | undefined): AgentUsageMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const entries = Object.entries(parsed as Record<string, unknown>).flatMap(([id, value]) => {
      const normalizedId = id.trim().toLowerCase();
      const stat = normalizeUsageStat(value);
      if (!normalizedId || !stat) return [];
      return [[normalizedId, stat] as const];
    });
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function pruneUsage(usage: AgentUsageMap): AgentUsageMap {
  return Object.fromEntries(
    Object.entries(usage)
      .sort((a, b) => b[1].lastUsedAt - a[1].lastUsedAt)
      .slice(0, MAX_RECENT_AGENTS),
  );
}

export function readAgentUsage(gatewayId: string | null | undefined): AgentUsageMap {
  return parseAgentUsage(storage.getString(storageKey(gatewayId)));
}

export function touchAgentUsage(
  gatewayId: string | null | undefined,
  agentId: string,
): AgentUsageMap {
  const id = agentId.trim().toLowerCase();
  if (!id) return readAgentUsage(gatewayId);
  const now = Date.now();
  const current = readAgentUsage(gatewayId);
  const previous = current[id];
  const next = pruneUsage({
    ...current,
    [id]: {
      count: (previous?.count ?? 0) + 1,
      firstUsedAt: previous?.firstUsedAt ?? now,
      lastUsedAt: now,
    },
  });
  storage.set(storageKey(gatewayId), JSON.stringify(next));
  return next;
}

function usageBucket(stat: AgentUsageStat | undefined): number {
  if (!stat) return 0;
  if (stat.count >= HIGH_USAGE_COUNT) return 2;
  if (stat.count >= MEDIUM_USAGE_COUNT) return 1;
  return 0;
}

export function sortHomeAgents(
  agents: ChatAgentOption[],
  usage: AgentUsageMap,
  defaultAgentId: string | null | undefined,
): ChatAgentOption[] {
  const normalizedDefaultId = defaultAgentId?.trim().toLowerCase();
  return agents
    .map((agent, index) => ({
      agent,
      index,
      bucket: usageBucket(usage[agent.id.trim().toLowerCase()]),
      isDefault: agent.id.trim().toLowerCase() === normalizedDefaultId || agent.isDefault === true,
    }))
    .sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      if (a.bucket !== b.bucket) return b.bucket - a.bucket;
      return a.index - b.index;
    })
    .map((item) => item.agent);
}
