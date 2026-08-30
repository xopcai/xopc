import { randomUUID } from 'node:crypto';

import { USER_CONTEXT_PRINCIPAL_ID } from '../../user-context/domain.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export type ContextExtractionStatus = 'running' | 'completed' | 'skipped' | 'failed';
export type ContextObjectType = 'profile' | 'rule' | 'focus' | 'understanding';

export type ContextExtractionRun = {
  id: string;
  principalId: string;
  sourceRef: string;
  extractorId: string;
  extractorVersion: string;
  processingPolicy: 'local_only' | 'remote_allowed';
  destination: 'deterministic' | 'local_model' | 'remote_model';
  inputHash: string;
  status: ContextExtractionStatus;
  errorCode?: string;
  startedAt: number;
  completedAt?: number;
};

export type ContextExtractionOutput = {
  id: string;
  runId: string;
  ordinal: number;
  candidateKey: string;
  objectType?: ContextObjectType;
  objectId?: string;
  versionId?: string;
  outcome: 'created' | 'deduplicated' | 'rejected';
  createdAt: number;
};

type RunRow = {
  extraction_run_id: string; principal_id: string; source_ref: string; extractor_id: string;
  extractor_version: string; processing_policy: ContextExtractionRun['processingPolicy'];
  destination: ContextExtractionRun['destination']; input_hash: string; status: ContextExtractionStatus;
  error_code: string | null; started_at: number; completed_at: number | null;
};

type OutputRow = {
  output_id: string; extraction_run_id: string; ordinal: number; candidate_key: string;
  object_type: ContextObjectType | null; object_id: string | null; version_id: string | null;
  outcome: ContextExtractionOutput['outcome']; created_at: number;
};

function runFromRow(row: RunRow): ContextExtractionRun {
  return {
    id: row.extraction_run_id, principalId: row.principal_id, sourceRef: row.source_ref,
    extractorId: row.extractor_id, extractorVersion: row.extractor_version,
    processingPolicy: row.processing_policy, destination: row.destination, inputHash: row.input_hash,
    status: row.status, ...(row.error_code ? { errorCode: row.error_code } : {}),
    startedAt: row.started_at, ...(row.completed_at == null ? {} : { completedAt: row.completed_at }),
  };
}

function outputFromRow(row: OutputRow): ContextExtractionOutput {
  return {
    id: row.output_id, runId: row.extraction_run_id, ordinal: row.ordinal,
    candidateKey: row.candidate_key,
    ...(row.object_type ? { objectType: row.object_type } : {}),
    ...(row.object_id ? { objectId: row.object_id } : {}),
    ...(row.version_id ? { versionId: row.version_id } : {}),
    outcome: row.outcome, createdAt: row.created_at,
  };
}

export function claimContextExtractionRun(input: {
  sourceRef: string;
  extractorId: string;
  extractorVersion: string;
  processingPolicy: ContextExtractionRun['processingPolicy'];
  destination: ContextExtractionRun['destination'];
  inputHash: string;
  principalId?: string;
  nowMs?: number;
}): { run: ContextExtractionRun; shouldExecute: boolean } {
  const principalId = input.principalId ?? USER_CONTEXT_PRINCIPAL_ID;
  const now = input.nowMs ?? Date.now();
  return runSqliteWriteTransaction((db) => {
    const existing = db.prepare(`SELECT * FROM context_extraction_runs
      WHERE principal_id = ? AND source_ref = ? AND extractor_id = ? AND extractor_version = ?`)
      .get(principalId, input.sourceRef, input.extractorId, input.extractorVersion) as RunRow | undefined;
    if (existing) {
      if (existing.input_hash !== input.inputHash) {
        throw new Error('Extraction source changed without a new source reference');
      }
      if (existing.status !== 'failed') return { run: runFromRow(existing), shouldExecute: false };
      db.prepare(`UPDATE context_extraction_runs
        SET status = 'running', error_code = NULL, started_at = ?, completed_at = NULL
        WHERE extraction_run_id = ?`).run(now, existing.extraction_run_id);
      const retried = db.prepare('SELECT * FROM context_extraction_runs WHERE extraction_run_id = ?')
        .get(existing.extraction_run_id) as RunRow;
      return { run: runFromRow(retried), shouldExecute: true };
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO context_extraction_runs (
      extraction_run_id, principal_id, source_ref, extractor_id, extractor_version,
      processing_policy, destination, input_hash, status, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`).run(
      id, principalId, input.sourceRef, input.extractorId, input.extractorVersion,
      input.processingPolicy, input.destination, input.inputHash, now,
    );
    const row = db.prepare('SELECT * FROM context_extraction_runs WHERE extraction_run_id = ?').get(id) as RunRow;
    return { run: runFromRow(row), shouldExecute: true };
  });
}

export function finishContextExtractionRun(input: {
  runId: string;
  status: Exclude<ContextExtractionStatus, 'running'>;
  errorCode?: string;
  outputs?: Array<Omit<ContextExtractionOutput, 'id' | 'runId' | 'ordinal' | 'createdAt'>>;
  nowMs?: number;
}): ContextExtractionRun | null {
  const now = input.nowMs ?? Date.now();
  return runSqliteWriteTransaction((db) => {
    const result = db.prepare(`UPDATE context_extraction_runs SET status = ?, error_code = ?, completed_at = ?
      WHERE extraction_run_id = ?`).run(input.status, input.errorCode ?? null, now, input.runId);
    if (!result.changes) return null;
    db.prepare('DELETE FROM context_extraction_outputs WHERE extraction_run_id = ?').run(input.runId);
    const insert = db.prepare(`INSERT INTO context_extraction_outputs (
      output_id, extraction_run_id, ordinal, candidate_key, object_type, object_id,
      version_id, outcome, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const [ordinal, output] of (input.outputs ?? []).entries()) {
      insert.run(randomUUID(), input.runId, ordinal, output.candidateKey, output.objectType ?? null,
        output.objectId ?? null, output.versionId ?? null, output.outcome, now);
    }
    return runFromRow(db.prepare('SELECT * FROM context_extraction_runs WHERE extraction_run_id = ?')
      .get(input.runId) as RunRow);
  });
}

export function listContextExtractionRuns(filter: {
  sourceRef?: string;
  extractorId?: string;
  extractorVersion?: string;
  status?: ContextExtractionStatus;
  limit?: number;
} = {}): ContextExtractionRun[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (filter.sourceRef) { clauses.push('source_ref = ?'); values.push(filter.sourceRef); }
  if (filter.extractorId) { clauses.push('extractor_id = ?'); values.push(filter.extractorId); }
  if (filter.extractorVersion) { clauses.push('extractor_version = ?'); values.push(filter.extractorVersion); }
  if (filter.status) { clauses.push('status = ?'); values.push(filter.status); }
  values.push(Math.max(1, Math.min(500, filter.limit ?? 100)));
  return (getSqliteDatabase().prepare(`SELECT * FROM context_extraction_runs
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY started_at DESC LIMIT ?`)
    .all(...values) as unknown as RunRow[]).map(runFromRow);
}

export function getContextExtractionRun(id: string): ContextExtractionRun | null {
  const row = getSqliteDatabase().prepare('SELECT * FROM context_extraction_runs WHERE extraction_run_id = ?')
    .get(id) as RunRow | undefined;
  return row ? runFromRow(row) : null;
}

export function listContextExtractionOutputs(runId: string): ContextExtractionOutput[] {
  return (getSqliteDatabase().prepare(`SELECT * FROM context_extraction_outputs
    WHERE extraction_run_id = ? ORDER BY ordinal`).all(runId) as unknown as OutputRow[]).map(outputFromRow);
}

export function hasIndependentExtractionOutput(runIds: string[], objectType: ContextObjectType, objectId: string): boolean {
  if (!runIds.length) return false;
  const placeholders = runIds.map(() => '?').join(', ');
  return Boolean(getSqliteDatabase().prepare(`SELECT 1 FROM context_extraction_outputs o
    JOIN context_extraction_runs r ON r.extraction_run_id = o.extraction_run_id
    WHERE o.extraction_run_id NOT IN (${placeholders}) AND o.object_type = ? AND o.object_id = ?
      AND r.status = 'completed' LIMIT 1`).get(...runIds, objectType, objectId));
}
