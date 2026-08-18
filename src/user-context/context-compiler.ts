import { randomUUID } from 'node:crypto';

import type { UserContextPlan } from '../agent/memory/context/types.js';
import {
  getRelationshipSettings,
  getSqliteDatabase,
  runSqliteWriteTransaction,
  type RelationshipSettings,
} from '../storage/sqlite/index.js';

export interface ContextSnapshot {
  id: string;
  traceId: string;
  sessionKey: string;
  query: string;
  selectedItems: UserContextPlan['items'];
  rejectedItems: UserContextPlan['rejected'];
  consentRequests: UserContextPlan['consentRequests'];
  relationshipPolicy: RelationshipSettings;
  estimatedTokens: number;
  allocation?: UserContextPlan['allocation'];
  outcomeId?: string;
  runId?: string;
  createdAt: number;
}

type ContextSnapshotRow = {
  snapshot_id: string;
  trace_id: string;
  session_key: string;
  query: string;
  selected_items_json: string;
  rejected_items_json: string;
  consent_requests_json: string;
  relationship_policy_json: string;
  estimated_tokens: number;
  allocation_json: string | null;
  outcome_id: string | null;
  run_id: string | null;
  created_at: number;
};

function fromRow(row: ContextSnapshotRow): ContextSnapshot {
  return {
    id: row.snapshot_id,
    traceId: row.trace_id,
    sessionKey: row.session_key,
    query: row.query,
    selectedItems: JSON.parse(row.selected_items_json) as UserContextPlan['items'],
    rejectedItems: JSON.parse(row.rejected_items_json) as UserContextPlan['rejected'],
    consentRequests: JSON.parse(row.consent_requests_json) as UserContextPlan['consentRequests'],
    relationshipPolicy: JSON.parse(row.relationship_policy_json) as RelationshipSettings,
    estimatedTokens: row.estimated_tokens,
    ...(row.allocation_json
      ? { allocation: JSON.parse(row.allocation_json) as UserContextPlan['allocation'] }
      : {}),
    ...(row.outcome_id ? { outcomeId: row.outcome_id } : {}),
    ...(row.run_id ? { runId: row.run_id } : {}),
    createdAt: row.created_at,
  };
}

export class ContextCompiler {
  capture(input: {
    sessionKey: string;
    query: string;
    plan: UserContextPlan;
    now?: number;
  }): ContextSnapshot {
    const now = input.now ?? Date.now();
    const id = randomUUID();
    runSqliteWriteTransaction((db) => {
      db.prepare(
        `INSERT INTO context_snapshots (
          snapshot_id, trace_id, session_key, query, selected_items_json,
          rejected_items_json, consent_requests_json, relationship_policy_json,
          estimated_tokens, allocation_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.plan.traceId,
        input.sessionKey,
        input.query.trim(),
        JSON.stringify(input.plan.items),
        JSON.stringify(input.plan.rejected),
        JSON.stringify(input.plan.consentRequests),
        JSON.stringify(getRelationshipSettings()),
        input.plan.estimatedTokens,
        input.plan.allocation ? JSON.stringify(input.plan.allocation) : null,
        now,
      );
    });
    return this.get(id)!;
  }

  get(id: string): ContextSnapshot | undefined {
    const row = getSqliteDatabase().prepare(
      'SELECT * FROM context_snapshots WHERE snapshot_id = ?',
    ).get(id) as ContextSnapshotRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  latestForSession(sessionKey: string, since = 0): ContextSnapshot | undefined {
    const row = getSqliteDatabase().prepare(
      `SELECT * FROM context_snapshots
       WHERE session_key = ? AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1`,
    ).get(sessionKey, since) as ContextSnapshotRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  linkToRun(input: { snapshotId: string; outcomeId?: string; runId: string }): ContextSnapshot | undefined {
    getSqliteDatabase().prepare(
      `UPDATE context_snapshots SET outcome_id = ?, run_id = ? WHERE snapshot_id = ?`,
    ).run(input.outcomeId ?? null, input.runId, input.snapshotId);
    return this.get(input.snapshotId);
  }
}
