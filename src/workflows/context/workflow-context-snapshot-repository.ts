import { randomUUID } from 'node:crypto';

import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';

type WorkflowContextSnapshotRow = {
  snapshot_id: string;
  trace_id: string;
  run_id: string;
  project_id: string | null;
  selected_items_json: string;
  estimated_tokens: number;
  content_hash: string;
  created_at: number;
};

export interface WorkflowContextSnapshot<T> {
  id: string;
  traceId: string;
  runId: string;
  projectId?: string;
  selectedItems: T[];
  estimatedTokens: number;
  contentHash: string;
  createdAt: number;
}

export class WorkflowContextSnapshotRepository {
  capture<T>(input: {
    runId: string;
    projectId?: string;
    selectedItems: T[];
    estimatedTokens: number;
    contentHash: string;
    now?: number;
  }): WorkflowContextSnapshot<T> {
    const snapshot: WorkflowContextSnapshot<T> = {
      id: randomUUID(),
      traceId: randomUUID(),
      runId: input.runId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      selectedItems: input.selectedItems,
      estimatedTokens: input.estimatedTokens,
      contentHash: input.contentHash,
      createdAt: input.now ?? Date.now(),
    };
    getSqliteDatabase().prepare(
      `INSERT INTO workflow_context_snapshots (
        snapshot_id, trace_id, run_id, project_id, selected_items_json,
        estimated_tokens, content_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      snapshot.id,
      snapshot.traceId,
      snapshot.runId,
      snapshot.projectId ?? null,
      JSON.stringify(snapshot.selectedItems),
      snapshot.estimatedTokens,
      snapshot.contentHash,
      snapshot.createdAt,
    );
    return snapshot;
  }

  get<T>(id: string): WorkflowContextSnapshot<T> | undefined {
    const row = getSqliteDatabase().prepare(
      `SELECT snapshot_id, trace_id, run_id, project_id, selected_items_json,
       estimated_tokens, content_hash, created_at
       FROM workflow_context_snapshots WHERE snapshot_id = ?`,
    ).get(id) as WorkflowContextSnapshotRow | undefined;
    if (!row) return undefined;
    return {
      id: row.snapshot_id,
      traceId: row.trace_id,
      runId: row.run_id,
      ...(row.project_id ? { projectId: row.project_id } : {}),
      selectedItems: JSON.parse(row.selected_items_json) as T[],
      estimatedTokens: row.estimated_tokens,
      contentHash: row.content_hash,
      createdAt: row.created_at,
    };
  }
}
