import { createHash } from 'node:crypto';

import type { Config } from '../config/schema.js';
import { getWorkspacePath } from '../config/workspace-path-helpers.js';
import { createLogger } from '../utils/logger.js';
import {
  getConnectorInstallation,
  listConnectorConnections,
} from '../storage/sqlite/index.js';
import {
  ConnectedKnowledgePipeline,
  KnowledgeIngestionService,
  LocalFolderKnowledgeSourceAdapter,
  type KnowledgePullInput,
  type KnowledgePullResult,
  type KnowledgeSourceAdapter,
  type KnowledgeSourceItemInput,
} from '../knowledge/index.js';
import { ComposioSessionsAdapter } from './composio-sessions.js';
import { scopeForComposioAction } from './composio.js';
import { getConnectorDefinition } from './catalog.js';
import { decodeConnectedSourceCursor, encodeConnectedSourceCursor } from './connected-source-cursor.js';
import { getConnectorInstance } from './instances.js';
import { normalizeConnectedSourceResult } from './connected-source-normalizers.js';
import { sanitizeConnectedSourceValue } from './connected-source-sanitization.js';

const log = createLogger('ConnectedSourceIngestion');

export const COMPOSIO_CONNECTED_SOURCE_TOOLKITS = new Set([
  'gmail',
  'googlecalendar',
  'googledrive',
  'github',
  'linear',
]);
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

type PersonEntitySignal = {
  role: string;
  name?: string;
  email?: string;
  username?: string;
};

function boundedPersonValue(value: unknown, maxLength = 320): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function personEntities(record: Record<string, unknown> | null): PersonEntitySignal[] {
  if (!record) return [];
  const extractPerson = (value: unknown, role: string): PersonEntitySignal[] => {
    if (typeof value === 'string') {
      const normalized = boundedPersonValue(value);
      if (!normalized) return [];
      return normalized.includes('@') ? [{ role, email: normalized }] : [{ role, name: normalized }];
    }
    const nested = asRecord(value);
    if (!nested) return [];
    const name = boundedPersonValue(nested.name, 160) || boundedPersonValue(nested.displayName, 160);
    const email = boundedPersonValue(nested.email) || boundedPersonValue(nested.emailAddress);
    const username = boundedPersonValue(nested.username, 160);
    return name || email || username
      ? [{ role, name: name || undefined, email: email || undefined, username: username || undefined }]
      : [];
  };
  const entities = ['email', 'from', 'sender', 'author', 'user', 'username', 'owner', 'owners', 'assignee', 'attendees', 'participants']
    .flatMap((key) => {
      const value = record[key];
      return Array.isArray(value)
        ? value.flatMap((item) => extractPerson(item, key))
        : extractPerson(value, key);
    });
  const unique = new Map<string, PersonEntitySignal>();
  for (const entity of entities) {
    const key = `${entity.role}\u0000${entity.email?.toLowerCase() ?? ''}\u0000${entity.username?.toLowerCase() ?? ''}\u0000${entity.name?.toLowerCase() ?? ''}`;
    unique.set(key, entity);
  }
  return [...unique.values()].slice(0, 50);
}

function peopleSignals(entities: PersonEntitySignal[]): string[] {
  const values = entities
    .flatMap((entity) => [entity.email, entity.name, entity.username])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(values)].slice(0, 50);
}

function connectionIdentities(identity: Record<string, unknown>): string[] {
  return [...new Set(Object.values(identity)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean))];
}

function resultPayload(value: unknown): Record<string, unknown> {
  const root = asRecord(value) ?? {};
  return asRecord(root.data) ?? root;
}

function paginationValue(result: unknown, ...keys: string[]): string | undefined {
  const payload = resultPayload(result);
  const pagination = asRecord(payload.pagination) ?? asRecord(payload.pageInfo) ?? {};
  for (const key of keys) {
    const value = payload[key] ?? pagination[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function isPayloadTooLargeError(error: unknown): boolean {
  const details = asRecord(error);
  const status = details?.status ?? details?.statusCode;
  const code = details?.code;
  const message = error instanceof Error ? error.message : String(error);
  return String(status) === '413'
    || String(code) === '4345'
    || /\b413\b|ToolRouterV2_PayloadTooLarge|payload is too large/i.test(message);
}

function maxResultsValue(args: Record<string, unknown>): number | undefined {
  const value = args.max_results;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function resultToSourceItems(input: {
  result: unknown;
  sourceInstanceId: string;
  collectionScope: string;
  streamKind: 'activity' | 'inventory';
  connectorId: string;
  connectionId: string;
  actionId: string;
  toolkit: string;
  agentId: string;
  workspaceId: string;
  connectionIdentity: Record<string, unknown>;
}): KnowledgeSourceItemInput[] {
  return normalizeConnectedSourceResult(input).slice(0, 200).map((entity) => {
    const record = entity.value;
    const people = personEntities(record);
    const ownerIdentities = connectionIdentities(input.connectionIdentity);
    const observedIdentities = peopleSignals(people).map((value) => value.toLowerCase());
    const actorAttributed = entity.metadata.actorAttributed === true
      || input.toolkit === 'gmail'
      || input.toolkit === 'googlecalendar'
      || (['github', 'googledrive'].includes(input.toolkit)
        && observedIdentities.some((value) => ownerIdentities.includes(value)));
    const serialized = JSON.stringify(sanitizeConnectedSourceValue(entity.value), null, 2);
    const normalizedText = serialized.length > 8_000 ? `${serialized.slice(0, 8_000)}\n…` : serialized;
    const contentHash = createHash('sha256').update(serialized).digest('hex');
    return {
      sourceInstanceId: input.sourceInstanceId,
      collectionScope: input.collectionScope,
      externalId: entity.externalId,
      itemType: entity.itemType,
      authorRole: 'third_party',
      occurredAt: entity.occurredAt,
      sourceUpdatedAt: entity.sourceUpdatedAt,
      contentHash,
      normalizedText,
      metadata: {
        connectorId: input.connectorId,
        connectionId: input.connectionId,
        actionId: input.actionId,
        toolkit: input.toolkit,
        people: peopleSignals(people),
        personEntities: people,
        agentId: input.agentId,
        workspaceId: input.workspaceId,
        ...entity.metadata,
        ownerIdentities,
        actorAttributed,
      },
      sensitivity: 'personal',
      retentionClass: 'bounded',
      synthesisPipeline: 'connected_knowledge',
      synthesisStatus: input.streamKind === 'inventory' ? 'ignored' : entity.synthesisStatus,
      deletedAt: entity.deletedAt,
    };
  });
}

class ComposioKnowledgeSourceAdapter implements KnowledgeSourceAdapter {
  readonly kind = 'composio';
  private adaptiveMaxResults: number | undefined;

  constructor(private readonly input: {
    connectorId: string;
    collectionScope: string;
    streamKind: 'activity' | 'inventory';
    actionId: string;
    arguments: Record<string, unknown>;
    buildArguments?: (pull: KnowledgePullInput) => Record<string, unknown>;
    agentId: string;
    connection: ReturnType<typeof listConnectorConnections>[number];
    toolkit: string;
    workspaceId: string;
    installation: NonNullable<ReturnType<typeof getConnectorInstallation>>;
    adapter: ComposioSessionsAdapter;
  }) {}

  async pull(pull: KnowledgePullInput): Promise<KnowledgePullResult> {
    const cursor = decodeConnectedSourceCursor(pull.cursor);
    const scanStartedAt = cursor?.scanStartedAt ?? new Date().toISOString();
    const warnings = pull.cursor && !cursor ? ['Stored connected-source cursor was invalid and was replaced.'] : [];
    const execute = async (cursorValue: string | undefined) => {
      const configuredArgs = this.input.buildArguments?.({ ...pull, cursor: cursorValue }) ?? this.input.arguments;
      const configuredMaxResults = maxResultsValue(configuredArgs);
      let args = this.adaptiveMaxResults && configuredMaxResults && configuredMaxResults > this.adaptiveMaxResults
        ? { ...configuredArgs, max_results: this.adaptiveMaxResults }
        : configuredArgs;
      for (;;) {
        try {
          return await this.input.adapter.executeWithPolicy({
            context: { principalId: 'local-owner', toolkits: [this.input.toolkit] },
            installation: { ...this.input.installation, maxScope: 'read', confirmationPolicy: 'never' },
            connection: this.input.connection,
            agentId: this.input.agentId,
            action: {
              connectorId: this.input.connectorId,
              actionId: this.input.actionId,
              toolkit: this.input.toolkit,
              scope: 'read',
              curated: true,
              cachedAt: new Date().toISOString(),
            },
            args,
            confirmed: true,
          });
        } catch (error) {
          const currentMaxResults = maxResultsValue(args);
          if (!isPayloadTooLargeError(error) || !currentMaxResults || currentMaxResults <= 1) throw error;
          const reducedMaxResults = Math.max(1, Math.floor(currentMaxResults / 2));
          this.adaptiveMaxResults = reducedMaxResults;
          log.info(
            {
              connectorId: this.input.connectorId,
              actionId: this.input.actionId,
              previousMaxResults: currentMaxResults,
              maxResults: reducedMaxResults,
              phase: 'payload_too_large_retry',
            },
            `Retrying connector action with page size ${reducedMaxResults}`,
          );
          args = { ...args, max_results: reducedMaxResults };
        }
      }
    };
    let execution;
    try {
      execution = await execute(pull.cursor);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.input.toolkit !== 'googlecalendar' || !cursor?.syncToken || !/\b410\b|sync.?token/i.test(message)) throw error;
      warnings.push('Expired Google Calendar sync token was replaced with a full sync.');
      execution = await execute(undefined);
    }
    if (execution.decision !== 'allowed') throw new Error(execution.reason);
    const items = resultToSourceItems({
      result: execution.result,
      sourceInstanceId: pull.instanceId,
      collectionScope: pull.collectionScope,
      streamKind: this.input.streamKind,
      connectorId: this.input.connectorId,
      connectionId: this.input.connection.id,
      actionId: this.input.actionId,
      toolkit: this.input.toolkit,
      agentId: this.input.agentId,
      workspaceId: this.input.workspaceId,
      connectionIdentity: this.input.connection.identity,
    });
    const nextPageToken = paginationValue(execution.result, 'nextPageToken', 'next_page_token');
    const nextSyncToken = paginationValue(execution.result, 'nextSyncToken', 'next_sync_token');
    const completeSnapshot = this.input.streamKind === 'inventory'
      && (this.input.toolkit === 'github' || !cursor?.checkpoint);
    return {
      items,
      nextCursor: nextPageToken
        ? encodeConnectedSourceCursor({
            checkpoint: cursor?.checkpoint,
            scanStartedAt,
            pageToken: nextPageToken,
            syncToken: cursor?.syncToken,
          })
        : encodeConnectedSourceCursor({ checkpoint: scanStartedAt, ...(nextSyncToken ? { syncToken: nextSyncToken } : {}) }),
      hasMore: Boolean(nextPageToken),
      warnings,
      ...(completeSnapshot ? { snapshotExternalIds: items.map((item) => item.externalId) } : {}),
    };
  }
}

export async function ingestComposioConnectedSource(input: {
  config: Config;
  connectorId: string;
  collectionScope: string;
  streamKind: 'activity' | 'inventory';
  actionId: string;
  arguments?: Record<string, unknown>;
  buildArguments?: (pull: KnowledgePullInput) => Record<string, unknown>;
  agentId: string;
  connectionId?: string;
  adapter?: ComposioSessionsAdapter;
}): Promise<{
  connectorId: string;
  actionId: string;
  sourceInstanceId: string;
  itemsSeen: number;
  itemsIndexed: number;
  recordIds: string[];
}> {
  const definition = getConnectorDefinition(input.connectorId);
  if (definition?.runtime.type !== 'composio' || definition.runtime.role !== 'toolkit') {
    throw new Error('Connected source ingestion requires a Composio toolkit connector.');
  }
  const toolkit = definition.runtime.toolkit;
  if (!COMPOSIO_CONNECTED_SOURCE_TOOLKITS.has(toolkit)) {
    throw new Error(`Connected source ingestion is not supported for the ${toolkit} connector.`);
  }
  const risk = scopeForComposioAction(input.actionId);
  if (risk.toolkit !== toolkit || risk.scope !== 'read' || !risk.curated) {
    throw new Error('Connected source ingestion only accepts a verified read action for the selected connector.');
  }
  const connectorId = definition.id;
  const installation = getConnectorInstallation(`${connectorId}-local-owner`);
  if (!installation?.enabled) throw new Error('Connector installation is not enabled.');
  if (installation.allowedAgentIds.length && !installation.allowedAgentIds.includes(input.agentId)) {
    throw new Error('This agent is not allowed to sync from the connector.');
  }
  const activeConnections = listConnectorConnections({ principalId: 'local-owner', connectorId })
    .filter((connection) => connection.status === 'active');
  const connection = input.connectionId
    ? activeConnections.find((candidate) => candidate.id === input.connectionId)
    : activeConnections.find((candidate) => candidate.isDefault) ?? activeConnections[0];
  if (!connection) throw new Error('No active connector account is available for connected source ingestion.');
  if (!connection.accountId) throw new Error('The connector authorization is not assigned to an account.');
  const adapter = input.adapter ?? new ComposioSessionsAdapter();
  const workspaceId = getWorkspacePath(input.config);
  const sourceInstanceId = `composio:${connectorId}:${connection.accountId}`;
  const sourceAdapter = new ComposioKnowledgeSourceAdapter({
    connectorId,
    collectionScope: input.collectionScope,
    streamKind: input.streamKind,
    connection,
    actionId: input.actionId,
    arguments: input.arguments ?? {},
    buildArguments: input.buildArguments,
    agentId: input.agentId,
    toolkit,
    workspaceId,
    installation,
    adapter,
  });
  const syncRun = await new KnowledgeIngestionService(new Map([[sourceAdapter.kind, sourceAdapter]])).sync({
    adapterKind: sourceAdapter.kind,
    instanceId: sourceInstanceId,
    collectionScope: input.collectionScope,
  });
  if (syncRun.status === 'failed' || syncRun.status === 'cancelled') {
    throw new Error(syncRun.error ?? `Connected source ingestion ${syncRun.status}.`);
  }
  const pipeline = new ConnectedKnowledgePipeline({ agentId: input.agentId, workspaceId });
  const recordIds: string[] = [];
  for (let batch = 0; batch < 10; batch += 1) {
    const synthesis = await pipeline.processPending(sourceInstanceId);
    recordIds.push(...synthesis.recordIds);
    if (synthesis.claimed === 0) break;
  }
  return {
    connectorId,
    actionId: input.actionId,
    sourceInstanceId,
    itemsSeen: syncRun.itemsSeen,
    itemsIndexed: syncRun.itemsCreated + syncRun.itemsUpdated,
    recordIds,
  };
}

export async function ingestLocalFolderSource(input: {
  config: Config;
  connectorId: string;
  agentId: string;
}): Promise<{ connectorId: string; sourceInstanceId: string; recordIds: string[] }> {
  const definition = getConnectorDefinition(input.connectorId);
  if (definition?.runtime.type !== 'memorySource' || definition.runtime.sourceKind !== 'local-folder') {
    throw new Error('Local folder sync requires a local-folder memory source connector.');
  }
  const instance = getConnectorInstance(input.config, definition.id);
  if (!instance?.enabled) throw new Error('Local folder connector is not installed and enabled.');
  const rootPath = typeof instance.config?.rootPath === 'string' ? instance.config.rootPath.trim() : '';
  if (!rootPath) throw new Error('Local folder connector requires a rootPath.');
  const sourceInstanceId = `local-folder:${definition.id}`;
  const adapter = new LocalFolderKnowledgeSourceAdapter(rootPath);
  const syncRun = await new KnowledgeIngestionService(new Map([[adapter.kind, adapter]])).sync({
    adapterKind: adapter.kind,
    instanceId: sourceInstanceId,
    collectionScope: 'files',
  });
  if (syncRun.status === 'failed' || syncRun.status === 'cancelled') {
    throw new Error(syncRun.error ?? `Local folder sync ${syncRun.status}.`);
  }
  const pipeline = new ConnectedKnowledgePipeline({
    agentId: input.agentId,
    workspaceId: getWorkspacePath(input.config),
  });
  const recordIds: string[] = [];
  for (let batch = 0; batch < 10; batch += 1) {
    const synthesis = await pipeline.processPending(sourceInstanceId);
    recordIds.push(...synthesis.recordIds);
    if (synthesis.claimed === 0) break;
  }
  return { connectorId: definition.id, sourceInstanceId, recordIds };
}
