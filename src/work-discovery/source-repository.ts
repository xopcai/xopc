import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { requireXopcDatabase } from '../storage/sqlite/connection.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import type { WorkDiscoveryDirectorySource, WorkDiscoveryPreview } from './types.js';

interface SourceRow {
  source_id: string;
  kind: string;
  root_path: string | null;
  display_name: string;
  status: string;
  scope_json: string;
  fingerprint_json: string | null;
  last_scanned_at: number | null;
  created_at: number;
  updated_at: number;
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function directorySource(row: SourceRow): WorkDiscoveryDirectorySource | null {
  if (row.kind !== 'directory' || !row.root_path) return null;
  return {
    id: row.source_id,
    kind: 'directory',
    rootPath: row.root_path,
    displayName: row.display_name,
    status: row.status === 'revoked' ? 'revoked' : 'active',
    scope: { readOnly: true },
    ...(parseJson<WorkDiscoveryPreview['fingerprint']>(row.fingerprint_json)
      ? { fingerprint: parseJson<WorkDiscoveryPreview['fingerprint']>(row.fingerprint_json) }
      : {}),
    ...(row.last_scanned_at != null ? { lastScannedAt: row.last_scanned_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readDirectorySource(db: DatabaseSync, id: string): WorkDiscoveryDirectorySource | null {
  const row = db.prepare('SELECT * FROM work_discovery_sources WHERE source_id = ?').get(id) as unknown as SourceRow | undefined;
  return row ? directorySource(row) : null;
}

export function listWorkDiscoveryDirectorySources(options: { includeRevoked?: boolean } = {}): WorkDiscoveryDirectorySource[] {
  const { db } = requireXopcDatabase();
  const rows = db.prepare(
    `SELECT * FROM work_discovery_sources
     WHERE kind = 'directory' ${options.includeRevoked ? '' : "AND status = 'active'"}
     ORDER BY updated_at DESC`,
  ).all() as unknown as SourceRow[];
  return rows.flatMap((row) => {
    const source = directorySource(row);
    return source ? [source] : [];
  });
}

export function getWorkDiscoveryDirectorySource(id: string): WorkDiscoveryDirectorySource | null {
  const { db } = requireXopcDatabase();
  return readDirectorySource(db, id);
}

export function upsertWorkDiscoveryDirectorySource(input: {
  rootPath: string;
  displayName: string;
  fingerprint?: WorkDiscoveryPreview['fingerprint'];
  scanned?: boolean;
  nowMs?: number;
}): WorkDiscoveryDirectorySource {
  const now = input.nowMs ?? Date.now();
  const id = randomUUID();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO work_discovery_sources (
        source_id, kind, root_path, display_name, status, scope_json, fingerprint_json,
        last_scanned_at, created_at, updated_at
      ) VALUES (?, 'directory', ?, ?, 'active', ?, ?, ?, ?, ?)
      ON CONFLICT(kind, root_path) DO UPDATE SET
        display_name = excluded.display_name,
        status = 'active',
        scope_json = excluded.scope_json,
        fingerprint_json = COALESCE(excluded.fingerprint_json, work_discovery_sources.fingerprint_json),
        last_scanned_at = COALESCE(excluded.last_scanned_at, work_discovery_sources.last_scanned_at),
        updated_at = excluded.updated_at`,
    ).run(
      id,
      input.rootPath,
      input.displayName,
      JSON.stringify({ readOnly: true }),
      input.fingerprint ? JSON.stringify(input.fingerprint) : null,
      input.scanned ? now : null,
      now,
      now,
    );
  });
  const { db } = requireXopcDatabase();
  const row = db.prepare(
    `SELECT * FROM work_discovery_sources WHERE kind = 'directory' AND root_path = ?`,
  ).get(input.rootPath) as unknown as SourceRow;
  return directorySource(row)!;
}

export function revokeWorkDiscoveryDirectorySource(id: string, nowMs = Date.now()): WorkDiscoveryDirectorySource | null {
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE work_discovery_sources SET status = 'revoked', updated_at = ?
       WHERE source_id = ? AND kind = 'directory'`,
    ).run(nowMs, id);
  });
  return getWorkDiscoveryDirectorySource(id);
}
