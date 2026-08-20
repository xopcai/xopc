import { randomUUID } from 'node:crypto';

import type {
  ActorRef,
  TaskAuthorityGrant,
  TaskContextEdge,
  TaskContextRole,
} from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

type ContextEdgeRow = {
  edge_id: string;
  owner_id: string;
  target_kind: TaskContextEdge['targetKind'];
  target_id: string;
  role: TaskContextRole;
  title: string | null;
  pinned: number;
  retrieval_policy_json: string;
  metadata_json: string;
  created_by_json: string;
  created_at: number;
  updated_at: number;
};

type AuthorityGrantRow = {
  grant_id: string;
  task_id: string;
  capability: string;
  scope_json: string;
  granted_by_json: string;
  granted_at: number;
  expires_at: number | null;
  revoked_at: number | null;
};

function edgeFromRow(row: ContextEdgeRow): TaskContextEdge {
  return {
    id: row.edge_id,
    taskId: row.owner_id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    role: row.role,
    ...(row.title ? { title: row.title } : {}),
    pinned: row.pinned === 1,
    retrievalPolicy: JSON.parse(row.retrieval_policy_json) as Record<string, unknown>,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdBy: JSON.parse(row.created_by_json) as ActorRef,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function grantFromRow(row: AuthorityGrantRow): TaskAuthorityGrant {
  return {
    id: row.grant_id,
    taskId: row.task_id,
    capability: row.capability,
    scope: JSON.parse(row.scope_json) as Record<string, unknown>,
    grantedBy: JSON.parse(row.granted_by_json) as ActorRef,
    grantedAt: row.granted_at,
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
  };
}

export class TaskContextRepository {
  captureSnapshot(input: {
    ownerKind: 'task_run' | 'task' | 'session' | 'proactive_run';
    ownerId: string;
    query: string;
    selectedItems?: unknown[];
    rejectedItems?: unknown[];
    consentRequests?: unknown[];
    relationshipPolicy?: Record<string, unknown>;
    authorizationSnapshot?: Record<string, unknown>;
    sessionKey?: string;
    estimatedTokens?: number;
    allocation?: Record<string, unknown>;
    contentHash?: string;
    now?: number;
  }): { id: string; traceId: string } {
    const id = randomUUID();
    const traceId = randomUUID();
    getSqliteDatabase().prepare(
      `INSERT INTO context_snapshots (
        snapshot_id, trace_id, owner_kind, owner_id, session_key, query,
        selected_items_json, rejected_items_json, consent_requests_json,
        relationship_policy_json, estimated_tokens, allocation_json,
        authorization_snapshot_json, content_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      traceId,
      input.ownerKind,
      input.ownerId,
      input.sessionKey ?? null,
      input.query,
      JSON.stringify(input.selectedItems ?? []),
      JSON.stringify(input.rejectedItems ?? []),
      JSON.stringify(input.consentRequests ?? []),
      JSON.stringify(input.relationshipPolicy ?? {}),
      input.estimatedTokens ?? 0,
      input.allocation ? JSON.stringify(input.allocation) : null,
      JSON.stringify(input.authorizationSnapshot ?? {}),
      input.contentHash ?? null,
      input.now ?? Date.now(),
    );
    return { id, traceId };
  }

  add(input: {
    taskId: string;
    targetKind: TaskContextEdge['targetKind'];
    targetId: string;
    role: TaskContextRole;
    title?: string;
    pinned?: boolean;
    retrievalPolicy?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    createdBy: ActorRef;
    now?: number;
  }): TaskContextEdge {
    const now = input.now ?? Date.now();
    const id = randomUUID();
    getSqliteDatabase().prepare(
      `INSERT INTO context_edges (
        edge_id, owner_kind, owner_id, target_kind, target_id, role, title,
        pinned, retrieval_policy_json, metadata_json, created_by_json,
        created_at, updated_at
      ) VALUES (?, 'task', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_kind, owner_id, target_kind, target_id, role)
      DO UPDATE SET title = excluded.title, pinned = excluded.pinned,
        retrieval_policy_json = excluded.retrieval_policy_json,
        metadata_json = excluded.metadata_json, updated_at = excluded.updated_at`,
    ).run(
      id,
      input.taskId,
      input.targetKind,
      input.targetId,
      input.role,
      input.title?.trim() || null,
      input.pinned ? 1 : 0,
      JSON.stringify(input.retrievalPolicy ?? {}),
      JSON.stringify(input.metadata ?? {}),
      JSON.stringify(input.createdBy),
      now,
      now,
    );
    const edge = getSqliteDatabase().prepare(
      `SELECT * FROM context_edges WHERE owner_kind = 'task' AND owner_id = ?
       AND target_kind = ? AND target_id = ? AND role = ?`,
    ).get(input.taskId, input.targetKind, input.targetId, input.role) as ContextEdgeRow;
    return edgeFromRow(edge);
  }

  list(taskId: string): TaskContextEdge[] {
    return (getSqliteDatabase().prepare(
      `SELECT * FROM context_edges WHERE owner_kind = 'task' AND owner_id = ?
       ORDER BY pinned DESC, created_at ASC`,
    ).all(taskId) as ContextEdgeRow[]).map(edgeFromRow);
  }

  remove(taskId: string, edgeId: string): boolean {
    return getSqliteDatabase().prepare(
      `DELETE FROM context_edges WHERE edge_id = ? AND owner_kind = 'task' AND owner_id = ?`,
    ).run(edgeId, taskId).changes > 0;
  }

  grant(input: {
    taskId: string;
    capability: string;
    scope?: Record<string, unknown>;
    grantedBy: ActorRef;
    expiresAt?: number;
    now?: number;
  }): TaskAuthorityGrant {
    const id = randomUUID();
    const now = input.now ?? Date.now();
    getSqliteDatabase().prepare(
      `INSERT INTO task_authority_grants (
        grant_id, task_id, capability, scope_json, granted_by_json,
        granted_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.taskId,
      input.capability,
      JSON.stringify(input.scope ?? {}),
      JSON.stringify(input.grantedBy),
      now,
      input.expiresAt ?? null,
    );
    return this.requireGrant(id);
  }

  listActiveGrants(taskId: string, now = Date.now()): TaskAuthorityGrant[] {
    return (getSqliteDatabase().prepare(
      `SELECT * FROM task_authority_grants WHERE task_id = ? AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?) ORDER BY granted_at ASC`,
    ).all(taskId, now) as AuthorityGrantRow[]).map(grantFromRow);
  }

  revoke(grantId: string, now = Date.now()): boolean {
    return getSqliteDatabase().prepare(
      `UPDATE task_authority_grants SET revoked_at = ?
       WHERE grant_id = ? AND revoked_at IS NULL`,
    ).run(now, grantId).changes > 0;
  }

  linkSession(input: {
    taskId: string;
    sessionKey: string;
    role: 'primary' | 'discussion' | 'execution';
    now?: number;
  }): void {
    getSqliteDatabase().prepare(
      `INSERT OR IGNORE INTO task_sessions (task_session_id, task_id, session_key, role, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(randomUUID(), input.taskId, input.sessionKey, input.role, input.now ?? Date.now());
  }

  private requireGrant(id: string): TaskAuthorityGrant {
    const row = getSqliteDatabase().prepare(
      'SELECT * FROM task_authority_grants WHERE grant_id = ?',
    ).get(id) as AuthorityGrantRow | undefined;
    if (!row) throw new Error(`Task authority grant not found: ${id}`);
    return grantFromRow(row);
  }
}
