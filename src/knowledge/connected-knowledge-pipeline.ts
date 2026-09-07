import { randomUUID } from 'node:crypto';

import {
  listKnowledgeItems,
  setKnowledgeStatus,
  writeKnowledgeItem,
} from '../knowledge-memory/index.js';
import {
  claimKnowledgeSourceItems,
  completeKnowledgeSourceItemSynthesis,
  listKnowledgeSourceItems,
  pruneBoundedKnowledgeSourceItems,
} from '../storage/sqlite/index.js';
import { createLogger } from '../utils/logger.js';
import type { KnowledgeSourceItem } from './types.js';

const log = createLogger('ConnectedKnowledge');
const MAX_ITEM_CHARS = 8_000;

export type ConnectedKnowledgePipelineOptions = {
  agentId: string;
  workspaceId: string;
  workerId?: string;
  batchSize?: number;
};

export type KnowledgeSynthesisBatchResult = {
  claimed: number;
  completed: number;
  ignored: number;
  failed: number;
  recordIds: string[];
};

export type ConnectedKnowledgePruneResult = { rawDeleted: number; derivedDeleted: number };

function providerId(item: KnowledgeSourceItem): string {
  const connectorId = item.metadata.connectorId;
  return typeof connectorId === 'string' && connectorId.trim()
    ? connectorId.trim() : item.sourceInstanceId.split(':')[0] || 'connected-source';
}

function ownerAgentId(item: KnowledgeSourceItem, fallback: string): string {
  const value = item.metadata.agentId;
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function ownerWorkspaceId(item: KnowledgeSourceItem, fallback: string): string {
  const value = item.metadata.workspaceId;
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function boundedText(item: KnowledgeSourceItem): string {
  const value = item.normalizedText?.trim() ?? '';
  return value.length > MAX_ITEM_CHARS ? `${value.slice(0, MAX_ITEM_CHARS)}\n…` : value;
}

export class ConnectedKnowledgePipeline {
  private readonly workerId: string;
  private readonly batchSize: number;

  constructor(private readonly options: ConnectedKnowledgePipelineOptions) {
    this.workerId = options.workerId ?? `connected-knowledge:${process.pid}:${randomUUID()}`;
    this.batchSize = Math.max(1, Math.min(100, options.batchSize ?? 20));
  }

  async processPending(sourceInstanceId?: string): Promise<KnowledgeSynthesisBatchResult> {
    const claimed = claimKnowledgeSourceItems({
      workerId: this.workerId,
      sourceInstanceId,
      synthesisPipeline: 'connected_knowledge',
      limit: this.batchSize,
    });
    const result: KnowledgeSynthesisBatchResult = {
      claimed: claimed.length, completed: 0, ignored: 0, failed: 0, recordIds: [],
    };
    for (const item of claimed) {
      try {
        const content = boundedText(item);
        const existing = listKnowledgeItems({ recordClass: 'source_index', limit: 2_000 })
          .find((entry) => entry.canonicalKey === `source-item:${item.sourceInstanceId}:${item.externalId}`);
        if (item.deletedAt) {
          if (existing) setKnowledgeStatus(existing.id, 'archived');
          completeKnowledgeSourceItemSynthesis({ itemId: item.id, workerId: this.workerId, status: 'ignored' });
          result.ignored += 1;
          continue;
        }
        if (!content || item.sensitivity === 'secret' || item.sensitivity === 'regulated') {
          completeKnowledgeSourceItemSynthesis({ itemId: item.id, workerId: this.workerId, status: 'ignored' });
          result.ignored += 1;
          continue;
        }
        const written = writeKnowledgeItem({
          kind: 'workspace_fact',
          scope: { type: 'workspace', id: ownerWorkspaceId(item, this.options.workspaceId) },
          content,
          canonicalKey: `source-item:${item.sourceInstanceId}:${item.externalId}`,
          recordClass: 'source_index',
          status: 'active',
          confidence: 0.78,
          importance: 0.5,
          validFrom: Date.parse(item.occurredAt ?? item.sourceUpdatedAt ?? item.updatedAt),
          originClass: 'untrusted',
          sourceAgentId: ownerAgentId(item, this.options.agentId),
          source: {
            provider: providerId(item),
            sourceInstanceId: item.sourceInstanceId,
            sourceItemId: item.id,
            payloadRef: item.payloadRef,
          },
          replaceExisting: true,
        });
        completeKnowledgeSourceItemSynthesis({ itemId: item.id, workerId: this.workerId, status: 'completed' });
        result.completed += 1;
        result.recordIds.push(written.item.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        completeKnowledgeSourceItemSynthesis({
          itemId: item.id, workerId: this.workerId, status: 'failed', error: message.slice(0, 1_000),
        });
        result.failed += 1;
        log.warn({ err: error, itemId: item.id, sourceInstanceId: item.sourceInstanceId },
          `Connected knowledge synthesis failed: ${message}`);
      }
    }
    return result;
  }

  pruneBoundedRetention(sourceInstanceId: string, olderThanMs: number): ConnectedKnowledgePruneResult {
    const expired: KnowledgeSourceItem[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = listKnowledgeSourceItems({
        sourceInstanceId, retentionClass: 'bounded', retentionBeforeMs: olderThanMs,
        includeDeleted: true, limit: 500, offset,
      });
      expired.push(...page);
      if (page.length < 500) break;
    }
    let derivedDeleted = 0;
    const expiredIds = new Set(expired.map((item) => item.id));
    for (const item of listKnowledgeItems({ recordClass: 'source_index', limit: 2_000 })) {
      if (typeof item.source.sourceItemId === 'string' && expiredIds.has(item.source.sourceItemId)) {
        if (setKnowledgeStatus(item.id, 'archived')) derivedDeleted += 1;
      }
    }
    const rawDeleted = pruneBoundedKnowledgeSourceItems(sourceInstanceId, olderThanMs);
    return { rawDeleted, derivedDeleted };
  }
}
