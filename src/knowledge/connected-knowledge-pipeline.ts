import { randomUUID } from 'node:crypto';

import { consentFilteredText } from '../user-context/sources/consent-fields.js';
import { replaceKnowledgeChunks } from './chunks.js';
import { createContextEvidence } from '../storage/sqlite/context-evidence-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { clearMemoryAudit } from '../user-context/memory-suppression.js';
import { getActiveUnderstandingConsent } from '../user-context/sources/consent-repository.js';
import {
  listKnowledgeItems,
  transitionKnowledgeStatus,
  writeKnowledgeItem,
} from '../knowledge-memory/index.js';
import {
  claimKnowledgeSourceItems,
  completeKnowledgeSourceItemSynthesis,
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
        let content = boundedText(item);
        const existing = listKnowledgeItems({ recordClass: 'source_index', limit: 2_000 })
          .find((entry) => entry.canonicalKey === `source-item:${item.sourceInstanceId}:${item.externalId}`);
        if (item.deletedAt) {
          if (existing) transitionKnowledgeStatus({
            id: existing.id,
            status: 'archived',
            actor: 'runtime',
            reason: 'Connected source item was deleted.',
          });
          completeKnowledgeSourceItemSynthesis({ itemId: item.id, workerId: this.workerId, status: 'ignored' });
          result.ignored += 1;
          continue;
        }
        if (!content || item.sensitivity === 'secret' || item.sensitivity === 'regulated') {
          completeKnowledgeSourceItemSynthesis({ itemId: item.id, workerId: this.workerId, status: 'ignored' });
          result.ignored += 1;
          continue;
        }
        const grant = getSqliteDatabase().prepare(`SELECT grant_id FROM understanding_source_grants
          WHERE status = 'active' AND json_extract(config_json, '$.sourceInstanceId') = ? LIMIT 1`)
          .get(item.sourceInstanceId) as { grant_id: string } | undefined;
        const consent = grant ? getActiveUnderstandingConsent(grant.grant_id) : undefined;
        const filtered = consent ? item.itemType === 'local_file'
          ? consent.allowedFields.includes('content') ? item.normalizedText : undefined
          : consentFilteredText(item.normalizedText, new Set(consent.allowedFields)) : undefined;
        if (consent) content = (filtered ?? '').slice(0, MAX_ITEM_CHARS);
        replaceKnowledgeChunks(getSqliteDatabase(), { ...item, normalizedText: filtered, consentReceiptId: consent?.id });
        if (!content.trim()) {
          completeKnowledgeSourceItemSynthesis({ itemId: item.id, workerId: this.workerId, status: 'ignored' });
          result.ignored += 1;
          continue;
        }
        const evidence = createContextEvidence({
          sourceType: 'connector',
          sourceInstanceId: item.sourceInstanceId, sourceItemId: item.id,
          sourceRef: `knowledge-source://${item.id}`, contentHash: item.contentHash,
          trustLevel: 'untrusted', observedAt: Date.parse(item.sourceUpdatedAt ?? item.updatedAt),
        });
        const written = writeKnowledgeItem({
          verification: 'supported', claimMode: 'reported', sensitivity: item.sensitivity,
          evidence: [{ id: evidence.id, contentHash: item.contentHash, consentReceiptId: consent?.id }],
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
            consentReceiptId: consent?.id,
          },
          replaceExisting: true,
        });
        completeKnowledgeSourceItemSynthesis({ itemId: item.id, workerId: this.workerId, status: 'completed' });
        result.completed += 1;
        if (written.item) result.recordIds.push(written.item.id);
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
    return runSqliteWriteTransaction((db) => {
      const expiredSourceQuery = `SELECT item_id FROM knowledge_source_items
        WHERE source_instance_id = ? AND retention_class = 'bounded'
          AND COALESCE(source_updated_at, occurred_at, updated_at) < ?`;
      const indexes = db.prepare(`SELECT knowledge_id FROM knowledge_items
        WHERE record_class = 'source_index'
          AND json_extract(source_json, '$.sourceItemId') IN (${expiredSourceQuery})`)
        .all(sourceInstanceId, olderThanMs) as Array<{ knowledge_id: string }>;
      for (const item of indexes) {
        clearMemoryAudit(db, 'knowledge', item.knowledge_id);
        db.prepare('DELETE FROM knowledge_items WHERE knowledge_id = ?').run(item.knowledge_id);
      }
      db.prepare(`UPDATE context_evidence SET redacted_excerpt = NULL
        WHERE source_item_id IN (${expiredSourceQuery})`).run(sourceInstanceId, olderThanMs);
      const rawDeleted = pruneBoundedKnowledgeSourceItems(sourceInstanceId, olderThanMs);
      return { rawDeleted, derivedDeleted: indexes.length };
    });
  }
}
