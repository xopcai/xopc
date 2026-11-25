import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import type {
  RsiArtifactKind,
  RsiCandidateStatus,
  RsiCapabilityCandidate,
  RsiCapabilityTelemetry,
  RsiScopeType,
  RsiStagedPayload,
  RsiTriggerKind,
  RsiVerificationReport,
  RsiVerificationStatus,
  SimRationale,
} from './types.js';

type CandidateRow = {
  id: string;
  owner_id: string;
  artifact_kind: RsiArtifactKind;
  target_id: string;
  base_version: number | null;
  scope_type: RsiScopeType;
  scope_id: string | null;
  trigger_kind: RsiTriggerKind;
  dedupe_key: string;
  source_refs_json: string;
  sim_rationale_json: string;
  staged_content_uri: string;
  staged_payload_json: string;
  content_hash: string;
  previous_content_snapshot: string | null;
  verification_status: RsiVerificationStatus;
  verification_report_json: string | null;
  proactive_item_id: string | null;
  status: RsiCandidateStatus;
  adopted_version: number | null;
  created_at: number;
  updated_at: number;
};

type TelemetryRow = {
  capability_kind: RsiArtifactKind;
  target_id: string;
  version: number;
  invocations: number;
  verified_successes: number;
  failures: number;
  human_edits: number;
  degradation_alerted: number;
  last_used_at: number | null;
};

function mapCandidate(row: CandidateRow): RsiCapabilityCandidate {
  return {
    id: row.id,
    ownerId: row.owner_id,
    artifactKind: row.artifact_kind,
    targetId: row.target_id,
    ...(row.base_version != null ? { baseVersion: row.base_version } : {}),
    scopeType: row.scope_type,
    ...(row.scope_id ? { scopeId: row.scope_id } : {}),
    triggerKind: row.trigger_kind,
    dedupeKey: row.dedupe_key,
    sourceRefs: JSON.parse(row.source_refs_json) as string[],
    simRationale: JSON.parse(row.sim_rationale_json) as SimRationale,
    stagedContentUri: row.staged_content_uri,
    stagedPayload: JSON.parse(row.staged_payload_json) as RsiStagedPayload,
    contentHash: row.content_hash,
    ...(row.previous_content_snapshot != null ? { previousContentSnapshot: row.previous_content_snapshot } : {}),
    verificationStatus: row.verification_status,
    ...(row.verification_report_json ? { verificationReport: JSON.parse(row.verification_report_json) as RsiVerificationReport } : {}),
    ...(row.proactive_item_id ? { proactiveItemId: row.proactive_item_id } : {}),
    status: row.status,
    ...(row.adopted_version != null ? { adoptedVersion: row.adopted_version } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTelemetry(row: TelemetryRow): RsiCapabilityTelemetry {
  return {
    capabilityKind: row.capability_kind,
    targetId: row.target_id,
    version: row.version,
    invocations: row.invocations,
    verifiedSuccesses: row.verified_successes,
    failures: row.failures,
    humanEdits: row.human_edits,
    degradationAlerted: row.degradation_alerted === 1,
    ...(row.last_used_at != null ? { lastUsedAt: row.last_used_at } : {}),
  };
}

export function saveRsiCandidate(input: {
  id?: string;
  ownerId: string;
  artifactKind: RsiArtifactKind;
  targetId: string;
  baseVersion?: number;
  scopeType: RsiScopeType;
  scopeId?: string;
  triggerKind: RsiTriggerKind;
  dedupeKey: string;
  sourceRefs: string[];
  simRationale: SimRationale;
  stagedContentUri: string;
  stagedPayload: RsiStagedPayload;
  contentHash: string;
  previousContentSnapshot?: string;
  now?: number;
}): { candidate: RsiCapabilityCandidate; created: boolean } {
  const now = input.now ?? Date.now();
  const id = input.id ?? randomUUID();
  return runSqliteWriteTransaction(db => {
    const existing = db.prepare('SELECT * FROM rsi_capability_candidates WHERE dedupe_key = ?')
      .get(input.dedupeKey) as unknown as CandidateRow | undefined;
    if (existing) {
      return { candidate: mapCandidate(existing), created: false };
    }
    db.prepare(`
      INSERT INTO rsi_capability_candidates(
        id, owner_id, artifact_kind, target_id, base_version, scope_type, scope_id,
        trigger_kind, dedupe_key, source_refs_json, sim_rationale_json, staged_content_uri,
        staged_payload_json, content_hash, previous_content_snapshot, verification_status,
        verification_report_json, proactive_item_id, status, adopted_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, 'staged', NULL, ?, ?)
    `).run(
      id,
      input.ownerId,
      input.artifactKind,
      input.targetId,
      input.baseVersion ?? null,
      input.scopeType,
      input.scopeId ?? null,
      input.triggerKind,
      input.dedupeKey,
      JSON.stringify(input.sourceRefs),
      JSON.stringify(input.simRationale),
      input.stagedContentUri,
      JSON.stringify(input.stagedPayload),
      input.contentHash,
      input.previousContentSnapshot ?? null,
      now,
      now,
    );
    const inserted = db.prepare('SELECT * FROM rsi_capability_candidates WHERE id = ?').get(id) as unknown as CandidateRow;
    return { candidate: mapCandidate(inserted), created: true };
  });
}

export function getRsiCandidate(ownerId: string, candidateId: string): RsiCapabilityCandidate | undefined {
  const row = getSqliteDatabase()
    .prepare('SELECT * FROM rsi_capability_candidates WHERE id = ? AND owner_id = ?')
    .get(candidateId, ownerId) as unknown as CandidateRow | undefined;
  return row ? mapCandidate(row) : undefined;
}

export function listRsiCandidates(
  ownerId: string,
  options: { status?: RsiCandidateStatus; artifactKind?: RsiArtifactKind; limit?: number } = {},
): RsiCapabilityCandidate[] {
  const clauses = ['owner_id = ?'];
  const params: Array<string | number> = [ownerId];
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status);
  }
  if (options.artifactKind) {
    clauses.push('artifact_kind = ?');
    params.push(options.artifactKind);
  }
  const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
  params.push(limit);

  const rows = getSqliteDatabase().prepare(`
    SELECT * FROM rsi_capability_candidates
    WHERE ${clauses.join(' AND ')}
    ORDER BY created_at DESC, rowid DESC
    LIMIT ?
  `).all(...params) as unknown as CandidateRow[];
  return rows.map(mapCandidate);
}

export function recordRsiVerificationResult(
  ownerId: string,
  candidateId: string,
  report: RsiVerificationReport,
  proactiveItemId?: string,
  now = Date.now(),
): RsiCapabilityCandidate {
  return runSqliteWriteTransaction(db => {
    const nextVerification: RsiVerificationStatus = report.overallPassed ? 'passed' : 'failed';
    const nextStatus: RsiCandidateStatus = report.overallPassed
      ? (proactiveItemId ? 'inbox_pending' : 'staged')
      : 'rejected';
    db.prepare(`
      UPDATE rsi_capability_candidates
      SET verification_status = ?,
          verification_report_json = ?,
          proactive_item_id = COALESCE(?, proactive_item_id),
          status = CASE WHEN status IN ('adopted', 'rolled_back') THEN status ELSE ? END,
          updated_at = ?
      WHERE id = ? AND owner_id = ?
    `).run(
      nextVerification,
      JSON.stringify(report),
      proactiveItemId ?? null,
      nextStatus,
      now,
      candidateId,
      ownerId,
    );
    const updated = db.prepare('SELECT * FROM rsi_capability_candidates WHERE id = ?').get(candidateId) as unknown as CandidateRow;
    return mapCandidate(updated);
  });
}

export function nextAdoptedCapabilityVersion(artifactKind: RsiArtifactKind, targetId: string): number {
  const row = getSqliteDatabase().prepare(`
    SELECT COALESCE(MAX(adopted_version), 0) AS max_v
    FROM rsi_capability_candidates
    WHERE artifact_kind = ? AND target_id = ? AND adopted_version IS NOT NULL
  `).get(artifactKind, targetId) as { max_v?: number } | undefined;
  return Number(row?.max_v ?? 0) + 1;
}

export function currentRsiSkillVersion(targetId: string, scopeType: RsiScopeType, scopeId?: string): number {
  const row = getSqliteDatabase().prepare(`
    SELECT MAX(adopted_version) AS version FROM rsi_capability_candidates
    WHERE artifact_kind = 'skill' AND target_id = ? AND scope_type = ? AND scope_id IS ? AND status = 'adopted'
  `).get(targetId, scopeType, scopeId ?? null) as { version: number | null };
  return row.version ?? 0;
}

export function transitionRsiCandidateStatus(input: {
  ownerId: string;
  candidateId: string;
  status: RsiCandidateStatus;
  adoptedVersion?: number;
  previousContentSnapshot?: string;
  now?: number;
}): RsiCapabilityCandidate {
  const now = input.now ?? Date.now();
  return runSqliteWriteTransaction(db => {
    db.prepare(`
      UPDATE rsi_capability_candidates
      SET status = ?,
          adopted_version = COALESCE(?, adopted_version),
          previous_content_snapshot = COALESCE(?, previous_content_snapshot),
          updated_at = ?
      WHERE id = ? AND owner_id = ?
    `).run(
      input.status,
      input.adoptedVersion ?? null,
      input.previousContentSnapshot ?? null,
      now,
      input.candidateId,
      input.ownerId,
    );
    const updated = db.prepare('SELECT * FROM rsi_capability_candidates WHERE id = ?').get(input.candidateId) as unknown as CandidateRow;
    return mapCandidate(updated);
  });
}

export function ensureRsiTelemetryVersion(
  capabilityKind: RsiArtifactKind,
  targetId: string,
  version: number,
): RsiCapabilityTelemetry {
  return runSqliteWriteTransaction(db => {
    db.prepare(`
      INSERT OR IGNORE INTO rsi_capability_telemetry(
        capability_kind, target_id, version, invocations, verified_successes, failures, human_edits, degradation_alerted, last_used_at
      ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, NULL)
    `).run(capabilityKind, targetId, version);
    const row = db.prepare('SELECT * FROM rsi_capability_telemetry WHERE capability_kind = ? AND target_id = ? AND version = ?')
      .get(capabilityKind, targetId, version) as unknown as TelemetryRow;
    return mapTelemetry(row);
  });
}

export function recordRsiTelemetryEvent(input: {
  capabilityKind: RsiArtifactKind;
  targetId: string;
  version: number;
  outcome: 'verified_success' | 'failure' | 'human_edited' | 'unverified';
  revises?: 'verified_success' | 'unverified';
  now?: number;
}): RsiCapabilityTelemetry {
  const now = input.now ?? Date.now();
  return runSqliteWriteTransaction(db => {
    ensureRsiTelemetryVersion(input.capabilityKind, input.targetId, input.version);
    db.prepare(`
      UPDATE rsi_capability_telemetry
      SET invocations = invocations + ?,
          verified_successes = verified_successes + ?,
          failures = failures + ?,
          human_edits = human_edits + ?,
          last_used_at = ?
      WHERE capability_kind = ? AND target_id = ? AND version = ?
    `).run(
      input.revises ? 0 : 1,
      input.revises === 'verified_success' ? -1 : input.outcome === 'verified_success' ? 1 : 0,
      input.outcome === 'failure' ? 1 : 0,
      input.outcome === 'human_edited' ? 1 : 0,
      now,
      input.capabilityKind,
      input.targetId,
      input.version,
    );
    const row = db.prepare('SELECT * FROM rsi_capability_telemetry WHERE capability_kind = ? AND target_id = ? AND version = ?')
      .get(input.capabilityKind, input.targetId, input.version) as unknown as TelemetryRow;
    return mapTelemetry(row);
  });
}

export function markRsiTelemetryDegradationAlerted(
  capabilityKind: RsiArtifactKind,
  targetId: string,
  version: number,
): void {
  getSqliteDatabase().prepare(`
    UPDATE rsi_capability_telemetry
    SET degradation_alerted = 1
    WHERE capability_kind = ? AND target_id = ? AND version = ?
  `).run(capabilityKind, targetId, version);
}
