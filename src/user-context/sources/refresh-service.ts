import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { createLogger } from '../../utils/logger.js';
import {
  createUnderstandingSourceRun, getUnderstandingSourceGrant, getUnderstandingSourceRun,
  listUnderstandingSourceGrants, listUnderstandingSourceRuns, updateUnderstandingSourceRun,
} from './repository.js';
import type { UnderstandingSourceGrant, UnderstandingSourceItem, UnderstandingSourceRun } from './types.js';

const log = createLogger('UnderstandingRefresh');
const ACTIVE = new Set(['queued', 'running']);
const DESKTOP_WAIT_MS = 120_000;
const ANALYSIS_TIMEOUT_MS = 180_000;

export type RefreshProgress = {
  status: UnderstandingSourceRun['status'];
  phase: 'queued' | 'waiting_desktop' | 'reading' | 'analyzing' | 'completed';
  added?: number;
  updated?: number;
  itemsSeen?: number;
  error?: string;
};
export type RefreshSourceRun = UnderstandingSourceRun & { adapterId: string; displayName: string };
export type RefreshBatch = {
  id: string;
  status: 'running' | 'completed' | 'partial' | 'failed';
  sources: RefreshSourceRun[];
  createdAt: number;
};
export interface UnderstandingRefreshDeps {
  enabled(): boolean;
  start(grant: UnderstandingSourceGrant, runId: string): Promise<Record<string, unknown>>;
  progress(run: UnderstandingSourceRun): RefreshProgress | undefined;
  analyzeDesktop(grant: UnderstandingSourceGrant, items: UnderstandingSourceItem[], signal: AbortSignal): Promise<{
    added?: number; updated?: number;
  }>;
  emit?(type: string, payload: unknown): void;
}

/** Coordinates existing source executors; the source run remains the authority for progress. */
export class UnderstandingRefreshService {
  private readonly owner = randomUUID();
  private readonly starting = new Set<string>();
  private readonly analyzing = new Set<string>();

  constructor(private readonly deps: UnderstandingRefreshDeps) {}

  start(sourceIds?: string[]): RefreshBatch {
    if (!this.deps.enabled()) throw new Error('User understanding is disabled.');
    const grants = listUnderstandingSourceGrants();
    const selected = sourceIds === undefined ? grants : [...new Set(sourceIds)].map((id) => {
      const grant = grants.find((item) => item.id === id);
      if (!grant) throw new Error('An authorized source was not found.');
      return grant;
    });
    if (!selected.length || selected.length > 100) throw new Error('Select between 1 and 100 authorized sources.');
    const id = randomUUID();
    const createdAt = Date.now();
    const runs = runSqliteWriteTransaction((db) => {
      const runs = selected.map((grant) => {
        const active = listUnderstandingSourceRuns(grant.id, 100).find((run) =>
          run.metadata.refresh === true && ACTIVE.has(this.reconcile(run).status));
        return active ?? createUnderstandingSourceRun({
          grantId: grant.id, kind: 'incremental', status: 'queued',
          metadata: { refresh: true, owner: this.owner, phase: 'queued', adapterId: grant.adapterId,
            displayName: grant.displayName, processingPolicy: grant.processingPolicy },
        });
      });
      db.prepare('INSERT INTO understanding_refresh_batches (batch_id, source_run_ids_json, created_at) VALUES (?, ?, ?)')
        .run(id, JSON.stringify(runs.map((run) => run.id)), createdAt);
      return runs;
    });
    for (const run of runs) {
      if (run.status === 'queued' && !this.starting.has(run.id)) void this.dispatch(run);
    }
    return this.get(id)!;
  }

  sources(): RefreshSourceRun[] {
    return listUnderstandingSourceGrants().flatMap((grant) => {
      const saved = listUnderstandingSourceRuns(grant.id, 100).find((run) => run.metadata.refresh === true);
      if (!saved) return [];
      const run = this.reconcile(saved);
      return [{ ...run, adapterId: grant.adapterId, displayName: grant.displayName }];
    });
  }

  latest(): RefreshBatch | null {
    const row = getSqliteDatabase().prepare('SELECT batch_id FROM understanding_refresh_batches ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get() as { batch_id: string } | undefined;
    return row ? this.get(row.batch_id) : null;
  }

  get(id: string): RefreshBatch | null {
    const row = getSqliteDatabase().prepare('SELECT * FROM understanding_refresh_batches WHERE batch_id = ?')
      .get(id) as { batch_id: string; source_run_ids_json: string; created_at: number } | undefined;
    if (!row) return null;
    const sources = (JSON.parse(row.source_run_ids_json) as string[]).flatMap((runId) => {
      const saved = getUnderstandingSourceRun(runId);
      if (!saved) return [];
      const run = this.reconcile(saved);
      return [{ ...run, adapterId: String(run.metadata.adapterId), displayName: String(run.metadata.displayName) }];
    });
    const completed = sources.filter((run) => run.status === 'completed').length;
    const status = sources.some((run) => ACTIVE.has(run.status)) ? 'running'
      : completed === sources.length && completed > 0 ? 'completed'
        : completed || sources.some((run) => run.status === 'partial') ? 'partial' : 'failed';
    return { id, status, sources, createdAt: row.created_at };
  }

  private update(run: UnderstandingSourceRun, progress: RefreshProgress): UnderstandingSourceRun {
    const next = updateUnderstandingSourceRun(run.id, {
      status: progress.status, itemsSeen: progress.itemsSeen,
      ...(progress.error ? { errorMessage: progress.error } : {}),
      completed: !ACTIVE.has(progress.status),
      metadata: { ...run.metadata, phase: progress.phase,
        ...(progress.added === undefined ? {} : { added: progress.added }),
        ...(progress.updated === undefined ? {} : { updated: progress.updated }) },
    })!;
    this.deps.emit?.('understanding.refresh.updated', { runId: run.id, grantId: run.grantId });
    return next;
  }

  private reconcile(run: UnderstandingSourceRun): UnderstandingSourceRun {
    if (!ACTIVE.has(run.status)) return run;
    const grant = getUnderstandingSourceGrant(run.grantId);
    if (!grant || grant.status !== 'active' || grant.processingPolicy !== run.metadata.processingPolicy || !this.deps.enabled()) {
      return this.update(run, { status: 'canceled', phase: 'completed', error: 'Source authorization changed. Retry after reviewing its settings.' });
    }
    const progress = this.deps.progress(run);
    if (progress) {
      if (progress.status !== run.status || progress.phase !== run.metadata.phase || progress.added !== run.metadata.added
        || progress.updated !== run.metadata.updated || (progress.itemsSeen !== undefined && progress.itemsSeen !== run.itemsSeen)) {
        return this.update(run, progress);
      }
      return run;
    }
    if (run.metadata.owner !== this.owner) {
      return this.update(run, { status: 'failed', phase: 'completed', error: 'Update was interrupted. Please retry.' });
    }
    if (run.metadata.phase === 'waiting_desktop' && Date.now() - run.startedAt > DESKTOP_WAIT_MS) {
      return this.update(run, { status: 'failed', phase: 'completed', error: 'Desktop collection did not finish. Open the desktop app and retry.' });
    }
    return run;
  }

  private async dispatch(run: UnderstandingSourceRun): Promise<void> {
    this.starting.add(run.id);
    try {
      const grant = getUnderstandingSourceGrant(run.grantId)!;
      this.update(run, { status: 'running', phase: 'reading' });
      const metadata = await this.deps.start(grant, run.id);
      const latest = getUnderstandingSourceRun(run.id)!;
      updateUnderstandingSourceRun(run.id, { metadata: { ...latest.metadata, ...metadata } });
      this.reconcile(getUnderstandingSourceRun(run.id)!);
    } catch (err) {
      log.warn({ err, runId: run.id, grantId: run.grantId }, 'Understanding refresh could not start');
      this.update(getUnderstandingSourceRun(run.id)!, { status: 'failed', phase: 'completed',
        error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.starting.delete(run.id);
    }
  }

  submitDesktop(runId: string, input: { items: UnderstandingSourceItem[]; error?: string }): void {
    const saved = getUnderstandingSourceRun(runId);
    const run = saved ? this.reconcile(saved) : null;
    if (!run || run.metadata.refresh !== true) throw new Error('Refresh run not found.');
    if (this.analyzing.has(runId) || !ACTIVE.has(run.status)) return;
    if (run.metadata.phase !== 'waiting_desktop') throw new Error('This run is not waiting for desktop collection.');
    const grant = getUnderstandingSourceGrant(run.grantId)!;
    if (input.items.length > 1_200 || input.items.some((item) => item.sourceId !== grant.adapterId)) {
      throw new Error('Collected items must belong to the requested source.');
    }
    if (input.error) {
      this.update(run, { status: 'failed', phase: 'completed', error: input.error.slice(0, 500) });
      return;
    }
    if (!input.items.length) {
      this.update(run, { status: 'completed', phase: 'completed', added: 0, updated: 0, itemsSeen: 0 });
      return;
    }
    this.analyzing.add(runId);
    this.update(run, { status: 'running', phase: 'analyzing', itemsSeen: input.items.length });
    const signal = AbortSignal.timeout(ANALYSIS_TIMEOUT_MS);
    void this.deps.analyzeDesktop(grant, input.items, signal).then((result) => {
      signal.throwIfAborted();
      const current = this.reconcile(getUnderstandingSourceRun(runId)!);
      if (ACTIVE.has(current.status)) this.update(current, { status: 'completed', phase: 'completed', ...result });
    }).catch((err) => {
      log.warn({ err, runId, grantId: grant.id }, 'Understanding refresh analysis failed');
      const current = getUnderstandingSourceRun(runId)!;
      if (ACTIVE.has(current.status)) this.update(current, { status: 'failed', phase: 'completed', error: 'Analysis failed. Please retry.' });
    }).finally(() => this.analyzing.delete(runId));
  }
}
