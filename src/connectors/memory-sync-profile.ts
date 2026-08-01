import type { Config } from '../config/schema.js';
import { scopeForComposioAction } from './composio.js';
import { COMPOSIO_MEMORY_SOURCE_TOOLKITS } from './connector-memory-sync.js';
import { getConnectorDefinition } from './catalog.js';

const SENSITIVE_ARGUMENT_KEY = /(?:api[-_]?key|authorization|cookie|password|secret|token)/i;

export type ComposioMemorySyncProfile = {
  enabled: boolean;
  actionId: string;
  arguments: Record<string, unknown>;
  agentId: string;
  connectionId?: string;
  intervalMinutes: number;
  triggerSync: boolean;
  updatedAt: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function assertNoPersistedSecrets(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error('Memory sync arguments are nested too deeply.');
  if (Array.isArray(value)) {
    for (const item of value) assertNoPersistedSecrets(item, depth + 1);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, nested] of Object.entries(record)) {
    if (SENSITIVE_ARGUMENT_KEY.test(key)) {
      throw new Error(`Memory sync arguments cannot persist sensitive field "${key}".`);
    }
    assertNoPersistedSecrets(nested, depth + 1);
  }
}

function markerFor(config: Config, connectorId: string): Record<string, unknown> | undefined {
  return asRecord(config.connectors?.instances?.[connectorId]?.xopcConnector);
}

export function getComposioMemorySyncProfile(
  config: Config,
  connectorId: string,
): ComposioMemorySyncProfile | undefined {
  const marker = markerFor(config, connectorId);
  const raw = asRecord(asRecord(marker?.config)?.memorySync);
  if (!raw) return undefined;
  const actionId = typeof raw.actionId === 'string' ? raw.actionId.trim() : '';
  const agentId = typeof raw.agentId === 'string' ? raw.agentId.trim() : '';
  if (!actionId || !agentId) return undefined;
  const interval = Number(raw.intervalMinutes);
  return {
    enabled: raw.enabled === true,
    actionId,
    arguments: asRecord(raw.arguments) ?? {},
    agentId,
    connectionId: typeof raw.connectionId === 'string' && raw.connectionId.trim() ? raw.connectionId.trim() : undefined,
    intervalMinutes: Number.isFinite(interval) ? Math.max(5, Math.min(interval, 24 * 60)) : 15,
    triggerSync: raw.triggerSync !== false,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
  };
}

export function updateComposioMemorySyncProfile(
  config: Config,
  connectorId: string,
  input: Omit<ComposioMemorySyncProfile, 'updatedAt'>,
): ComposioMemorySyncProfile {
  const definition = getConnectorDefinition(connectorId);
  if (definition?.runtime.type !== 'composio' || definition.runtime.role !== 'toolkit') {
    throw new Error('Memory sync profiles require an installed Composio toolkit connector.');
  }
  const toolkit = definition.runtime.toolkit;
  if (!COMPOSIO_MEMORY_SOURCE_TOOLKITS.has(toolkit)) {
    throw new Error(`Memory sync is not supported for the ${toolkit} connector.`);
  }
  const marker = markerFor(config, connectorId);
  if (!marker || marker.managed !== true || marker.enabled === false) {
    throw new Error(`Connector is not installed and enabled: ${connectorId}`);
  }
  const actionId = input.actionId.trim();
  const agentId = input.agentId.trim();
  const risk = scopeForComposioAction(actionId);
  if (!actionId || risk.toolkit !== toolkit || risk.scope !== 'read' || !risk.curated) {
    throw new Error('Memory sync profiles require a curated read-only action from the same toolkit.');
  }
  if (!agentId) throw new Error('Memory sync profile requires an agentId.');
  assertNoPersistedSecrets(input.arguments);
  const profile: ComposioMemorySyncProfile = {
    enabled: input.enabled,
    actionId,
    arguments: structuredClone(input.arguments),
    agentId,
    connectionId: input.connectionId?.trim() || undefined,
    intervalMinutes: Math.max(5, Math.min(Number(input.intervalMinutes) || 15, 24 * 60)),
    triggerSync: input.triggerSync,
    updatedAt: new Date().toISOString(),
  };
  const configRecord = asRecord(marker.config) ?? {};
  marker.config = { ...configRecord, memorySync: profile };
  return profile;
}
