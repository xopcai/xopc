import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import type {
  DiscussionCapture,
  DiscussionCaptureSettings,
  DiscussionListResult,
  DiscussionMetrics,
  DiscussionProcessingStage,
  DiscussionStatus,
  DiscussionTranscriptSegment,
  ListDiscussionsQuery,
} from './types.js';

type DiscussionRow = {
  id: string;
  client_request_id: string;
  note_id: string;
  project_id: string | null;
  audio_attachment_id: string | null;
  source: string;
  status: string;
  processing_stage: string | null;
  duration_ms: number | null;
  expected_last_sequence: number | null;
  mime_type: string | null;
  audio_size_bytes: number | null;
  audio_sha256: string | null;
  transcript_raw: string | null;
  transcript_sha256: string | null;
  transcript_language: string | null;
  stt_provider: string | null;
  analysis_json: string | null;
  analysis_input_hash: string | null;
  analyzer_model_ref: string | null;
  generated_title: string | null;
  project_inference_score: number | null;
  project_inference_source: string | null;
  finalization_revision: number;
  attempt_count: number;
  next_attempt_at: number | null;
  lease_owner: string | null;
  lease_expires_at: number | null;
  last_error_code: string | null;
  last_error_message: string | null;
  recording_started_at: number;
  recording_finished_at: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  audio_deleted_at: number | null;
};

type SegmentRow = {
  discussion_id: string;
  sequence: number;
  audio_sha256: string;
  audio_blob: Buffer | null;
  started_at_ms: number;
  ended_at_ms: number;
  status: DiscussionTranscriptSegment['status'];
  transcript: string | null;
  provider: string | null;
  attempt_count: number;
  next_attempt_at: number | null;
  lease_owner: string | null;
  lease_expires_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

export interface ClaimedDiscussionTranscriptSegment extends DiscussionTranscriptSegment {
  audioBuffer: Buffer;
}

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
    source: row.source as DiscussionCapture['source'],
    status: row.status as DiscussionStatus,
    ...(row.processing_stage ? { processingStage: row.processing_stage as DiscussionProcessingStage } : {}),
    ...(row.duration_ms != null ? { durationMs: row.duration_ms } : {}),
    ...(row.expected_last_sequence != null ? { expectedLastSequence: row.expected_last_sequence } : {}),
    ...(row.mime_type ? { mimeType: row.mime_type } : {}),
    ...(row.audio_size_bytes != null ? { audioSizeBytes: row.audio_size_bytes } : {}),
    ...(row.audio_sha256 ? { audioSha256: row.audio_sha256 } : {}),
    ...(row.transcript_raw ? { transcriptRaw: row.transcript_raw } : {}),
    ...(row.transcript_sha256 ? { transcriptSha256: row.transcript_sha256 } : {}),
    ...(row.transcript_language ? { transcriptLanguage: row.transcript_language } : {}),
    ...(row.stt_provider ? { sttProvider: row.stt_provider } : {}),
    ...(row.analysis_json ? { analysis: parseJson(row.analysis_json) as DiscussionCapture['analysis'] } : {}),
    ...(row.analysis_input_hash ? { analysisInputHash: row.analysis_input_hash } : {}),
    ...(row.analyzer_model_ref ? { analyzerModelRef: row.analyzer_model_ref } : {}),
    ...(row.generated_title ? { generatedTitle: row.generated_title } : {}),
    ...(row.project_inference_score != null ? { projectInferenceScore: row.project_inference_score } : {}),
    ...(row.project_inference_source ? {
      projectInferenceSource: row.project_inference_source as DiscussionCapture['projectInferenceSource'],
    } : {}),
    finalizationRevision: row.finalization_revision,
    attemptCount: row.attempt_count,
    ...(row.next_attempt_at != null ? { nextAttemptAt: row.next_attempt_at } : {}),
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at != null ? { leaseExpiresAt: row.lease_expires_at } : {}),
    ...(row.last_error_code ? { lastErrorCode: row.last_error_code } : {}),
    ...(row.last_error_message ? { lastErrorMessage: row.last_error_message } : {}),
    recordingStartedAt: row.recording_started_at,
    ...(row.recording_finished_at != null ? { recordingFinishedAt: row.recording_finished_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at != null ? { completedAt: row.completed_at } : {}),
    ...(row.audio_deleted_at != null ? { audioDeletedAt: row.audio_deleted_at } : {}),
  };
}

function segmentFromRow(row: SegmentRow): DiscussionTranscriptSegment {
  return {
    discussionId: row.discussion_id,
    sequence: row.sequence,
    audioSha256: row.audio_sha256,
    startedAtMs: row.started_at_ms,
    endedAtMs: row.ended_at_ms,
    status: row.status,
    ...(row.transcript ? { transcript: row.transcript } : {}),
    ...(row.provider ? { provider: row.provider } : {}),
    attemptCount: row.attempt_count,
    ...(row.next_attempt_at != null ? { nextAttemptAt: row.next_attempt_at } : {}),
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at != null ? { leaseExpiresAt: row.lease_expires_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readOne(column: 'id' | 'client_request_id', value: string): DiscussionCapture | null {
  const row = getSqliteDatabase().prepare(
    `SELECT * FROM discussion_captures WHERE ${column} = ?`,
  ).get(value) as DiscussionRow | undefined;
  return row ? discussionFromRow(row) : null;
}

export function createDiscussionCapture(capture: DiscussionCapture): DiscussionCapture {
  runSqliteWriteTransaction((db) => db.prepare(
    `INSERT INTO discussion_captures (
      id, client_request_id, note_id, project_id, source, status,
      processing_stage, project_inference_score, project_inference_source,
      finalization_revision, attempt_count, recording_started_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    capture.id,
    capture.clientRequestId,
    capture.noteId,
    capture.projectId ?? null,
    capture.source,
    capture.status,
    capture.processingStage ?? null,
    capture.projectInferenceScore ?? null,
    capture.projectInferenceSource ?? null,
    capture.finalizationRevision,
    capture.attemptCount,
    capture.recordingStartedAt,
    capture.createdAt,
    capture.updatedAt,
  ));
  return getDiscussionCapture(capture.id)!;
}

export function getDiscussionCapture(id: string): DiscussionCapture | null {
  return readOne('id', id);
}

export function getDiscussionCaptureByClientRequestId(clientRequestId: string): DiscussionCapture | null {
  return readOne('client_request_id', clientRequestId);
}

export function getDiscussionCaptureByNoteId(noteId: string): DiscussionCapture | null {
  const row = getSqliteDatabase().prepare(
    'SELECT * FROM discussion_captures WHERE note_id = ?',
  ).get(noteId) as DiscussionRow | undefined;
  return row ? discussionFromRow(row) : null;
}

export function listDiscussionCaptures(query: ListDiscussionsQuery = {}): DiscussionListResult {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (query.status === 'active') clauses.push(`status NOT IN ('completed', 'cancelled')`);
  else if (query.status) {
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
  const total = (db.prepare(`SELECT COUNT(*) AS total FROM discussion_captures ${where}`)
    .get(...params) as { total: number }).total;
  const rows = db.prepare(
    `SELECT * FROM discussion_captures ${where}
     ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as DiscussionRow[];
  return { items: rows.map(discussionFromRow), total, limit, offset, hasMore: offset + rows.length < total };
}

export function getDiscussionMetrics(): DiscussionMetrics {
  const db = getSqliteDatabase();
  const rows = db.prepare(
    'SELECT status, COUNT(*) AS count FROM discussion_captures GROUP BY status',
  ).all() as Array<{ status: DiscussionStatus; count: number }>;
  const timing = db.prepare(
    `SELECT
      AVG((SELECT MIN(s.updated_at) FROM discussion_transcript_segments s
        WHERE s.discussion_id = d.id AND s.status = 'completed') - d.recording_started_at) AS first_transcript_ms,
      AVG(CASE WHEN d.completed_at IS NOT NULL THEN d.completed_at - d.recording_started_at END) AS complete_ms
     FROM discussion_captures d`,
  ).get() as { first_transcript_ms: number | null; complete_ms: number | null };
  const byStatus = Object.fromEntries(
    ['recording', 'finalizing', 'completed', 'failed', 'cancelled'].map((status) => [status, 0]),
  ) as Record<DiscussionStatus, number>;
  for (const row of rows) byStatus[row.status] = row.count;
  return {
    total: rows.reduce((sum, row) => sum + row.count, 0),
    byStatus,
    averageTimeToFirstTranscriptMs: timing.first_transcript_ms == null ? null : Math.max(0, Math.round(timing.first_transcript_ms)),
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
  const sql = `UPDATE discussion_captures SET
    project_id = ?, audio_attachment_id = ?, source = ?, status = ?, processing_stage = ?,
    duration_ms = ?, expected_last_sequence = ?, mime_type = ?, audio_size_bytes = ?, audio_sha256 = ?,
    transcript_raw = ?, transcript_sha256 = ?, transcript_language = ?, stt_provider = ?, analysis_json = ?,
    analysis_input_hash = ?, analyzer_model_ref = ?, generated_title = ?, project_inference_score = ?,
    project_inference_source = ?, finalization_revision = ?, attempt_count = ?, next_attempt_at = ?,
    lease_owner = ?, lease_expires_at = ?, last_error_code = ?, last_error_message = ?,
    recording_started_at = ?, recording_finished_at = ?, updated_at = ?, completed_at = ?, audio_deleted_at = ?
    WHERE id = ?${expectedStatuses?.length ? ` AND status IN (${expectedStatuses.map(() => '?').join(', ')})` : ''}`;
  const changes = runSqliteWriteTransaction((db) => db.prepare(sql).run(
    next.projectId ?? null,
    next.audioAttachmentId ?? null,
    next.source,
    next.status,
    next.processingStage ?? null,
    next.durationMs ?? null,
    next.expectedLastSequence ?? null,
    next.mimeType ?? null,
    next.audioSizeBytes ?? null,
    next.audioSha256 ?? null,
    next.transcriptRaw ?? null,
    next.transcriptSha256 ?? null,
    next.transcriptLanguage ?? null,
    next.sttProvider ?? null,
    next.analysis === undefined ? null : JSON.stringify(next.analysis),
    next.analysisInputHash ?? null,
    next.analyzerModelRef ?? null,
    next.generatedTitle ?? null,
    next.projectInferenceScore ?? null,
    next.projectInferenceSource ?? null,
    next.finalizationRevision,
    next.attemptCount,
    next.nextAttemptAt ?? null,
    next.leaseOwner ?? null,
    next.leaseExpiresAt ?? null,
    next.lastErrorCode ?? null,
    next.lastErrorMessage ?? null,
    next.recordingStartedAt,
    next.recordingFinishedAt ?? null,
    next.updatedAt,
    next.completedAt ?? null,
    next.audioDeletedAt ?? null,
    id,
    ...(expectedStatuses ?? []),
  ).changes);
  return changes > 0 ? getDiscussionCapture(id) : null;
}

export function claimNextDiscussionCapture(owner: string, now = Date.now(), leaseMs = 5 * 60_000): DiscussionCapture | null {
  return runSqliteWriteTransaction((db) => {
    const row = db.prepare(
      `SELECT * FROM discussion_captures
       WHERE status = 'finalizing'
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)
       ORDER BY created_at ASC, id ASC LIMIT 1`,
    ).get(now, now) as DiscussionRow | undefined;
    if (!row) return null;
    const changed = db.prepare(
      `UPDATE discussion_captures SET attempt_count = attempt_count + 1,
       next_attempt_at = NULL, lease_owner = ?, lease_expires_at = ?, updated_at = ?
       WHERE id = ? AND status = 'finalizing'
         AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)`,
    ).run(owner, now + leaseMs, now, row.id, now).changes;
    return changed > 0 ? getDiscussionCapture(row.id) : null;
  });
}

export function createDiscussionTranscriptSegment(input: {
  discussionId: string;
  sequence: number;
  audioSha256: string;
  audioBuffer: Buffer;
  startedAtMs: number;
  endedAtMs: number;
  now?: number;
}): DiscussionTranscriptSegment {
  const existing = getDiscussionTranscriptSegment(input.discussionId, input.sequence);
  if (existing) return existing;
  const now = input.now ?? Date.now();
  runSqliteWriteTransaction((db) => db.prepare(
    `INSERT INTO discussion_transcript_segments (
      discussion_id, sequence, audio_sha256, audio_blob, started_at_ms, ended_at_ms,
      status, attempt_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'uploaded', 0, ?, ?)`,
  ).run(
    input.discussionId,
    input.sequence,
    input.audioSha256,
    input.audioBuffer,
    input.startedAtMs,
    input.endedAtMs,
    now,
    now,
  ));
  return getDiscussionTranscriptSegment(input.discussionId, input.sequence)!;
}

export function getDiscussionTranscriptSegment(discussionId: string, sequence: number): DiscussionTranscriptSegment | null {
  const row = getSqliteDatabase().prepare(
    'SELECT * FROM discussion_transcript_segments WHERE discussion_id = ? AND sequence = ?',
  ).get(discussionId, sequence) as SegmentRow | undefined;
  return row ? segmentFromRow(row) : null;
}

export function listDiscussionTranscriptSegments(discussionId: string): DiscussionTranscriptSegment[] {
  const rows = getSqliteDatabase().prepare(
    'SELECT * FROM discussion_transcript_segments WHERE discussion_id = ? ORDER BY sequence ASC',
  ).all(discussionId) as SegmentRow[];
  return rows.map(segmentFromRow);
}

export function claimNextDiscussionTranscriptSegment(
  owner: string,
  now = Date.now(),
  leaseMs = 2 * 60_000,
): ClaimedDiscussionTranscriptSegment | null {
  return runSqliteWriteTransaction((db) => {
    const row = db.prepare(
      `SELECT s.* FROM discussion_transcript_segments s
       JOIN discussion_captures d ON d.id = s.discussion_id
       WHERE (s.status = 'uploaded'
         OR (s.status = 'transcribing' AND (s.lease_expires_at IS NULL OR s.lease_expires_at <= ?)))
         AND d.status IN ('recording', 'finalizing')
         AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= ?)
         AND NOT EXISTS (
           SELECT 1 FROM discussion_transcript_segments earlier
           WHERE earlier.discussion_id = s.discussion_id
             AND earlier.sequence < s.sequence
             AND earlier.status IN ('uploaded', 'transcribing')
         )
       ORDER BY s.created_at ASC, s.sequence ASC LIMIT 1`,
    ).get(now, now) as SegmentRow | undefined;
    if (!row?.audio_blob) return null;
    const changed = db.prepare(
      `UPDATE discussion_transcript_segments
       SET status = 'transcribing', attempt_count = attempt_count + 1,
         next_attempt_at = NULL, lease_owner = ?, lease_expires_at = ?, updated_at = ?
       WHERE discussion_id = ? AND sequence = ?
         AND (status = 'uploaded'
           OR (status = 'transcribing' AND (lease_expires_at IS NULL OR lease_expires_at <= ?)))`,
    ).run(owner, now + leaseMs, now, row.discussion_id, row.sequence, now).changes;
    if (changed === 0) return null;
    const claimed = db.prepare(
      'SELECT * FROM discussion_transcript_segments WHERE discussion_id = ? AND sequence = ?',
    ).get(row.discussion_id, row.sequence) as SegmentRow;
    return { ...segmentFromRow(claimed), audioBuffer: Buffer.from(claimed.audio_blob!) };
  });
}

export function completeDiscussionTranscriptSegment(
  discussionId: string,
  sequence: number,
  owner: string,
  transcript: string,
  provider: string,
): DiscussionTranscriptSegment | null {
  const now = Date.now();
  const changes = runSqliteWriteTransaction((db) => db.prepare(
    `UPDATE discussion_transcript_segments SET
      status = 'completed', transcript = ?, provider = ?, audio_blob = NULL,
      lease_owner = NULL, lease_expires_at = NULL, next_attempt_at = NULL,
      last_error = NULL, updated_at = ?
     WHERE discussion_id = ? AND sequence = ? AND status = 'transcribing' AND lease_owner = ?`,
  ).run(transcript, provider, now, discussionId, sequence, owner).changes);
  return changes > 0 ? getDiscussionTranscriptSegment(discussionId, sequence) : null;
}

export function retryOrFailDiscussionTranscriptSegment(
  discussionId: string,
  sequence: number,
  owner: string,
  error: string,
  exhausted: boolean,
): DiscussionTranscriptSegment | null {
  const now = Date.now();
  const changes = runSqliteWriteTransaction((db) => db.prepare(
    `UPDATE discussion_transcript_segments SET
      status = ?, lease_owner = NULL, lease_expires_at = NULL,
      next_attempt_at = ?, last_error = ?, audio_blob = CASE WHEN ? THEN NULL ELSE audio_blob END,
      updated_at = ?
     WHERE discussion_id = ? AND sequence = ? AND status = 'transcribing' AND lease_owner = ?`,
  ).run(
    exhausted ? 'failed' : 'uploaded',
    exhausted ? null : now + 2_000,
    error.slice(0, 1_000),
    exhausted ? 1 : 0,
    now,
    discussionId,
    sequence,
    owner,
  ).changes);
  return changes > 0 ? getDiscussionTranscriptSegment(discussionId, sequence) : null;
}

export function deleteDiscussionSegmentAudio(discussionId: string): void {
  runSqliteWriteTransaction((db) => db.prepare(
    'UPDATE discussion_transcript_segments SET audio_blob = NULL WHERE discussion_id = ?',
  ).run(discussionId));
}

export function getDiscussionCaptureSettings(): DiscussionCaptureSettings {
  const row = getSqliteDatabase().prepare(
    `SELECT consent_policy_version, consent_acknowledged_at
     FROM discussion_capture_settings WHERE workspace_id = 'default'`,
  ).get() as { consent_policy_version: number; consent_acknowledged_at: number | null };
  return {
    consentPolicyVersion: row.consent_policy_version,
    ...(row.consent_acknowledged_at != null ? { consentAcknowledgedAt: row.consent_acknowledged_at } : {}),
  };
}

export function acknowledgeDiscussionCaptureConsent(policyVersion: number): DiscussionCaptureSettings {
  const now = Date.now();
  runSqliteWriteTransaction((db) => db.prepare(
    `UPDATE discussion_capture_settings SET consent_acknowledged_at = ?, updated_at = ?
     WHERE workspace_id = 'default' AND consent_policy_version = ?`,
  ).run(now, now, policyVersion));
  return getDiscussionCaptureSettings();
}
