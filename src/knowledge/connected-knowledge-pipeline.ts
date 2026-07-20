import { createHash, randomUUID } from 'node:crypto';

import {
  attachMemoryEvidence,
  claimKnowledgeSourceItems,
  completeKnowledgeSourceItemSynthesis,
  deleteMemoryEvidenceForRecord,
  getMemoryRecord,
  listKnowledgeSourceItems,
  upsertMemoryRecord,
} from '../storage/sqlite/index.js';
import { createLogger } from '../utils/logger.js';
import type { KnowledgeSourceItem } from './types.js';

const log = createLogger('ConnectedKnowledge');
const MAX_ITEM_CHARS = 8_000;
const MAX_SUMMARY_CHARS = 6_000;
const MAX_SUMMARY_ITEMS = 24;

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

function providerId(item: KnowledgeSourceItem): string {
  const connectorId = item.metadata.connectorId;
  if (typeof connectorId === 'string' && connectorId.trim()) return connectorId.trim();
  return item.sourceInstanceId.split(':')[0] || 'connected-source';
}

function ownerAgentId(item: KnowledgeSourceItem, fallback: string): string {
  const agentId = item.metadata.agentId;
  return typeof agentId === 'string' && agentId.trim() ? agentId.trim() : fallback;
}

function ownerWorkspaceId(item: KnowledgeSourceItem, fallback: string): string {
  const workspaceId = item.metadata.workspaceId;
  return typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : fallback;
}

function knowledgeRecordId(itemId: string): string {
  return `knowledge:${itemId}`;
}

function boundedText(item: KnowledgeSourceItem): string {
  const text = item.normalizedText?.trim() ?? '';
  return text.length > MAX_ITEM_CHARS ? `${text.slice(0, MAX_ITEM_CHARS)}\n…` : text;
}

function dayFor(item: KnowledgeSourceItem): string {
  const timestamp = item.occurredAt ?? item.sourceUpdatedAt ?? item.updatedAt;
  return timestamp.slice(0, 10);
}

function summaryRecordId(sourceInstanceId: string, day: string): string {
  const key = createHash('sha256').update(`${sourceInstanceId}:${day}`).digest('hex').slice(0, 24);
  return `knowledge-summary:${key}`;
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
      claimed: claimed.length,
      completed: 0,
      ignored: 0,
      failed: 0,
      recordIds: [],
    };
    const summaryKeys = new Set<string>();

    for (const item of claimed) {
      try {
        const recordId = knowledgeRecordId(item.id);
        const content = boundedText(item);
        if (item.deletedAt) {
          const existing = getMemoryRecord(recordId);
          if (existing) {
            upsertMemoryRecord({
              id: existing.id,
              providerId: 'connected-knowledge',
              kind: existing.kind,
              agentId: existing.scope.agentId,
              workspaceId: existing.scope.workspaceId,
              content: existing.content,
              source: existing.source,
              confidence: existing.confidence,
              tags: existing.tags,
              status: 'archived',
              sensitivity: existing.sensitivity,
              explicitness: existing.explicitness,
              durability: existing.durability,
              importance: existing.importance,
              disclosurePolicy: existing.disclosurePolicy,
              evidence: existing.evidence,
              validFrom: existing.validFrom,
              validTo: item.deletedAt,
              reviewAfter: existing.reviewAfter,
              expiresAt: existing.expiresAt,
              canonicalKey: existing.canonicalKey,
              supersedesRecordId: existing.supersedesRecordId,
              conflictGroupId: existing.conflictGroupId,
            });
          }
          completeKnowledgeSourceItemSynthesis({
            itemId: item.id,
            workerId: this.workerId,
            status: 'ignored',
          });
          result.ignored += 1;
          summaryKeys.add(`${item.sourceInstanceId}\u0000${dayFor(item)}`);
          continue;
        }
        if (!content || item.sensitivity === 'secret' || item.sensitivity === 'regulated') {
          completeKnowledgeSourceItemSynthesis({
            itemId: item.id,
            workerId: this.workerId,
            status: 'ignored',
          });
          result.ignored += 1;
          continue;
        }

        const sourceProvider = providerId(item);
        const record = upsertMemoryRecord({
          id: recordId,
          providerId: 'connected-knowledge',
          kind: 'workspace_fact',
          agentId: ownerAgentId(item, this.options.agentId),
          workspaceId: ownerWorkspaceId(item, this.options.workspaceId),
          content,
          canonicalKey: `source-item:${item.sourceInstanceId}:${item.externalId}`,
          source: { provider: sourceProvider, path: item.payloadRef },
          confidence: 0.78,
          tags: ['connected-source', 'external', sourceProvider, item.itemType],
          status: 'active',
          sensitivity: item.sensitivity,
          explicitness: 'observed',
          durability: item.retentionClass === 'durable' ? 'durable' : 'recurring',
          importance: 0.5,
          disclosurePolicy: 'referenceable',
          evidence: [{
            sourceItemId: item.id,
            relation: 'derived_from',
            sourceText: content.slice(0, 1_000),
            confidence: 0.78,
            observedAt: item.occurredAt ?? item.sourceUpdatedAt,
          }],
          validFrom: item.occurredAt ?? item.sourceUpdatedAt,
        });
        attachMemoryEvidence({
          recordId: record.id,
          sourceItemId: item.id,
          relation: 'derived_from',
          excerpt: content.slice(0, 1_000),
          confidence: 0.78,
          observedAt: item.occurredAt ?? item.sourceUpdatedAt,
        });
        completeKnowledgeSourceItemSynthesis({
          itemId: item.id,
          workerId: this.workerId,
          status: 'completed',
        });
        result.completed += 1;
        result.recordIds.push(record.id);
        summaryKeys.add(`${item.sourceInstanceId}\u0000${dayFor(item)}`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        completeKnowledgeSourceItemSynthesis({
          itemId: item.id,
          workerId: this.workerId,
          status: 'failed',
          error: errorMessage.slice(0, 1_000),
        });
        result.failed += 1;
        log.warn(
          { err, itemId: item.id, sourceInstanceId: item.sourceInstanceId },
          `Connected knowledge synthesis failed: ${errorMessage}`,
        );
      }
    }

    for (const key of summaryKeys) {
      const [sourceInstanceId, day] = key.split('\u0000');
      if (sourceInstanceId && day) this.rebuildDailySummary(sourceInstanceId, day);
    }
    return result;
  }

  private rebuildDailySummary(sourceInstanceId: string, day: string): void {
    const items = listKnowledgeSourceItems({ sourceInstanceId, limit: 500 })
      .filter((item) => dayFor(item) === day && item.synthesisStatus === 'completed')
      .slice(0, MAX_SUMMARY_ITEMS);
    if (items.length === 0) {
      const existing = getMemoryRecord(summaryRecordId(sourceInstanceId, day));
      if (existing) {
        upsertMemoryRecord({
          id: existing.id,
          providerId: 'connected-knowledge',
          kind: existing.kind,
          agentId: existing.scope.agentId,
          workspaceId: existing.scope.workspaceId,
          content: existing.content,
          source: existing.source,
          confidence: existing.confidence,
          tags: existing.tags,
          status: 'archived',
          sensitivity: existing.sensitivity,
          explicitness: existing.explicitness,
          durability: existing.durability,
          importance: existing.importance,
          disclosurePolicy: existing.disclosurePolicy,
          evidence: existing.evidence,
          validFrom: existing.validFrom,
          validTo: new Date().toISOString(),
          reviewAfter: existing.reviewAfter,
          expiresAt: existing.expiresAt,
          canonicalKey: existing.canonicalKey,
        });
      }
      return;
    }
    const sourceProvider = providerId(items[0]!);
    const lines = [`# ${sourceProvider} updates for ${day}`, ''];
    for (const item of items) {
      const text = boundedText(item).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      lines.push(`- ${text.slice(0, 360)}`);
      if (lines.join('\n').length >= MAX_SUMMARY_CHARS) break;
    }
    const content = lines.join('\n').slice(0, MAX_SUMMARY_CHARS);
    const summary = upsertMemoryRecord({
      id: summaryRecordId(sourceInstanceId, day),
      providerId: 'connected-knowledge',
      kind: 'daily_note',
      agentId: ownerAgentId(items[0]!, this.options.agentId),
      workspaceId: ownerWorkspaceId(items[0]!, this.options.workspaceId),
      content,
      canonicalKey: `source-day:${sourceInstanceId}:${day}`,
      source: { provider: sourceProvider },
      confidence: 0.72,
      tags: ['connected-source', 'source-day-summary', sourceProvider],
      status: 'active',
      sensitivity: items.some((item) => item.sensitivity === 'personal') ? 'personal' : 'normal',
      explicitness: 'observed',
      durability: 'recurring',
      importance: 0.55,
      disclosurePolicy: 'referenceable',
      evidence: items.map((item) => ({
        sourceItemId: item.id,
        relation: 'derived_from' as const,
        sourceText: boundedText(item).slice(0, 500),
        confidence: 0.72,
        observedAt: item.occurredAt ?? item.sourceUpdatedAt,
      })),
      validFrom: `${day}T00:00:00.000Z`,
    });
    deleteMemoryEvidenceForRecord(summary.id, 'derived_from');
    for (const item of items) {
      attachMemoryEvidence({
        recordId: summary.id,
        sourceItemId: item.id,
        relation: 'derived_from',
        excerpt: boundedText(item).slice(0, 500),
        confidence: 0.72,
        observedAt: item.occurredAt ?? item.sourceUpdatedAt,
      });
    }
  }
}
