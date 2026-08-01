import { createLogger } from '../utils/logger.js';
import {
  finishKnowledgeSyncRun,
  getKnowledgeSourceCursor,
  listKnowledgeSourceItems,
  setKnowledgeSourceCursor,
  startKnowledgeSyncRun,
  upsertKnowledgeSourceItems,
} from '../storage/sqlite/knowledge-repository.js';
import type { KnowledgeSourceAdapter, KnowledgeSourceItemInput, KnowledgeSyncRun } from './types.js';

const log = createLogger('KnowledgeIngestion');

function deletionInputs(instanceId: string, snapshotExternalIds: string[] | undefined): KnowledgeSourceItemInput[] {
  if (!snapshotExternalIds) return [];
  const seen = new Set(snapshotExternalIds);
  const deletedAt = new Date().toISOString();
  const missing: KnowledgeSourceItemInput[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = listKnowledgeSourceItems({ sourceInstanceId: instanceId, limit: 500, offset });
    for (const item of page) {
      if (seen.has(item.externalId)) continue;
      missing.push({
        id: item.id,
        sourceInstanceId: item.sourceInstanceId,
        externalId: item.externalId,
        itemType: item.itemType,
        authorRole: item.authorRole,
        occurredAt: item.occurredAt,
        sourceUpdatedAt: item.sourceUpdatedAt,
        contentHash: item.contentHash,
        normalizedText: item.normalizedText,
        payloadRef: item.payloadRef,
        metadata: item.metadata,
        sensitivity: item.sensitivity,
        retentionClass: item.retentionClass,
        synthesisPipeline: item.synthesisPipeline,
        deletedAt,
      });
    }
    if (page.length < 500) break;
  }
  return missing;
}

export interface KnowledgeSourceStateStore {
  getCursor(instanceId: string): string | undefined;
  setCursor(instanceId: string, cursor: string | undefined): void;
}

export class SqliteKnowledgeSourceStateStore implements KnowledgeSourceStateStore {
  getCursor(instanceId: string): string | undefined {
    return getKnowledgeSourceCursor(instanceId);
  }

  setCursor(instanceId: string, cursor: string | undefined): void {
    setKnowledgeSourceCursor(instanceId, cursor);
  }
}

export class KnowledgeIngestionService {
  constructor(
    private readonly adapters: ReadonlyMap<string, KnowledgeSourceAdapter>,
    private readonly state: KnowledgeSourceStateStore = new SqliteKnowledgeSourceStateStore(),
  ) {}

  ingest(params: {
    instanceId: string;
    items: KnowledgeSourceItemInput[];
    cursorAfter?: string;
    warnings?: string[];
  }): KnowledgeSyncRun {
    const cursorBefore = this.state.getCursor(params.instanceId);
    const run = startKnowledgeSyncRun({ sourceInstanceId: params.instanceId, cursorBefore });
    try {
      const stored = upsertKnowledgeSourceItems(params.items);
      this.state.setCursor(params.instanceId, params.cursorAfter);
      return finishKnowledgeSyncRun({
        runId: run.id,
        status: params.warnings?.length ? 'partial' : 'succeeded',
        cursorAfter: params.cursorAfter,
        itemsSeen: params.items.length,
        itemsCreated: stored.created,
        itemsUpdated: stored.updated,
        warnings: params.warnings,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      finishKnowledgeSyncRun({ runId: run.id, status: 'failed', error: errorMessage });
      throw err;
    }
  }

  async sync(params: {
    adapterKind: string;
    instanceId: string;
    windowStart?: string;
    signal?: AbortSignal;
  }): Promise<KnowledgeSyncRun> {
    const adapter = this.adapters.get(params.adapterKind);
    if (!adapter) {
      throw new Error(`Knowledge source adapter not found: ${params.adapterKind}`);
    }
    const cursorBefore = this.state.getCursor(params.instanceId);
    const run = startKnowledgeSyncRun({
      sourceInstanceId: params.instanceId,
      cursorBefore,
    });
    const controller = params.signal ? null : new AbortController();
    const signal = params.signal ?? controller!.signal;

    try {
      const pulled = await adapter.pull({
        instanceId: params.instanceId,
        cursor: cursorBefore,
        windowStart: params.windowStart,
        signal,
      });
      const tombstones = deletionInputs(params.instanceId, pulled.snapshotExternalIds);
      const stored = upsertKnowledgeSourceItems([...pulled.items, ...tombstones]);
      this.state.setCursor(params.instanceId, pulled.nextCursor);
      const completed = finishKnowledgeSyncRun({
        runId: run.id,
        status: pulled.warnings.length > 0 ? 'partial' : 'succeeded',
        cursorAfter: pulled.nextCursor,
        itemsSeen: pulled.items.length,
        itemsCreated: stored.created,
        itemsUpdated: stored.updated,
        warnings: pulled.warnings,
      });
      log.info(
        {
          runId: run.id,
          sourceInstanceId: params.instanceId,
          itemsSeen: pulled.items.length,
          itemsCreated: stored.created,
          itemsUpdated: stored.updated,
          itemsDeleted: tombstones.length,
        },
        'Knowledge source sync completed',
      );
      return completed;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const status = signal.aborted ? 'cancelled' : 'failed';
      log.warn(
        { err, runId: run.id, sourceInstanceId: params.instanceId },
        `Knowledge source sync ${status}: ${errorMessage}`,
      );
      return finishKnowledgeSyncRun({
        runId: run.id,
        status,
        error: errorMessage,
      });
    }
  }
}
