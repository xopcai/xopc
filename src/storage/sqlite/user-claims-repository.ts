import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export type UserEntityType = 'person' | 'project' | 'organization';
export type UserEntityHandleType = 'email' | 'provider_user' | 'display_name';
export type UserClaimClass = 'relationship' | 'project' | 'routine';
export type UserClaimState = 'provisional' | 'active' | 'rejected' | 'stale';
export type UserClaimUserState = 'auto' | 'confirmed' | 'rejected';

export type UserEntity = {
  id: string;
  type: UserEntityType;
  canonicalLabel: string;
  createdAt: string;
  updatedAt: string;
};

export type UserClaim = {
  id: string;
  agentId: string;
  class: UserClaimClass;
  key: string;
  subjectEntityId?: string;
  value: Record<string, unknown>;
  state: UserClaimState;
  userState: UserClaimUserState;
  confidence: number;
  independentEvidenceCount: number;
  activeDayCount: number;
  firstObservedAt: string;
  lastReinforcedAt: string;
  memoryRecordId?: string;
  createdAt: string;
  updatedAt: string;
};

type EntityRow = {
  entity_id: string; entity_type: UserEntityType; canonical_label: string; created_at: number; updated_at: number;
};
type ClaimRow = {
  claim_id: string; agent_id: string; claim_class: UserClaimClass; claim_key: string;
  subject_entity_id: string | null; value_json: string; state: UserClaimState; user_state: UserClaimUserState;
  confidence: number; independent_evidence_count: number; active_day_count: number;
  first_observed_at: number; last_reinforced_at: number; memory_record_id: string | null;
  created_at: number; updated_at: number;
};

function entityFromRow(row: EntityRow): UserEntity {
  return {
    id: row.entity_id, type: row.entity_type, canonicalLabel: row.canonical_label,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function claimFromRow(row: ClaimRow): UserClaim {
  return {
    id: row.claim_id,
    agentId: row.agent_id,
    class: row.claim_class,
    key: row.claim_key,
    ...(row.subject_entity_id ? { subjectEntityId: row.subject_entity_id } : {}),
    value: JSON.parse(row.value_json) as Record<string, unknown>,
    state: row.state,
    userState: row.user_state,
    confidence: row.confidence,
    independentEvidenceCount: row.independent_evidence_count,
    activeDayCount: row.active_day_count,
    firstObservedAt: new Date(row.first_observed_at).toISOString(),
    lastReinforcedAt: new Date(row.last_reinforced_at).toISOString(),
    ...(row.memory_record_id ? { memoryRecordId: row.memory_record_id } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function resolveUserEntity(input: {
  type: UserEntityType;
  canonicalLabel: string;
  handles: Array<{ type: UserEntityHandleType; value: string; sourceScope: string; verified: boolean }>;
  nowMs?: number;
}): UserEntity {
  const now = input.nowMs ?? Date.now();
  return runSqliteWriteTransaction((db) => {
    const handles = input.handles
      .map((handle) => ({ ...handle, value: handle.value.trim().toLowerCase() }))
      .filter((handle) => handle.value);
    const strong = handles.filter((handle) => handle.verified);
    let row: EntityRow | undefined;
    for (const handle of strong) {
      row = db.prepare(`SELECT e.* FROM user_entities e JOIN user_entity_handles h ON h.entity_id = e.entity_id
        WHERE h.handle_type = ? AND h.normalized_value = ? AND h.source_scope = ?`)
        .get(handle.type, handle.value, handle.sourceScope) as EntityRow | undefined;
      if (row) break;
    }
    if (!row) {
      const fallback = handles[0];
      if (fallback) {
        row = db.prepare(`SELECT e.* FROM user_entities e JOIN user_entity_handles h ON h.entity_id = e.entity_id
          WHERE h.handle_type = ? AND h.normalized_value = ? AND h.source_scope = ?`)
          .get(fallback.type, fallback.value, fallback.sourceScope) as EntityRow | undefined;
      }
    }
    const entityId = row?.entity_id ?? randomUUID();
    if (!row) {
      db.prepare(`INSERT INTO user_entities (entity_id, entity_type, canonical_label, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)`).run(entityId, input.type, input.canonicalLabel, now, now);
    } else {
      const incomingHumanName = input.canonicalLabel.includes(' ') && !input.canonicalLabel.includes('@');
      const existingHumanName = row.canonical_label.includes(' ') && !row.canonical_label.includes('@');
      const shouldUpdateLabel = incomingHumanName && (!existingHumanName || input.canonicalLabel.length > row.canonical_label.length);
      if (shouldUpdateLabel) {
        db.prepare('UPDATE user_entities SET canonical_label = ?, updated_at = ? WHERE entity_id = ?')
          .run(input.canonicalLabel, now, entityId);
      }
    }
    for (const handle of handles) {
      db.prepare(`INSERT OR IGNORE INTO user_entity_handles
        (entity_id, handle_type, normalized_value, source_scope, verified, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(entityId, handle.type, handle.value, handle.sourceScope, handle.verified ? 1 : 0, now);
    }
    return entityFromRow(db.prepare('SELECT * FROM user_entities WHERE entity_id = ?').get(entityId) as EntityRow);
  });
}

function thresholds(claimClass: UserClaimClass): { evidence: number; days: number } {
  return claimClass === 'routine' ? { evidence: 3, days: 3 } : { evidence: 3, days: 2 };
}

function refreshUserClaim(db: DatabaseSync, row: ClaimRow, now: number): UserClaim {
  const stats = db.prepare(`SELECT
    SUM(CASE WHEN relation = 'supports' THEN 1 ELSE 0 END) AS evidence_count,
    SUM(CASE WHEN relation = 'contradicts' THEN 1 ELSE 0 END) AS contradiction_count,
    COUNT(DISTINCT CASE WHEN relation = 'supports' THEN date(observed_at / 1000, 'unixepoch') END) AS active_days,
    MAX(observed_at) AS last_observed
    FROM user_claim_evidence WHERE claim_id = ?`)
    .get(row.claim_id) as {
      evidence_count: number | null;
      contradiction_count: number | null;
      active_days: number;
      last_observed: number | null;
    };
  const evidenceCount = stats.evidence_count ?? 0;
  const contradictionCount = stats.contradiction_count ?? 0;
  const limit = thresholds(row.claim_class);
  const state: UserClaimState = row.user_state === 'rejected'
    ? 'rejected'
    : row.user_state === 'confirmed'
      ? 'active'
      : contradictionCount >= evidenceCount && contradictionCount > 0
        ? 'stale'
        : evidenceCount >= limit.evidence && stats.active_days >= limit.days
          ? 'active'
          : 'provisional';
  const confidence = Math.max(0.1, Math.min(0.92,
    0.48 + Math.min(evidenceCount, 8) * 0.035 + Math.min(stats.active_days, 5) * 0.045
    - Math.min(contradictionCount, 5) * 0.08));
  db.prepare(`UPDATE user_claims SET state = ?, confidence = ?, independent_evidence_count = ?,
    active_day_count = ?, last_reinforced_at = ?, updated_at = ? WHERE claim_id = ?`)
    .run(state, confidence, evidenceCount, stats.active_days, stats.last_observed ?? row.last_reinforced_at,
      now, row.claim_id);
  return claimFromRow(db.prepare('SELECT * FROM user_claims WHERE claim_id = ?').get(row.claim_id) as ClaimRow);
}

export function reinforceUserClaim(input: {
  agentId: string;
  class: UserClaimClass;
  key: string;
  subjectEntityId?: string;
  value: Record<string, unknown>;
  evidence: Array<{
    logicalEventKey: string;
    sourceItemId: string;
    sourceInstanceId: string;
    relation: 'supports' | 'contradicts';
    observedAt: string;
  }>;
  nowMs?: number;
}): UserClaim {
  const now = input.nowMs ?? Date.now();
  return runSqliteWriteTransaction((db) => {
    let row = db.prepare('SELECT * FROM user_claims WHERE agent_id = ? AND claim_class = ? AND claim_key = ?')
      .get(input.agentId, input.class, input.key) as ClaimRow | undefined;
    const claimId = row?.claim_id ?? randomUUID();
    if (!row) {
      const firstObserved = Math.min(...input.evidence.map((item) => Date.parse(item.observedAt)), now);
      db.prepare(`INSERT INTO user_claims (
        claim_id, agent_id, claim_class, claim_key, subject_entity_id, value_json, state, user_state,
        confidence, independent_evidence_count, active_day_count, first_observed_at, last_reinforced_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'provisional', 'auto', 0, 0, 0, ?, ?, ?, ?)`)
        .run(claimId, input.agentId, input.class, input.key, input.subjectEntityId ?? null,
          JSON.stringify(input.value), firstObserved, now, now, now);
    }
    for (const evidence of input.evidence) {
      db.prepare(`INSERT INTO user_claim_evidence (
        claim_id, logical_event_key, source_item_id, source_instance_id, relation, observed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(claim_id, logical_event_key) DO UPDATE SET
        source_item_id = excluded.source_item_id,
        source_instance_id = excluded.source_instance_id,
        relation = excluded.relation,
        observed_at = excluded.observed_at`)
        .run(claimId, evidence.logicalEventKey, evidence.sourceItemId, evidence.sourceInstanceId,
          evidence.relation, Date.parse(evidence.observedAt), now);
    }
    db.prepare('UPDATE user_claims SET subject_entity_id = ?, value_json = ? WHERE claim_id = ?')
      .run(input.subjectEntityId ?? null, JSON.stringify(input.value), claimId);
    row = db.prepare('SELECT * FROM user_claims WHERE claim_id = ?').get(claimId) as ClaimRow;
    return refreshUserClaim(db, row, now);
  });
}

export function removeUserClaimEvidenceForSource(sourceInstanceId: string): {
  deletedClaimCount: number;
  deletedMemoryRecordIds: string[];
  retainedClaims: Array<{ memoryRecordId: string; state: UserClaimState }>;
} {
  return runSqliteWriteTransaction((db) => {
    const affected = db.prepare(`SELECT DISTINCT c.* FROM user_claims c
      JOIN user_claim_evidence e ON e.claim_id = c.claim_id
      WHERE e.source_instance_id = ?`).all(sourceInstanceId) as ClaimRow[];
    db.prepare('DELETE FROM user_claim_evidence WHERE source_instance_id = ?').run(sourceInstanceId);
    const deletedMemoryRecordIds: string[] = [];
    const retainedClaims: Array<{ memoryRecordId: string; state: UserClaimState }> = [];
    let deletedClaimCount = 0;
    const now = Date.now();
    for (const row of affected) {
      const evidenceCount = db.prepare('SELECT COUNT(*) AS count FROM user_claim_evidence WHERE claim_id = ?')
        .get(row.claim_id) as { count: number };
      if (evidenceCount.count === 0) {
        if (row.memory_record_id) deletedMemoryRecordIds.push(row.memory_record_id);
        db.prepare('DELETE FROM user_claims WHERE claim_id = ?').run(row.claim_id);
        deletedClaimCount += 1;
        continue;
      }
      const claim = refreshUserClaim(db, row, now);
      if (claim.memoryRecordId) retainedClaims.push({ memoryRecordId: claim.memoryRecordId, state: claim.state });
    }
    return { deletedClaimCount, deletedMemoryRecordIds, retainedClaims };
  });
}

export function setUserClaimDecision(claimId: string, userState: Exclude<UserClaimUserState, 'auto'>): UserClaim | undefined {
  runSqliteWriteTransaction((db) => {
    db.prepare(`UPDATE user_claims SET user_state = ?, state = ?, updated_at = ? WHERE claim_id = ?`)
      .run(userState, userState === 'confirmed' ? 'active' : 'rejected', Date.now(), claimId);
  });
  return getUserClaim(claimId);
}

export function linkUserClaimMemoryRecord(claimId: string, memoryRecordId: string): void {
  runSqliteWriteTransaction((db) => {
    db.prepare('UPDATE user_claims SET memory_record_id = ?, updated_at = ? WHERE claim_id = ?')
      .run(memoryRecordId, Date.now(), claimId);
  });
}

export function getUserClaim(claimId: string): UserClaim | undefined {
  const row = getSqliteDatabase().prepare('SELECT * FROM user_claims WHERE claim_id = ?').get(claimId) as ClaimRow | undefined;
  return row ? claimFromRow(row) : undefined;
}

export function listUserClaims(options: { agentId?: string; state?: UserClaimState; limit?: number } = {}): UserClaim[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (options.agentId) { where.push('agent_id = ?'); params.push(options.agentId); }
  if (options.state) { where.push('state = ?'); params.push(options.state); }
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const rows = getSqliteDatabase().prepare(`SELECT * FROM user_claims
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY confidence DESC, last_reinforced_at DESC LIMIT ?`).all(...params, limit) as ClaimRow[];
  return rows.map(claimFromRow);
}

export function listUserClaimEvidence(claimId: string): Array<{
  logicalEventKey: string; sourceItemId: string; sourceInstanceId: string; relation: string; observedAt: string;
}> {
  const rows = getSqliteDatabase().prepare(`SELECT logical_event_key, source_item_id, source_instance_id, relation, observed_at
    FROM user_claim_evidence WHERE claim_id = ? ORDER BY observed_at DESC`).all(claimId) as Array<{
      logical_event_key: string; source_item_id: string; source_instance_id: string; relation: string; observed_at: number;
    }>;
  return rows.map((row) => ({
    logicalEventKey: row.logical_event_key, sourceItemId: row.source_item_id,
    sourceInstanceId: row.source_instance_id, relation: row.relation,
    observedAt: new Date(row.observed_at).toISOString(),
  }));
}

export function listUserPeopleGraphRows(): {
  people: Array<UserEntity & { handles: Array<{ type: UserEntityHandleType; value: string }> }>;
  edges: Array<{ entityId: string; sourceInstanceId: string; mentionCount: number; lastObservedAt: string }>;
  evidenceCount: number;
} {
  const db = getSqliteDatabase();
  const entities = db.prepare(`SELECT * FROM user_entities e WHERE entity_type = 'person'
    AND EXISTS (SELECT 1 FROM user_claims c JOIN user_claim_evidence ce ON ce.claim_id = c.claim_id
      WHERE c.subject_entity_id = e.entity_id)`).all() as EntityRow[];
  const handles = db.prepare(`SELECT entity_id, handle_type, normalized_value FROM user_entity_handles
    WHERE entity_id IN (SELECT entity_id FROM user_entities WHERE entity_type = 'person')`)
    .all() as Array<{ entity_id: string; handle_type: UserEntityHandleType; normalized_value: string }>;
  const byEntity = new Map<string, Array<{ type: UserEntityHandleType; value: string }>>();
  for (const handle of handles) {
    const values = byEntity.get(handle.entity_id) ?? [];
    values.push({ type: handle.handle_type, value: handle.normalized_value });
    byEntity.set(handle.entity_id, values);
  }
  const edgeRows = db.prepare(`SELECT c.subject_entity_id AS entity_id, e.source_instance_id,
      COUNT(*) AS mention_count, MAX(e.observed_at) AS last_observed_at
    FROM user_claims c JOIN user_claim_evidence e ON e.claim_id = c.claim_id
    WHERE c.claim_class = 'relationship' AND c.subject_entity_id IS NOT NULL AND e.relation = 'supports'
    GROUP BY c.subject_entity_id, e.source_instance_id`)
    .all() as Array<{ entity_id: string; source_instance_id: string; mention_count: number; last_observed_at: number }>;
  return {
    people: entities.map((row) => ({ ...entityFromRow(row), handles: byEntity.get(row.entity_id) ?? [] })),
    edges: edgeRows.map((row) => ({
      entityId: row.entity_id,
      sourceInstanceId: row.source_instance_id,
      mentionCount: row.mention_count,
      lastObservedAt: new Date(row.last_observed_at).toISOString(),
    })),
    evidenceCount: edgeRows.reduce((sum, row) => sum + row.mention_count, 0),
  };
}

export function listUserClaimStatsBySource(): Record<string, {
  evidenceCount: number;
  provisionalClaims: number;
  activeClaims: number;
  resolvedEntities: number;
  lastEvidenceAt?: string;
}> {
  const rows = getSqliteDatabase().prepare(`SELECT e.source_instance_id,
      COUNT(*) AS evidence_count,
      COUNT(DISTINCT CASE WHEN c.state = 'provisional' THEN c.claim_id END) AS provisional_claims,
      COUNT(DISTINCT CASE WHEN c.state = 'active' THEN c.claim_id END) AS active_claims,
      COUNT(DISTINCT c.subject_entity_id) AS resolved_entities,
      MAX(e.observed_at) AS last_evidence_at
    FROM user_claim_evidence e JOIN user_claims c ON c.claim_id = e.claim_id
    GROUP BY e.source_instance_id`).all() as Array<{
      source_instance_id: string; evidence_count: number; provisional_claims: number;
      active_claims: number; resolved_entities: number; last_evidence_at: number | null;
    }>;
  return Object.fromEntries(rows.map((row) => [row.source_instance_id, {
    evidenceCount: row.evidence_count,
    provisionalClaims: row.provisional_claims,
    activeClaims: row.active_claims,
    resolvedEntities: row.resolved_entities,
    ...(row.last_evidence_at == null ? {} : { lastEvidenceAt: new Date(row.last_evidence_at).toISOString() }),
  }]));
}
