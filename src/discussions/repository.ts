import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import type {
  DiscussionCapture,
  DiscussionListResult,
  DiscussionMetrics,
  DiscussionStatus,
  ListDiscussionsQuery,
} from './types.js';

type DiscussionRow = {
  id: string;
  client_request_id: string;
  note_id: string;
  project_id: string | null;
  audio_attachment_id: string | null;
  status: string;
  failed_stage: string | null;
  capture_mode: string;
  consent_confirmed: number;
  language_hint: string | null;
  duration_ms: number | null;
  mime_type: string | null;
  audio_size_bytes: number | null;
  audio_sha256: string | null;
  transcript_raw: string | null;
  transcript_sha256: string | null;
  transcript_language: string | null;
  stt_provider: string | null;
  analysis_json: string | null;
  analysis_version: number;
  analysis_input_hash: string | null;
  analyzer_model_ref: string | null;
  review_json: string | null;
  review_revision: number;
  attempt_count: number;
  next_attempt_at: number | null;
  lease_owner: string | null;
  lease_expires_at: number | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  reviewed_at: number | null;
  audio_deleted_at: number | null;
};

function parseJson(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function discussionFromRow(row: DiscussionRow): DiscussionCapture {
  return {
    id: row.id,
    clientRequestId: row.client_request_id,
    noteId: row.note_id,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.audio_attachment_id ? { audioAttachmentId: row.audio_attachment_id } : {}),
    status: row.status as DiscussionCapture['status'],
    ...(row.failed_stage ? { failedStage: row.failed_stage as DiscussionCapture['failedStage'] } : {}),
    captureMode: row.capture_mode as DiscussionCapture['captureMode'],
    consentConfirmed: row.consent_confirmed === 1,
    ...(row.language_hint ? { languageHint: row.language_hint } : {}),
    ...(row.duration_ms != null ? { durationMs: row.duration_ms } : {}),
    ...(row.mime_type ? { mimeType: row.mime_type } : {}),
    ...(row.audio_size_bytes != null ? { audioSizeBytes: row.audio_size_bytes } : {}),
    ...(row.audio_sha256 ? { audioSha256: row.audio_sha256 } : {}),
    ...(row.transcript_raw ? { transcriptRaw: row.transcript_raw } : {}),
    ...(row.transcript_sha256 ? { transcriptSha256: row.transcript_sha256 } : {}),
    ...(row.transcript_language ? { transcriptLanguage: row.transcript_language } : {}),
    ...(row.stt_provider ? { sttProvider: row.stt_provider } : {}),
    ...(row.analysis_json ? { analysis: parseJson(row.analysis_json) } : {}),
    analysisVersion: row.analysis_version,
    ...(row.analysis_input_hash ? { analysisInputHash: row.analysis_input_hash } : {}),
    ...(row.analyzer_model_ref ? { analyzerModelRef: row.analyzer_model_ref } : {}),
    ...(row.review_json ? { review: parseJson(row.review_json) } : {}),
    reviewRevision: row.review_revision,
    attemptCount: row.attempt_count,
    ...(row.next_attempt_at != null ? { nextAttemptAt: row.next_attempt_at } : {}),
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at != null ? { leaseExpiresAt: row.lease_expires_at } : {}),
    ...(row.last_error_code ? { lastErrorCode: row.last_error_code } : {}),
    ...(row.last_error_message ? { lastErrorMessage: row.last_error_message } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at != null ? { completedAt: row.completed_at } : {}),
    ...(row.reviewed_at != null ? { reviewedAt: row.reviewed_at } : {}),
    ...(row.audio_deleted_at != null ? { audioDeletedAt: row.audio_deleted_at } : {}),
  };
}

function readOne(column: 'id' | 'client_request_id', value: string): DiscussionCapture | null {
  const row = getSqliteDatabase()
    .prepare(`SELECT * FROM discussion_captures WHERE ${column} = ?`)
    .get(value) as DiscussionRow | undefined;
  return row ? discussionFromRow(row) : null;
}

export function createDiscussionCapture(capture: DiscussionCapture): DiscussionCapture {
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO discussion_captures (
        id, client_request_id, note_id, project_id, status, capture_mode,
        consent_confirmed, language_hint, analysis_version, review_revision,
        attempt_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      capture.id,
      capture.clientRequestId,
      capture.noteId,
      capture.projectId ?? null,
      capture.status,
      capture.captureMode,
      capture.consentConfirmed ? 1 : 0,
      capture.languageHint ?? null,
      capture.analysisVersion,
      capture.reviewRevision,
      capture.attemptCount,
      capture.createdAt,
      capture.updatedAt,
    );
  });
  return getDiscussionCapture(capture.id)!;
}

export function getDiscussionCapture(id: string): DiscussionCapture | null {
  return readOne('id', id);
}

export function getDiscussionCaptureByClientRequestId(clientRequestId: string): DiscussionCapture | null {
  return readOne('client_request_id', clientRequestId);
}

export function listDiscussionCaptures(query: ListDiscussionsQuery = {}): DiscussionListResult {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (query.status === 'active') {
    clauses.push(`status NOT IN ('completed', 'cancelled')`);
  } else if (query.status) {
    clauses.push('status = ?');
    params.push(query.status);
  }
  if (query.projectId) {
    clauses.push('project_id = ?');
    params.push(query.projectId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 30)));
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const db = getSqliteDatabase();
  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM discussion_captures ${where}`)
    .get(...params) as { total: number };
  const rows = db.prepare(
    `SELECT * FROM discussion_captures ${where}
     ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as DiscussionRow[];
  return {
    items: rows.map(discussionFromRow),
    total: totalRow.total,
    limit,
    offset,
    hasMore: offset + rows.length < totalRow.total,
  };
}

export function getDiscussionMetrics(): DiscussionMetrics {
  const db = getSqliteDatabase();
  const rows = db.prepare(
    'SELECT status, COUNT(*) AS count FROM discussion_captures GROUP BY status',
  ).all() as Array<{ status: DiscussionStatus; count: number }>;
  const timing = db.prepare(
    `SELECT
      AVG(CASE WHEN reviewed_at IS NOT NULL THEN reviewed_at - created_at END) AS review_ms,
      AVG(CASE WHEN completed_at IS NOT NULL THEN completed_at - created_at END) AS complete_ms
     FROM discussion_captures`,
  ).get() as { review_ms: number | null; complete_ms: number | null };
  const byStatus = Object.fromEntries(
    ['awaiting_upload', 'queued', 'transcribing', 'analyzing', 'review_required', 'completed', 'failed', 'cancelled']
      .map((status) => [status, 0]),
  ) as Record<DiscussionStatus, number>;
  for (const row of rows) byStatus[row.status] = row.count;
  return {
    total: rows.reduce((sum, row) => sum + row.count, 0),
    byStatus,
    averageTimeToReviewMs: timing.review_ms == null ? null : Math.round(timing.review_ms),
    averageTimeToCompleteMs: timing.complete_ms == null ? null : Math.round(timing.complete_ms),
  };
}

export function updateDiscussionCapture(
  id: string,
  patch: Partial<Omit<DiscussionCapture, 'id' | 'clientRequestId' | 'noteId' | 'createdAt'>>,
  expectedStatuses?: DiscussionStatus[],
): DiscussionCapture | null {
  const existing = getDiscussionCapture(id);
  if (!existing || (expectedStatuses && !expectedStatuses.includes(existing.status))) return null;
  const next = { ...existing, ...patch, updatedAt: patch.updatedAt ?? Date.now() };
  const changed = runSqliteWriteTransaction((db) => db.prepare(
    `UPDATE discussion_captures SET
      project_id = ?, audio_attachment_id = ?, status = ?, failed_stage = ?,
      capture_mode = ?, consent_confirmed = ?, language_hint = ?, duration_ms = ?,
      mime_type = ?, audio_size_bytes = ?, audio_sha256 = ?, transcript_raw = ?,
      transcript_sha256 = ?, transcript_language = ?, stt_provider = ?, analysis_json = ?,
      analysis_version = ?, analysis_input_hash = ?, analyzer_model_ref = ?, review_json = ?,
      review_revision = ?, attempt_count = ?, next_attempt_at = ?, lease_owner = ?,
      lease_expires_at = ?, last_error_code = ?, last_error_message = ?, updated_at = ?,
      completed_at = ?, reviewed_at = ?, audio_deleted_at = ?
     WHERE id = ?${expectedStatuses?.length ? ` AND status IN (${expectedStatuses.map(() => '?').join(', ')})` : ''}`,
  ).run(
    next.projectId ?? null,
    next.audioAttachmentId ?? null,
    next.status,
    next.failedStage ?? null,
    next.captureMode,
    next.consentConfirmed ? 1 : 0,
    next.languageHint ?? null,
    next.durationMs ?? null,
    next.mimeType ?? null,
    next.audioSizeBytes ?? null,
    next.audioSha256 ?? null,
    next.transcriptRaw ?? null,
    next.transcriptSha256 ?? null,
    next.transcriptLanguage ?? null,
    next.sttProvider ?? null,
    next.analysis === undefined ? null : JSON.stringify(next.analysis),
    next.analysisVersion,
    next.analysisInputHash ?? null,
    next.analyzerModelRef ?? null,
    next.review === undefined ? null : JSON.stringify(next.review),
    next.reviewRevision,
    next.attemptCount,
    next.nextAttemptAt ?? null,
    next.leaseOwner ?? null,
    next.leaseExpiresAt ?? null,
    next.lastErrorCode ?? null,
    next.lastErrorMessage ?? null,
    next.updatedAt,
    next.completedAt ?? null,
    next.reviewedAt ?? null,
    next.audioDeletedAt ?? null,
    id,
    ...(expectedStatuses ?? []),
  ).changes);
  return changed > 0 ? getDiscussionCapture(id) : null;
}

export function claimNextDiscussionCapture(
  owner: string,
  now = Date.now(),
  leaseMs = 5 * 60_000,
): DiscussionCapture | null {
  return runSqliteWriteTransaction((db) => {
    const row = db.prepare(
      `SELECT * FROM discussion_captures
       WHERE status IN ('queued', 'transcribing', 'analyzing')
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    ).get(now, now) as DiscussionRow | undefined;
    if (!row) return null;
    const capture = discussionFromRow(row);
    const status: DiscussionStatus = capture.transcriptRaw ? 'analyzing' : 'transcribing';
    const changed = db.prepare(
      `UPDATE discussion_captures
       SET status = ?, attempt_count = attempt_count + 1, next_attempt_at = NULL,
           lease_owner = ?, lease_expires_at = ?, updated_at = ?
       WHERE id = ?
         AND status IN ('queued', 'transcribing', 'analyzing')
         AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)`,
    ).run(status, owner, now + leaseMs, now, capture.id, now).changes;
    return changed > 0 ? getDiscussionCapture(capture.id) : null;
  });
}

export interface DiscussionActionConversion {
  discussionId: string;
  actionId: string;
  workItemId: string;
  createdAt: number;
}

export function listDiscussionActionConversions(discussionId: string): DiscussionActionConversion[] {
  const rows = getSqliteDatabase().prepare(
    `SELECT discussion_id, action_id, work_item_id, created_at
     FROM discussion_action_conversions WHERE discussion_id = ? ORDER BY created_at ASC`,
  ).all(discussionId) as Array<{
    discussion_id: string;
    action_id: string;
    work_item_id: string;
    created_at: number;
  }>;
  return rows.map((row) => ({
    discussionId: row.discussion_id,
    actionId: row.action_id,
    workItemId: row.work_item_id,
    createdAt: row.created_at,
  }));
}

export function createDiscussionActionConversion(input: DiscussionActionConversion): DiscussionActionConversion {
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT OR IGNORE INTO discussion_action_conversions
       (discussion_id, action_id, work_item_id, created_at) VALUES (?, ?, ?, ?)`,
    ).run(input.discussionId, input.actionId, input.workItemId, input.createdAt);
  });
  return listDiscussionActionConversions(input.discussionId)
    .find((conversion) => conversion.actionId === input.actionId)!;
}
