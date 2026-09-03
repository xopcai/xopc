import { randomUUID } from 'node:crypto';

import type { SnapshotArtifact } from '../execution-artifacts/snapshot-artifact-store.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { ExecutionEnvironmentConflictError } from './types.js';

export const EXECUTION_ENVIRONMENT_HANDOFF_STATUSES = [
  'preparing',
  'switching',
  'cleanup_pending',
  'completed',
  'failed',
] as const;

export type ExecutionEnvironmentHandoffStatus =
  (typeof EXECUTION_ENVIRONMENT_HANDOFF_STATUSES)[number];

export interface ExecutionEnvironmentHandoff {
  id: string;
  sessionKey: string;
  sourceEnvironmentId: string;
  targetEnvironmentId: string;
  targetHostId: string;
  sourceBindingId: string;
  sourceBindingEpoch: number;
  baseSha?: string;
  artifact?: SnapshotArtifact;
  status: ExecutionEnvironmentHandoffStatus;
  version: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface ExecutionEnvironmentHandoffEvent {
  id: string;
  handoffId: string;
  fromStatus?: ExecutionEnvironmentHandoffStatus;
  toStatus: ExecutionEnvironmentHandoffStatus;
  message: string;
  createdAt: number;
}

type HandoffRow = {
  handoff_id: string;
  session_key: string;
  source_environment_id: string;
  target_environment_id: string;
  target_host_id: string;
  source_binding_id: string;
  source_binding_epoch: number;
  base_sha: string | null;
  artifact_id: string | null;
  artifact_size: number | null;
  artifact_sha256: string | null;
  status: ExecutionEnvironmentHandoffStatus;
  version: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

type HandoffEventRow = {
  event_id: string;
  handoff_id: string;
  from_status: ExecutionEnvironmentHandoffStatus | null;
  to_status: ExecutionEnvironmentHandoffStatus;
  message: string;
  created_at: number;
};

const ALLOWED_TRANSITIONS: Record<ExecutionEnvironmentHandoffStatus, readonly ExecutionEnvironmentHandoffStatus[]> = {
  preparing: ['preparing', 'switching', 'cleanup_pending', 'failed'],
  switching: ['switching', 'cleanup_pending', 'failed'],
  cleanup_pending: ['cleanup_pending', 'completed'],
  completed: [],
  failed: [],
};

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function fromRow(row: HandoffRow): ExecutionEnvironmentHandoff {
  return {
    id: row.handoff_id,
    sessionKey: row.session_key,
    sourceEnvironmentId: row.source_environment_id,
    targetEnvironmentId: row.target_environment_id,
    targetHostId: row.target_host_id,
    sourceBindingId: row.source_binding_id,
    sourceBindingEpoch: row.source_binding_epoch,
    ...(row.base_sha ? { baseSha: row.base_sha } : {}),
    ...(row.artifact_id && row.artifact_size != null && row.artifact_sha256 && row.base_sha ? {
      artifact: {
        artifactId: row.artifact_id,
        baseSha: row.base_sha,
        size: row.artifact_size,
        sha256: row.artifact_sha256,
      },
    } : {}),
    status: row.status,
    version: row.version,
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at == null ? {} : { completedAt: row.completed_at }),
  };
}

function getRow(id: string): HandoffRow | undefined {
  return getSqliteDatabase().prepare(
    'SELECT * FROM execution_environment_handoffs WHERE handoff_id = ?',
  ).get(id) as HandoffRow | undefined;
}

export class ExecutionEnvironmentHandoffStore {
  create(input: {
    id?: string;
    sessionKey: string;
    sourceEnvironmentId: string;
    targetEnvironmentId: string;
    targetHostId: string;
    sourceBindingId: string;
    sourceBindingEpoch: number;
  }): ExecutionEnvironmentHandoff {
    const id = input.id?.trim() || randomUUID();
    const now = Date.now();
    runSqliteWriteTransaction((db) => {
        const active = db.prepare(`
          SELECT handoff_id FROM execution_environment_handoffs
          WHERE session_key = ? AND status IN ('preparing', 'switching', 'cleanup_pending')
          LIMIT 1
        `).get(requiredText(input.sessionKey, 'sessionKey')) as { handoff_id: string } | undefined;
        if (active) {
          throw new ExecutionEnvironmentConflictError(`Session ${input.sessionKey} already has an active handoff`);
        }
        db.prepare(`
          INSERT INTO execution_environment_handoffs (
            handoff_id, session_key, source_environment_id, target_environment_id,
            target_host_id, source_binding_id, source_binding_epoch,
            status, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'preparing', 1, ?, ?)
        `).run(
          id,
          requiredText(input.sessionKey, 'sessionKey'),
          requiredText(input.sourceEnvironmentId, 'sourceEnvironmentId'),
          requiredText(input.targetEnvironmentId, 'targetEnvironmentId'),
          requiredText(input.targetHostId, 'targetHostId'),
          requiredText(input.sourceBindingId, 'sourceBindingId'),
          input.sourceBindingEpoch,
          now,
          now,
        );
        db.prepare(`
          INSERT INTO execution_environment_handoff_events (
            event_id, handoff_id, from_status, to_status, message, created_at
          ) VALUES (?, ?, NULL, 'preparing', 'handoff requested', ?)
        `).run(randomUUID(), id, now);
    });
    return this.getRequired(id);
  }

  get(id: string): ExecutionEnvironmentHandoff | undefined {
    const row = getRow(id);
    return row ? fromRow(row) : undefined;
  }

  getRequired(id: string): ExecutionEnvironmentHandoff {
    const handoff = this.get(id);
    if (!handoff) throw new Error(`Execution environment handoff not found: ${id}`);
    return handoff;
  }

  getActiveForSession(sessionKey: string): ExecutionEnvironmentHandoff | undefined {
    const row = getSqliteDatabase().prepare(`
      SELECT * FROM execution_environment_handoffs
      WHERE session_key = ? AND status IN ('preparing', 'switching', 'cleanup_pending')
      ORDER BY created_at DESC LIMIT 1
    `).get(sessionKey) as HandoffRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  getActiveForEnvironment(environmentId: string): ExecutionEnvironmentHandoff | undefined {
    const row = getSqliteDatabase().prepare(`
      SELECT * FROM execution_environment_handoffs
      WHERE (source_environment_id = ? OR target_environment_id = ?)
        AND status IN ('preparing', 'switching', 'cleanup_pending')
      ORDER BY created_at DESC LIMIT 1
    `).get(environmentId, environmentId) as HandoffRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  update(input: {
    id: string;
    expectedVersion: number;
    toStatus: ExecutionEnvironmentHandoffStatus;
    message: string;
    baseSha?: string;
    artifact?: SnapshotArtifact;
    error?: string;
  }): ExecutionEnvironmentHandoff {
    const message = requiredText(input.message, 'message');
    const now = Date.now();
    runSqliteWriteTransaction((db) => {
      const row = getRow(input.id);
      if (!row) throw new Error(`Execution environment handoff not found: ${input.id}`);
      if (row.version !== input.expectedVersion) {
        throw new ExecutionEnvironmentConflictError(`Execution environment handoff ${input.id} changed concurrently`);
      }
      if (!ALLOWED_TRANSITIONS[row.status].includes(input.toStatus)) {
        throw new ExecutionEnvironmentConflictError(`Cannot transition handoff from ${row.status} to ${input.toStatus}`);
      }
      const completedAt = input.toStatus === 'completed' || input.toStatus === 'failed' ? now : null;
      const updated = db.prepare(`
        UPDATE execution_environment_handoffs
        SET status = ?, base_sha = COALESCE(?, base_sha),
            artifact_id = COALESCE(?, artifact_id),
            artifact_size = COALESCE(?, artifact_size),
            artifact_sha256 = COALESCE(?, artifact_sha256),
            last_error = ?,
            version = version + 1, updated_at = ?, completed_at = ?
        WHERE handoff_id = ? AND version = ?
      `).run(
        input.toStatus,
        input.baseSha?.trim() || null,
        input.artifact?.artifactId ?? null,
        input.artifact?.size ?? null,
        input.artifact?.sha256 ?? null,
        input.error?.trim() || null,
        now,
        completedAt,
        input.id,
        input.expectedVersion,
      );
      if (updated.changes !== 1) {
        throw new ExecutionEnvironmentConflictError(`Execution environment handoff ${input.id} changed concurrently`);
      }
      db.prepare(`
        INSERT INTO execution_environment_handoff_events (
          event_id, handoff_id, from_status, to_status, message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), input.id, row.status, input.toStatus, message, now);
    });
    return this.getRequired(input.id);
  }

  listEvents(handoffId: string): ExecutionEnvironmentHandoffEvent[] {
    const rows = getSqliteDatabase().prepare(`
      SELECT * FROM execution_environment_handoff_events
      WHERE handoff_id = ? ORDER BY created_at, rowid
    `).all(handoffId) as HandoffEventRow[];
    return rows.map((row) => ({
      id: row.event_id,
      handoffId: row.handoff_id,
      ...(row.from_status ? { fromStatus: row.from_status } : {}),
      toStatus: row.to_status,
      message: row.message,
      createdAt: row.created_at,
    }));
  }
}
