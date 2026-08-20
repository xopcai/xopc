import type { MemorySensitivity } from '../agent/memory/types.js';
import { ProactiveEventService } from '../proactive/service.js';
import type { EventSensitivity } from '../proactive/events/types.js';
import { getConnectorAccount } from '../storage/sqlite/connector-account-repository.js';
import { listConnectorConnections } from '../storage/sqlite/connector-repository.js';
import { getConnectorSyncPolicyForConnection } from '../storage/sqlite/connector-sync-policy-repository.js';
import {
  getKnowledgeConsumerWatermark,
  getKnowledgeSourceItem,
  listKnowledgeSourceChanges,
  setKnowledgeConsumerWatermark,
} from '../storage/sqlite/knowledge-repository.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Connector:SourceChanges');
const CONSUMER_ID = 'proactive-connected-source-v1';

export type SourceChangePublishResult = {
  published: number;
  skipped: number;
  sources: number;
};

function sensitivity(value: MemorySensitivity): EventSensitivity {
  if (value === 'regulated') return 'restricted';
  if (value === 'secret') return 'confidential';
  return 'personal';
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export class ConnectedSourceChangePublisher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly eventService: ProactiveEventService,
    private readonly intervalMs = 10_000,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.runNow();
    this.timer = setInterval(() => void this.runNow(), Math.max(2_000, this.intervalMs));
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runNow(): Promise<SourceChangePublishResult> {
    if (this.running) return { published: 0, skipped: 0, sources: 0 };
    this.running = true;
    const total: SourceChangePublishResult = { published: 0, skipped: 0, sources: 0 };
    try {
      const connections = listConnectorConnections({ principalId: 'local-owner' })
        .filter((connection) => (
          connection.status === 'active'
          && connection.accountId
          && getConnectorAccount(connection.accountId)?.currentConnectionId === connection.id
        ));
      for (const connection of connections) {
        const sourceInstanceId = `composio:${connection.connectorId}:${connection.accountId}`;
        try {
          const result = this.publishSource(sourceInstanceId, connection.id);
          total.published += result.published;
          total.skipped += result.skipped;
          total.sources += 1;
        } catch (err) {
          const em = err instanceof Error ? err.message : String(err);
          log.warn(
            { err, connectionId: connection.id, sourceInstanceId },
            `Connected source change publication failed: ${em}`,
          );
        }
      }
      return total;
    } finally {
      this.running = false;
    }
  }

  private publishSource(sourceInstanceId: string, connectionId: string): SourceChangePublishResult {
    const policy = getConnectorSyncPolicyForConnection(connectionId);
    let watermark = getKnowledgeConsumerWatermark(CONSUMER_ID, sourceInstanceId);
    const changes = listKnowledgeSourceChanges({ sourceInstanceId, afterSequence: watermark, limit: 250 });
    let published = 0;
    let skipped = 0;

    for (const change of changes) {
      const item = getKnowledgeSourceItem(change.sourceItemId);
      if (!policy?.scanEnabled || !policy.proactiveEnabled || !item
        || item.sensitivity === 'secret' || item.sensitivity === 'regulated') {
        skipped += 1;
        watermark = change.sequence;
        setKnowledgeConsumerWatermark(CONSUMER_ID, sourceInstanceId, watermark);
        continue;
      }

      const workspaceId = metadataString(item.metadata, 'workspaceId');
      const connectorId = metadataString(item.metadata, 'connectorId');
      if (!workspaceId || !connectorId) {
        skipped += 1;
        watermark = change.sequence;
        setKnowledgeConsumerWatermark(CONSUMER_ID, sourceInstanceId, watermark);
        continue;
      }

      const eventType = change.kind === 'added'
        ? 'connected_source.item_created.v1'
        : change.kind === 'deleted'
          ? 'connected_source.item_deleted.v1'
          : 'connected_source.item_updated.v1';
      const agentId = metadataString(item.metadata, 'agentId');
      this.eventService.publish({
        type: eventType,
        schemaVersion: 1,
        source: { kind: 'connector', id: connectionId },
        subject: { kind: 'knowledge_source_item', id: item.id },
        actor: { kind: 'integration', id: connectorId },
        scope: { workspaceId, ...(agentId ? { agentId } : {}) },
        occurredAt: item.sourceUpdatedAt ?? item.occurredAt ?? change.changedAt,
        dedupeKey: `knowledge-change:${change.sequence}`,
        sensitivity: sensitivity(item.sensitivity),
        payload: {
          sourceInstanceId,
          sourceItemId: item.id,
          collectionScope: item.collectionScope,
          itemType: item.itemType,
          changeKind: change.kind,
          contentHash: item.contentHash,
        },
      });
      published += 1;
      watermark = change.sequence;
      setKnowledgeConsumerWatermark(CONSUMER_ID, sourceInstanceId, watermark);
    }

    if (published > 0) {
      log.info(
        { connectionId, sourceInstanceId, published, skipped },
        'Connected source changes published',
      );
    }
    return { published, skipped, sources: 1 };
  }
}
