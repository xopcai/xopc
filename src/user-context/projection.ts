import type { MemoryKind, MemoryRecord } from '../agent/memory/types.js';
import { effectiveMemoryStatus, resolveMemoryStability } from '../agent/memory/lifecycle.js';
import { classifyMemoryContextOrigin } from '../agent/memory/source-origin.js';
import type { ConnectorDefinition, ConnectorInstance } from '../connectors/types.js';
import type { KnowledgeSourceItem, KnowledgeSyncRun } from '../knowledge/types.js';

export type UserContextFacet =
  | 'basics'
  | 'collaboration'
  | 'boundaries'
  | 'priorities'
  | 'people'
  | 'current';

export type UserContextOrigin = 'told_by_you' | 'observed' | 'inferred' | 'connected_source';

const ALWAYS_PERSONAL_KINDS = new Set<MemoryKind>([
  'user_profile',
  'preference',
  'boundary',
  'relationship',
  'commitment',
  'routine',
  'personal_logistics',
  'current_state',
  'tool_preference',
  'long_term_goal',
]);

const CONTEXTUAL_USER_KINDS = new Set<MemoryKind>([
  'project_context',
  'open_question',
  'milestone',
  'derived_insight',
  'task_lesson',
]);

export function isUserContextRecord(record: MemoryRecord): boolean {
  if (ALWAYS_PERSONAL_KINDS.has(record.kind)) return true;
  return CONTEXTUAL_USER_KINDS.has(record.kind) && record.tags?.includes('user-understanding') === true;
}

export function isUserContextMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === 'string'
    && (ALWAYS_PERSONAL_KINDS.has(value as MemoryKind) || CONTEXTUAL_USER_KINDS.has(value as MemoryKind));
}

export function facetForMemoryKind(kind: MemoryKind): UserContextFacet {
  if (kind === 'user_profile' || kind === 'personal_logistics') return 'basics';
  if (kind === 'preference' || kind === 'routine' || kind === 'tool_preference' || kind === 'task_lesson') {
    return 'collaboration';
  }
  if (kind === 'boundary') return 'boundaries';
  if (kind === 'relationship') return 'people';
  if (kind === 'current_state' || kind === 'open_question') return 'current';
  return 'priorities';
}

export function originForMemoryRecord(record: MemoryRecord): UserContextOrigin {
  const origin = classifyMemoryContextOrigin(record);
  return origin === 'told_by_user' ? 'told_by_you' : origin;
}

export function projectUserContextRecord(record: MemoryRecord) {
  const lifecycle = resolveMemoryStability(record);
  const latestEvidenceAt = record.evidence
    ?.map((evidence) => evidence.observedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  return {
    id: record.id,
    statement: record.content,
    facet: facetForMemoryKind(record.kind),
    kind: record.kind,
    status: effectiveMemoryStatus(record),
    origin: originForMemoryRecord(record),
    sourceName: record.source.provider ?? 'local',
    updatedAt: record.updatedAt,
    sensitivity: record.sensitivity ?? 'normal',
    explicitness: record.explicitness,
    durability: record.durability,
    canReference: record.disclosurePolicy !== 'silent',
    stability: lifecycle.band,
    stabilityScore: lifecycle.score,
    reviewAt: lifecycle.reviewAt,
    reviewDue: lifecycle.reviewDue,
    evidenceCount: record.evidence?.length ?? 0,
    sourcePath: record.source.path,
    latestEvidenceAt,
  };
}

export function isPersonalContextConnector(definition: ConnectorDefinition): boolean {
  return definition.capabilities.includes('context') || definition.capabilities.includes('memory_source');
}

export function recordsDerivedFromPersonalContextSource(
  records: MemoryRecord[],
  agentId: string,
  connectorId: string,
): MemoryRecord[] {
  return records.filter((record) => (
    record.scope.agentId === agentId
    && record.source.provider === connectorId
    && isUserContextRecord(record)
  ));
}

export function projectPersonalContextSources(
  definitions: ConnectorDefinition[],
  instances: ConnectorInstance[],
  records: MemoryRecord[] = [],
  knowledge: { sourceItems?: KnowledgeSourceItem[]; syncRuns?: KnowledgeSyncRun[] } = {},
) {
  const instanceByConnector = new Map<string, ConnectorInstance[]>();
  for (const instance of instances) {
    const current = instanceByConnector.get(instance.connectorId) ?? [];
    current.push(instance);
    instanceByConnector.set(instance.connectorId, current);
  }
  return definitions
    .filter(isPersonalContextConnector)
    .map((definition) => {
      const connected = instanceByConnector.get(definition.id) ?? [];
      const relatedRecords = records.filter((record) => record.source.provider === definition.id);
      const sourceItems = (knowledge.sourceItems ?? []).filter((item) => item.metadata.connectorId === definition.id);
      const sourceInstanceIds = new Set(sourceItems.map((item) => item.sourceInstanceId));
      const latestSync = (knowledge.syncRuns ?? [])
        .filter((run) => (
          sourceInstanceIds.has(run.sourceInstanceId)
          || run.sourceInstanceId.startsWith(`composio:${definition.id}:`)
          || run.sourceInstanceId.startsWith(`${definition.id}:`)
        ))
        .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0];
      const latestHealth = connected
        .filter((instance) => instance.usage.lastHealthCheckAt && instance.usage.lastHealthStatus)
        .sort((left, right) => (
          Date.parse(right.usage.lastHealthCheckAt!) - Date.parse(left.usage.lastHealthCheckAt!)
        ))[0]?.usage;
      const permissionDetails = definition.permissions?.data ?? [];
      const canWrite = permissionDetails.some((permission) => (
        /(?:^|[.:/_-])(write|create|update|delete|manage|send|admin)(?:$|[.:/_-])/i.test(permission)
      ));
      return {
        id: definition.id,
        displayName: definition.displayName,
        description: definition.description,
        category: definition.category,
        capabilities: definition.capabilities.filter((capability) => (
          capability === 'context' || capability === 'memory_source' || capability === 'tools' || capability === 'events'
        )),
        access: {
          context: definition.capabilities.includes('context'),
          memory: definition.capabilities.includes('memory_source'),
          read: definition.capabilities.includes('context')
            || definition.capabilities.includes('resources')
            || definition.capabilities.includes('tools'),
          write: canWrite,
        },
        permissionDetails,
        installed: connected.length > 0,
        enabled: connected.some((instance) => instance.enabled),
        status: connected[0]?.status ?? 'not_installed',
        instanceId: connected[0]?.instanceId,
        lastConnectedAt: connected
          .map((instance) => instance.lastConnectedAt)
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1),
        lastHealthCheckAt: latestHealth?.lastHealthCheckAt,
        lastHealthStatus: latestHealth?.lastHealthStatus,
        lastActivityAt: [
          ...connected.flatMap((instance) => [
            instance.lastConnectedAt,
            instance.usage.lastHealthCheckAt,
            ...instance.audit.map((entry) => entry.at),
          ]),
          latestSync?.finishedAt,
          latestSync?.startedAt,
        ]
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1),
        derivedUnderstandingCount: relatedRecords.length,
        knowledgeItemCount: sourceItems.filter((item) => !item.deletedAt).length,
        lastSyncAt: latestSync?.finishedAt ?? latestSync?.startedAt,
        lastSyncStatus: latestSync?.status,
        lastSyncError: latestSync?.error,
      };
    })
    .sort((left, right) => {
      if (left.installed !== right.installed) return left.installed ? -1 : 1;
      return left.displayName.localeCompare(right.displayName);
    });
}
