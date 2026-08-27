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
const MAX_PULL_PAGES = 20;

function deletionInputs(instanceId: string, collectionScope: string, snapshotExternalIds: string[] | undefined): KnowledgeSourceItemInput[] {
  if (!snapshotExternalIds) return [];
  const seen = new Set(snapshotExternalIds);
  const deletedAt = new Date().toISOString();
  const missing: KnowledgeSourceItemInput[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = listKnowledgeSourceItems({ sourceInstanceId: instanceId, collectionScope, limit: 500, offset });
    for (const item of page) {
      if (seen.has(item.externalId)) continue;
      missing.push({
        id: item.id,
        sourceInstanceId: item.sourceInstanceId,
        collectionScope: item.collectionScope,
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
  getCursor(instanceId: string, collectionScope: string): string | undefined;
  setCursor(instanceId: string, collectionScope: string, cursor: string | undefined): void;
}

export class SqliteKnowledgeSourceStateStore implements KnowledgeSourceStateStore {
  getCursor(instanceId: string, collectionScope: string): string | undefined {
    return getKnowledgeSourceCursor(instanceId, collectionScope);
  }

  setCursor(instanceId: string, collectionScope: string, cursor: string | undefined): void {
    setKnowledgeSourceCursor(instanceId, collectionScope, cursor);
  }
}

export class KnowledgeIngestionService {
  constructor(
    private readonly adapters: ReadonlyMap<string, KnowledgeSourceAdapter>,
    private readonly state: KnowledgeSourceStateStore = new SqliteKnowledgeSourceStateStore(),
  ) {}

  ingest(params: {
    instanceId: string;
    collectionScope: string;
    items: KnowledgeSourceItemInput[];
    cursorAfter?: string;
    warnings?: string[];
  }): KnowledgeSyncRun {
    const cursorBefore = this.state.getCursor(params.instanceId, params.collectionScope);
    const run = startKnowledgeSyncRun({ sourceInstanceId: params.instanceId, cursorBefore });
    try {
      const stored = upsertKnowledgeSourceItems(params.items);
      this.state.setCursor(params.instanceId, params.collectionScope, params.cursorAfter);
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
    collectionScope: string;
    windowStart?: string;
    signal?: AbortSignal;
  }): Promise<KnowledgeSyncRun> {
    const adapter = this.adapters.get(params.adapterKind);
    if (!adapter) {
      throw new Error(`Knowledge source adapter not found: ${params.adapterKind}`);
    }
    const cursorBefore = this.state.getCursor(params.instanceId, params.collectionScope);
    const run = startKnowledgeSyncRun({
      sourceInstanceId: params.instanceId,
      cursorBefore,
    });
    const controller = params.signal ? null : new AbortController();
    const signal = params.signal ?? controller!.signal;

    try {
      const items: KnowledgeSourceItemInput[] = [];
      const warnings: string[] = [];
      const snapshotExternalIds: string[] = [];
      let snapshotComplete = true;
      let pullCursor = cursorBefore;
      let cursorAfter = cursorBefore;
      for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
        const pulled = await adapter.pull({
          instanceId: params.instanceId,
          collectionScope: params.collectionScope,
          cursor: pullCursor,
          windowStart: params.windowStart,
          signal,
        });
        items.push(...pulled.items);
        warnings.push(...pulled.warnings);
        if (pulled.snapshotExternalIds) snapshotExternalIds.push(...pulled.snapshotExternalIds);
        else snapshotComplete = false;
        cursorAfter = pulled.nextCursor;
        if (!pulled.hasMore) break;
        if (!pulled.nextCursor || pulled.nextCursor === pullCursor) {
          throw new Error('Knowledge source returned an invalid pagination cursor.');
        }
        if (page === MAX_PULL_PAGES - 1) {
          throw new Error(`Knowledge source exceeded the ${MAX_PULL_PAGES}-page safety limit.`);
        }
        pullCursor = pulled.nextCursor;
      }
      const tombstones = deletionInputs(
        params.instanceId,
        params.collectionScope,
        snapshotComplete ? snapshotExternalIds : undefined,
      );
      const stored = upsertKnowledgeSourceItems([...items, ...tombstones]);
      this.state.setCursor(params.instanceId, params.collectionScope, cursorAfter);
      const completed = finishKnowledgeSyncRun({
        runId: run.id,
        status: warnings.length > 0 ? 'partial' : 'succeeded',
        cursorAfter,
        itemsSeen: items.length,
        itemsCreated: stored.created,
        itemsUpdated: stored.updated,
        warnings,
      });
      log.info(
        {
          runId: run.id,
          sourceInstanceId: params.instanceId,
          itemsSeen: items.length,
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
