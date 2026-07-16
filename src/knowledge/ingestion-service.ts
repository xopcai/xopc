import { createLogger } from '../utils/logger.js';
import {
  finishKnowledgeSyncRun,
  getKnowledgeSourceCursor,
  setKnowledgeSourceCursor,
  startKnowledgeSyncRun,
  upsertKnowledgeSourceItems,
} from '../storage/sqlite/knowledge-repository.js';
import type { KnowledgeSourceAdapter, KnowledgeSyncRun } from './types.js';

const log = createLogger('KnowledgeIngestion');

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
      const stored = upsertKnowledgeSourceItems(pulled.items);
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
