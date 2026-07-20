import { createHash } from 'node:crypto';

import type { Config } from '../config/schema.js';
import { getWorkspacePath } from '../config/workspace-path-helpers.js';
import {
  getConnectorInstallation,
  listConnectorConnections,
} from '../storage/sqlite/index.js';
import { ConnectedKnowledgePipeline, KnowledgeIngestionService, type KnowledgeSourceItemInput } from '../knowledge/index.js';
import { ComposioSessionsAdapter } from './composio-sessions.js';
import { scopeForComposioAction } from './composio.js';
import { getConnectorDefinition } from './catalog.js';

const MEMORY_SOURCE_TOOLKITS = new Set(['gmail', 'googledrive', 'notion', 'slack']);
const EXTERNAL_ID_KEYS = ['id', 'messageId', 'message_id', 'threadId', 'thread_id', 'eventId', 'event_id', 'pageId', 'page_id', 'fileId', 'file_id'];
const OCCURRED_AT_KEYS = ['occurredAt', 'createdAt', 'created_at', 'date', 'timestamp', 'startTime', 'start_time'];
const UPDATED_AT_KEYS = ['updatedAt', 'updated_at', 'modifiedTime', 'modified_time'];
const SENSITIVE_KEY_RE = /(?:^|_)(?:api_?key|token|secret|password|passwd|authorization|credential|private_?key)(?:$|_)/i;
const INLINE_SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function resultRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [value];
  for (const key of ['items', 'messages', 'results', 'events', 'files', 'pages', 'data']) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [value];
}

function stringField(record: Record<string, unknown> | null, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function timestampField(record: Record<string, unknown> | null, keys: string[]): string | undefined {
  const value = stringField(record, keys);
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function sanitizeSourceValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[MaxDepth]';
  if (typeof value === 'string') {
    return INLINE_SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[REDACTED]'), value);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeSourceValue(item, depth + 1));
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [
    key,
    SENSITIVE_KEY_RE.test(key) ? '[REDACTED]' : sanitizeSourceValue(nested, depth + 1),
  ]));
}

function resultToSourceItems(input: {
  result: unknown;
  sourceInstanceId: string;
  connectorId: string;
  connectionId: string;
  actionId: string;
  agentId: string;
  workspaceId: string;
}): KnowledgeSourceItemInput[] {
  return resultRows(input.result).slice(0, 200).map((row, index) => {
    const record = asRecord(row);
    const serialized = JSON.stringify(sanitizeSourceValue(row), null, 2) ?? String(row);
    const normalizedText = serialized.length > 8_000 ? `${serialized.slice(0, 8_000)}\n…` : serialized;
    const contentHash = createHash('sha256').update(serialized).digest('hex');
    const externalId = stringField(record, EXTERNAL_ID_KEYS) ?? `${input.actionId}:${index}`;
    return {
      sourceInstanceId: input.sourceInstanceId,
      externalId,
      itemType: `${input.connectorId}:${input.actionId}`,
      authorRole: 'third_party',
      occurredAt: timestampField(record, OCCURRED_AT_KEYS),
      sourceUpdatedAt: timestampField(record, UPDATED_AT_KEYS),
      contentHash,
      normalizedText,
      metadata: {
        connectorId: input.connectorId,
        connectionId: input.connectionId,
        actionId: input.actionId,
        agentId: input.agentId,
        workspaceId: input.workspaceId,
      },
      sensitivity: 'personal',
      retentionClass: 'bounded',
      synthesisPipeline: 'connected_knowledge',
      synthesisStatus: 'pending',
    };
  });
}

export async function syncComposioResultToMemory(input: {
  config: Config;
  connectorId: string;
  actionId: string;
  arguments?: Record<string, unknown>;
  agentId: string;
  connectionId?: string;
  adapter?: ComposioSessionsAdapter;
}): Promise<{ recordId: string; connectorId: string; actionId: string }> {
  const definition = getConnectorDefinition(input.connectorId);
  if (definition?.runtime.type !== 'composio' || definition.runtime.role !== 'toolkit') {
    throw new Error('Memory sync requires a Composio toolkit connector.');
  }
  const toolkit = definition.runtime.toolkit;
  if (!MEMORY_SOURCE_TOOLKITS.has(toolkit)) {
    throw new Error('Memory sync is supported for Gmail, Google Drive, Notion, and Slack.');
  }
  const risk = scopeForComposioAction(input.actionId);
  if (risk.toolkit !== toolkit || risk.scope !== 'read' || !risk.curated) {
    throw new Error('Memory sync only accepts a verified read action for the selected connector.');
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
  if (!connection) throw new Error('No active connector account is available for memory sync.');
  const adapter = input.adapter ?? new ComposioSessionsAdapter();
  const execution = await adapter.executeWithPolicy({
    context: { principalId: 'local-owner', toolkits: [toolkit] },
    installation: { ...installation, maxScope: 'read', confirmationPolicy: 'never' },
    connection,
    agentId: input.agentId,
    action: {
      connectorId,
      actionId: input.actionId,
      toolkit,
      scope: 'read',
      curated: true,
      cachedAt: new Date().toISOString(),
    },
    args: input.arguments ?? {},
    confirmed: true,
  });
  if (execution.decision !== 'allowed') throw new Error(execution.reason);
  const workspaceId = getWorkspacePath(input.config);
  const sourceInstanceId = `composio:${connectorId}:${connection.id}`;
  const items = resultToSourceItems({
    result: execution.result,
    sourceInstanceId,
    connectorId,
    connectionId: connection.id,
    actionId: input.actionId,
    agentId: input.agentId,
    workspaceId,
  });
  new KnowledgeIngestionService(new Map()).ingest({
    instanceId: sourceInstanceId,
    items,
    cursorAfter: new Date().toISOString(),
  });
  const pipeline = new ConnectedKnowledgePipeline({ agentId: input.agentId, workspaceId });
  let recordId: string | undefined;
  for (let batch = 0; batch < 10; batch += 1) {
    const synthesis = await pipeline.processPending(sourceInstanceId);
    recordId ??= synthesis.recordIds[0];
    if (synthesis.claimed === 0) break;
  }
  if (!recordId) throw new Error('Connector result did not contain any synthesizable knowledge.');
  return { recordId, connectorId, actionId: input.actionId };
}
