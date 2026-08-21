import type { MemoryKind, MemoryRecord } from '../agent/memory/types.js';
import { effectiveMemoryStatus, resolveMemoryStability } from '../agent/memory/lifecycle.js';
import { classifyMemoryContextOrigin } from '../agent/memory/source-origin.js';
import type { ConnectorConnection, ConnectorDefinition, ConnectorInstance } from '../connectors/types.js';
import type { KnowledgeSourceItem, KnowledgeSyncRun } from '../knowledge/types.js';
import type { ConnectorLearningJob } from '../storage/sqlite/index.js';

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

export const USER_CONTEXT_MEMORY_KINDS: readonly MemoryKind[] = [
  ...ALWAYS_PERSONAL_KINDS,
  ...CONTEXTUAL_USER_KINDS,
];

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

function connectedEvidenceBasis(sourceText: string | undefined) {
  if (!sourceText) return undefined;
  try {
    const value = JSON.parse(sourceText) as Record<string, unknown>;
    const eventCount = Number(value.eventCount);
    const activeDays = Number(value.activeDays);
    const windowDays = Number(value.windowDays);
    if (![eventCount, activeDays, windowDays].every((item) => Number.isInteger(item) && item > 0)) return undefined;
    return { eventCount, activeDays, windowDays };
  } catch {
    return undefined;
  }
}

export function projectUserContextRecord(record: MemoryRecord) {
  const lifecycle = resolveMemoryStability(record);
  const latestEvidenceAt = record.evidence
    ?.map((evidence) => evidence.observedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const evidenceBasis = record.evidence
    ?.map((evidence) => connectedEvidenceBasis(evidence.sourceText))
    .filter((value): value is NonNullable<ReturnType<typeof connectedEvidenceBasis>> => Boolean(value))
    .at(-1);
  return {
    id: record.id,
    statement: record.content,
    facet: facetForMemoryKind(record.kind),
    kind: record.kind,
    status: effectiveMemoryStatus(record),
    origin: originForMemoryRecord(record),
    sourceName: record.source.provider ?? 'local',
    scope: record.scope.sessionKey
      ? { type: 'session' as const, id: record.scope.sessionKey }
      : record.scope.projectId
        ? { type: 'project' as const, id: record.scope.projectId }
        : record.scope.workspaceId
          ? { type: 'workspace' as const, id: record.scope.workspaceId }
          : { type: 'global' as const },
    updatedAt: record.updatedAt,
    sensitivity: record.sensitivity ?? 'normal',
    explicitness: record.explicitness,
    durability: record.durability,
    disclosurePolicy: record.disclosurePolicy,
    stability: lifecycle.band,
    stabilityScore: lifecycle.score,
    confidence: record.confidence,
    reviewAt: lifecycle.reviewAt,
    reviewDue: lifecycle.reviewDue,
    evidenceCount: record.evidence?.length ?? 0,
    evidenceBasis,
    sourcePath: record.source.path,
    latestEvidenceAt,
    validFrom: record.validFrom,
    validTo: record.validTo,
    expiresAt: record.expiresAt,
  };
}

export function isPersonalContextConnector(definition: ConnectorDefinition): boolean {
  return definition.capabilities.includes('context') || definition.capabilities.includes('memory_source');
}

export function recordsDerivedFromPersonalContextSource(
  records: MemoryRecord[],
  sourceInstanceId: string,
): MemoryRecord[] {
  return records.filter((record) => (
    record.source.sourceInstanceId === sourceInstanceId
    && isUserContextRecord(record)
  ));
}

function connectionIdentityKey(connection: ConnectorConnection): string {
  if (connection.accountId) return `account:${connection.accountId}`;
  const email = typeof connection.identity.email === 'string'
    ? connection.identity.email.trim().toLocaleLowerCase()
    : '';
  if (email) return `email:${email}`;
  const username = typeof connection.identity.username === 'string'
    ? connection.identity.username.trim().toLocaleLowerCase()
    : '';
  if (username) return `username:${username}`;
  return `connection:${connection.id}`;
}

function selectAccountConnections(connections: ConnectorConnection[]): ConnectorConnection[] {
  const byIdentity = new Map<string, ConnectorConnection>();
  for (const connection of connections) {
    const key = connectionIdentityKey(connection);
    const current = byIdentity.get(key);
    if (!current) {
      byIdentity.set(key, connection);
      continue;
    }
    const currentRank = current.status === 'active' ? 1 : 0;
    const candidateRank = connection.status === 'active' ? 1 : 0;
    if (candidateRank > currentRank || (
      candidateRank === currentRank
      && connection.updatedAt.localeCompare(current.updatedAt) > 0
    )) {
      byIdentity.set(key, connection);
    }
  }
  return [...byIdentity.values()];
}

export function projectPersonalContextSources(
  definitions: ConnectorDefinition[],
  instances: ConnectorInstance[],
  knowledge: {
    sourceItems?: KnowledgeSourceItem[];
    syncRuns?: KnowledgeSyncRun[];
    connections?: ConnectorConnection[];
    learningJobs?: ConnectorLearningJob[];
    claimStatsBySource?: Record<string, {
      evidenceCount: number;
      provisionalClaims: number;
      activeClaims: number;
      resolvedEntities: number;
      lastEvidenceAt?: string;
    }>;
  } = {},
) {
  const instanceByConnector = new Map<string, ConnectorInstance[]>();
  for (const instance of instances) {
    const current = instanceByConnector.get(instance.connectorId) ?? [];
    current.push(instance);
    instanceByConnector.set(instance.connectorId, current);
  }
  return definitions
    .filter(isPersonalContextConnector)
    .flatMap((definition) => {
      const connected = instanceByConnector.get(definition.id) ?? [];
      const candidateAccounts = (knowledge.connections ?? [])
        .filter((connection) => (
          connection.provider === 'composio'
          && connection.connectorId === definition.id
          && connection.status !== 'revoked'
        ));
      const hasActiveAccount = candidateAccounts.some((connection) => connection.status === 'active');
      const accounts = selectAccountConnections(
        candidateAccounts.filter((connection) => (
          !hasActiveAccount || !['pending', 'unknown', 'disabled'].includes(connection.status)
        )),
      )
        .sort((left, right) => {
          const byConnectedAt = (left.connectedAt ?? left.createdAt).localeCompare(right.connectedAt ?? right.createdAt);
          return byConnectedAt || left.id.localeCompare(right.id);
        });
      const rows = accounts.length > 0
        ? accounts.map((connection, index) => ({
            instanceId: connection.accountId,
            sourceInstanceId: connection.accountId
              ? `composio:${definition.id}:${connection.accountId}`
              : undefined,
            accountLabel: connection.alias
              ?? (typeof connection.identity.email === 'string' ? connection.identity.email : undefined)
              ?? (typeof connection.identity.username === 'string' ? connection.identity.username : undefined),
            accountOrdinal: index + 1,
            accountCount: accounts.length,
            enabled: connection.status === 'active',
            status: connection.status,
            lastConnectedAt: connection.connectedAt,
            instances: connected,
          }))
        : connected.length > 0
          ? connected.map((instance) => ({
              instanceId: instance.instanceId,
              sourceInstanceId: instance.instanceId,
              accountLabel: undefined,
              accountOrdinal: undefined,
              accountCount: undefined,
              enabled: instance.enabled,
              status: instance.status,
              lastConnectedAt: instance.lastConnectedAt,
              instances: [instance],
            }))
          : [{
              instanceId: undefined,
              sourceInstanceId: undefined,
              accountLabel: undefined,
              accountOrdinal: undefined,
              accountCount: undefined,
              enabled: false,
              status: 'not_installed',
              lastConnectedAt: undefined,
              instances: [] as ConnectorInstance[],
            }];
      return rows.map((row) => {
      const sourceItems = row.sourceInstanceId
        ? (knowledge.sourceItems ?? []).filter((item) => item.sourceInstanceId === row.sourceInstanceId)
        : [];
      const claimStats = row.sourceInstanceId ? knowledge.claimStatsBySource?.[row.sourceInstanceId] : undefined;
      const latestSync = (knowledge.syncRuns ?? [])
        .filter((run) => run.sourceInstanceId === row.sourceInstanceId)
        .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0];
      const learningJobs = (knowledge.learningJobs ?? [])
        .filter((job) => job.sourceInstanceId === row.sourceInstanceId)
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
      const now = Date.now();
      const nextScheduledLearning = learningJobs
        .filter((job) => job.status === 'queued' && job.nextRunAt && Date.parse(job.nextRunAt) > now)
        .sort((left, right) => Date.parse(left.nextRunAt!) - Date.parse(right.nextRunAt!))[0];
      const latestLearning = learningJobs.find((job) => (
        job.status !== 'queued' || !job.nextRunAt || Date.parse(job.nextRunAt) <= now
      )) ?? learningJobs[0];
      const latestHealth = row.instances
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
        accountLabel: row.accountLabel,
        accountOrdinal: row.accountOrdinal,
        accountCount: row.accountCount,
        displayName: definition.displayName,
        description: definition.description,
        ...(definition.branding ? { branding: definition.branding } : {}),
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
        installed: row.instanceId !== undefined,
        enabled: row.enabled,
        status: row.status,
        instanceId: row.instanceId,
        lastConnectedAt: row.lastConnectedAt,
        lastHealthCheckAt: latestHealth?.lastHealthCheckAt,
        lastHealthStatus: latestHealth?.lastHealthStatus,
        lastActivityAt: [
          ...row.instances.flatMap((instance) => [
            instance.lastConnectedAt,
            instance.usage.lastHealthCheckAt,
            ...instance.audit.map((entry) => entry.at),
          ]),
          latestSync?.finishedAt,
          latestSync?.startedAt,
          latestLearning?.finishedAt,
          latestLearning?.startedAt,
        ]
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1),
        derivedUnderstandingCount: claimStats?.activeClaims ?? 0,
        learningFunnel: {
          indexedItems: sourceItems.filter((item) => !item.deletedAt).length,
          attributedItems: sourceItems.filter((item) => !item.deletedAt && item.metadata.actorAttributed === true).length,
          resolvedEntities: claimStats?.resolvedEntities ?? 0,
          provisionalClaims: claimStats?.provisionalClaims ?? 0,
          activeClaims: claimStats?.activeClaims ?? 0,
          evidenceCount: claimStats?.evidenceCount ?? 0,
          lastEvidenceAt: claimStats?.lastEvidenceAt,
        },
        knowledgeItemCount: sourceItems.filter((item) => !item.deletedAt).length,
        lastSyncAt: latestSync?.finishedAt ?? latestSync?.startedAt,
        lastSyncStatus: latestSync?.status,
        lastSyncError: latestSync?.error,
        learning: latestLearning ? {
          status: latestLearning.status,
          phase: latestLearning.phase,
          itemsDiscovered: latestLearning.itemsDiscovered,
          itemsIndexed: latestLearning.itemsIndexed,
          candidatesCreated: latestLearning.candidatesCreated,
          mode: latestLearning.mode,
          attemptCount: latestLearning.attemptCount,
          nextRunAt: nextScheduledLearning?.nextRunAt ?? latestLearning.nextRunAt,
          error: latestLearning.error,
          updatedAt: latestLearning.updatedAt,
        } : undefined,
      };
      });
    })
    .sort((left, right) => {
      if (left.installed !== right.installed) return left.installed ? -1 : 1;
      return left.displayName.localeCompare(right.displayName);
    });
}
