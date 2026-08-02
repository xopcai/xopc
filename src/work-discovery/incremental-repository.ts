import { randomUUID } from 'node:crypto';

import { requireXopcDatabase } from '../storage/sqlite/connection.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import type { WorkDiscoveryPreview, WorkDiscoverySourceRefresh } from './types.js';
import { workDiscoveryFingerprintsEqual } from './incremental.js';

interface RefreshRow {
  refresh_id: string;
  source_id: string;
  discovery_run_id: string | null;
  changed: number;
  previous_fingerprint_json: string | null;
  current_fingerprint_json: string;
  status: string;
  checked_at: number;
}

function parseFingerprint(value: string | null): WorkDiscoveryPreview['fingerprint'] | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as WorkDiscoveryPreview['fingerprint'];
  } catch {
    return undefined;
  }
}

function fromRow(row: RefreshRow): WorkDiscoverySourceRefresh {
  return {
    id: row.refresh_id,
    sourceId: row.source_id,
    changed: row.changed === 1,
    ...(parseFingerprint(row.previous_fingerprint_json)
      ? { previousFingerprint: parseFingerprint(row.previous_fingerprint_json) }
      : {}),
    currentFingerprint: parseFingerprint(row.current_fingerprint_json)!,
    status: row.status as WorkDiscoverySourceRefresh['status'],
    ...(row.discovery_run_id ? { discoveryRunId: row.discovery_run_id } : {}),
    checkedAt: row.checked_at,
  };
}

export function recordWorkDiscoverySourceRefresh(input: {
  sourceId: string;
  changed: boolean;
  previousFingerprint?: WorkDiscoveryPreview['fingerprint'];
  currentFingerprint: WorkDiscoveryPreview['fingerprint'];
  status?: WorkDiscoverySourceRefresh['status'];
  discoveryRunId?: string;
  checkedAt?: number;
}): WorkDiscoverySourceRefresh {
  const id = randomUUID();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO work_discovery_source_refreshes (
        refresh_id, source_id, discovery_run_id, changed, previous_fingerprint_json,
        current_fingerprint_json, status, checked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.sourceId,
      input.discoveryRunId ?? null,
      input.changed ? 1 : 0,
      input.previousFingerprint ? JSON.stringify(input.previousFingerprint) : null,
      JSON.stringify(input.currentFingerprint),
      input.status ?? 'checked',
      input.checkedAt ?? Date.now(),
    );
  });
  const { db } = requireXopcDatabase();
  return fromRow(db.prepare('SELECT * FROM work_discovery_source_refreshes WHERE refresh_id = ?')
    .get(id) as unknown as RefreshRow);
}

export function listWorkDiscoverySourceRefreshes(sourceId: string, limit = 20): WorkDiscoverySourceRefresh[] {
  const { db } = requireXopcDatabase();
  const rows = db.prepare(
    'SELECT * FROM work_discovery_source_refreshes WHERE source_id = ? ORDER BY checked_at DESC LIMIT ?',
  ).all(sourceId, Math.max(1, Math.min(100, limit))) as unknown as RefreshRow[];
  return rows.map(fromRow);
}

export function findActiveWorkDiscoverySourceRefresh(
  sourceId: string,
  fingerprint: WorkDiscoveryPreview['fingerprint'],
): WorkDiscoverySourceRefresh | null {
  const { db } = requireXopcDatabase();
  const rows = db.prepare(
    `SELECT refresh.* FROM work_discovery_source_refreshes refresh
     JOIN work_discovery_runs run ON run.id = refresh.discovery_run_id
     WHERE refresh.source_id = ? AND refresh.status = 'queued'
       AND run.status IN ('queued', 'probing', 'analyzing')
     ORDER BY refresh.checked_at DESC`,
  ).all(sourceId) as unknown as RefreshRow[];
  return rows.map(fromRow).find((refresh) =>
    workDiscoveryFingerprintsEqual(refresh.currentFingerprint, fingerprint)) ?? null;
}

export function updateWorkDiscoverySourceRefreshForRun(
  runId: string,
  status: 'completed' | 'failed',
): void {
  runSqliteWriteTransaction((db) => {
    db.prepare('UPDATE work_discovery_source_refreshes SET status = ? WHERE discovery_run_id = ?')
      .run(status, runId);
  });
}
