import { createHash } from 'node:crypto';

import type { Config } from '../config/schema.js';
import { getWorkspacePath } from '../config/workspace-path-helpers.js';
import {
  getConnectorInstallation,
  listConnectorConnections,
  upsertMemoryRecord,
} from '../storage/sqlite/index.js';
import { ComposioSessionsAdapter } from './composio-sessions.js';
import { scopeForComposioAction } from './composio.js';
import { getConnectorDefinition } from './catalog.js';

const MEMORY_SOURCE_TOOLKITS = new Set(['gmail', 'googledrive', 'notion', 'slack']);

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
  const serialized = JSON.stringify(execution.result, null, 2);
  const content = serialized.length > 20_000 ? `${serialized.slice(0, 20_000)}\n…` : serialized;
  const canonicalKey = `connector:${connectorId}:${connection.id}:${input.actionId}:${createHash('sha256').update(JSON.stringify(input.arguments ?? {})).digest('hex').slice(0, 16)}`;
  const record = upsertMemoryRecord({
    providerId: 'connector-composio',
    kind: 'workspace_fact',
    agentId: input.agentId,
    workspaceId: getWorkspacePath(input.config),
    content,
    canonicalKey,
    source: { provider: connectorId },
    confidence: 0.75,
    tags: ['connector', 'external', toolkit, 'needs-review'],
    status: 'needs_review',
    sensitivity: 'normal',
    explicitness: 'observed',
    durability: 'recurring',
    importance: 0.5,
    disclosurePolicy: 'referenceable',
  });
  return { recordId: record.id, connectorId, actionId: input.actionId };
}
