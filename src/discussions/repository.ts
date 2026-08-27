import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import { DISCUSSION_STATUSES } from './types.js';
import type {
  DiscussionCapture,
  DiscussionCaptureSettings,
  DiscussionListResult,
  DiscussionMetrics,
  DiscussionOrganization,
  DiscussionOrganizationRecord,
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
  source: DiscussionCapture['source'];
  status: DiscussionStatus;
  duration_ms: number | null;
  expected_last_sequence: number | null;
  mime_type: string | null;
  audio_size_bytes: number | null;
  audio_sha256: string | null;
  canonical_transcript: string | null;
  canonical_transcript_sha256: string | null;
  transcript_language: string | null;
  transcript_revision: number;
  generated_title: string | null;
  project_inference_score: number | null;
  project_inference_source: string | null;
  failure_stage: string | null;
  failure_code: string | null;
  failure_message: string | null;
  recording_started_at: number;
  recording_stopped_at: number | null;
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
  raw_text: string | null;
  display_text: string | null;
  language: string | null;
  provider: string | null;
  confidence: number | null;
  speaker_label: string | null;
  revision: number;
  corrected_by_user: number;
  corrected_at: number | null;
  attempt_count: number;
  next_attempt_at: number | null;
  lease_owner: string | null;
  lease_expires_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

type OrganizationRow = {
  id: string;
  discussion_id: string;
  revision: number;
  input_transcript_sha256: string;
  prompt_version: string;
  model_ref: string;
  organization_json: string | null;
  status: DiscussionOrganizationRecord['status'];
  error_message: string | null;
  created_at: number;
  completed_at: number | null;
};

export interface ClaimedDiscussionTranscriptSegment extends DiscussionTranscriptSegment {
  audioBuffer: Buffer;
}

function optional<T extends object>(condition: unknown, value: T): T | Record<string, never> {
  return condition ? value : {};
}

function discussionFromRow(row: DiscussionRow): DiscussionCapture {
  const capture: DiscussionCapture = {
    id: row.id,
    clientRequestId: row.client_request_id,
    noteId: row.note_id,
    source: row.source,
    status: row.status,
    transcriptRevision: row.transcript_revision,
    recordingStartedAt: row.recording_started_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.project_id) capture.projectId = row.project_id;
  if (row.audio_attachment_id) capture.audioAttachmentId = row.audio_attachment_id;
  if (row.duration_ms != null) capture.durationMs = row.duration_ms;
  if (row.expected_last_sequence != null) capture.expectedLastSequence = row.expected_last_sequence;
  if (row.mime_type) capture.mimeType = row.mime_type;
  if (row.audio_size_bytes != null) capture.audioSizeBytes = row.audio_size_bytes;
  if (row.audio_sha256) capture.audioSha256 = row.audio_sha256;
  if (row.canonical_transcript) capture.canonicalTranscript = row.canonical_transcript;
  if (row.canonical_transcript_sha256) capture.canonicalTranscriptSha256 = row.canonical_transcript_sha256;
  if (row.transcript_language) capture.transcriptLanguage = row.transcript_language;
  if (row.generated_title) capture.generatedTitle = row.generated_title;
  if (row.project_inference_score != null) capture.projectInferenceScore = row.project_inference_score;
  if (row.project_inference_source) {
    capture.projectInferenceSource = row.project_inference_source as DiscussionCapture['projectInferenceSource'];
  }
  if (row.failure_stage) capture.failureStage = row.failure_stage as DiscussionCapture['failureStage'];
  if (row.failure_code) capture.failureCode = row.failure_code;
  if (row.failure_message) capture.failureMessage = row.failure_message;
  if (row.recording_stopped_at != null) capture.recordingStoppedAt = row.recording_stopped_at;
  if (row.completed_at != null) capture.completedAt = row.completed_at;
  if (row.audio_deleted_at != null) capture.audioDeletedAt = row.audio_deleted_at;
  return capture;
}

function segmentFromRow(row: SegmentRow): DiscussionTranscriptSegment {
  return {
    discussionId: row.discussion_id,
    sequence: row.sequence,
    audioSha256: row.audio_sha256,
    startedAtMs: row.started_at_ms,
    endedAtMs: row.ended_at_ms,
    status: row.status,
    ...optional(row.raw_text, { rawText: row.raw_text! }),
    ...optional(row.display_text, { displayText: row.display_text! }),
    ...optional(row.language, { language: row.language! }),
    ...optional(row.provider, { provider: row.provider! }),
    ...optional(row.confidence != null, { confidence: row.confidence! }),
    ...optional(row.speaker_label, { speakerLabel: row.speaker_label! }),
    revision: row.revision,
    correctedByUser: row.corrected_by_user === 1,
    ...optional(row.corrected_at != null, { correctedAt: row.corrected_at! }),
    attemptCount: row.attempt_count,
    ...optional(row.next_attempt_at != null, { nextAttemptAt: row.next_attempt_at! }),
    ...optional(row.lease_owner, { leaseOwner: row.lease_owner! }),
    ...optional(row.lease_expires_at != null, { leaseExpiresAt: row.lease_expires_at! }),
    ...optional(row.last_error, { lastError: row.last_error! }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function organizationFromRow(row: OrganizationRow): DiscussionOrganizationRecord {
  return {
    id: row.id,
    discussionId: row.discussion_id,
    revision: row.revision,
    inputTranscriptSha256: row.input_transcript_sha256,
    promptVersion: row.prompt_version,
    modelRef: row.model_ref,
    ...optional(row.organization_json, { organization: JSON.parse(row.organization_json!) as DiscussionOrganization }),
    status: row.status,
    ...optional(row.error_message, { errorMessage: row.error_message! }),
    createdAt: row.created_at,
    ...optional(row.completed_at != null, { completedAt: row.completed_at! }),
  };
}

function getBy(column: 'id' | 'client_request_id' | 'note_id', value: string): DiscussionCapture | null {
  const row = getSqliteDatabase().prepare(`SELECT * FROM discussion_captures WHERE ${column} = ?`)
    .get(value) as DiscussionRow | undefined;
  return row ? discussionFromRow(row) : null;
}

export function createDiscussionCapture(capture: DiscussionCapture): DiscussionCapture {
  runSqliteWriteTransaction((db) => db.prepare(`INSERT INTO discussion_captures (
    id, client_request_id, note_id, project_id, source, status, transcript_revision,
    project_inference_score, project_inference_source, recording_started_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(capture.id, capture.clientRequestId, capture.noteId, capture.projectId ?? null, capture.source,
      capture.status, capture.transcriptRevision, capture.projectInferenceScore ?? null,
      capture.projectInferenceSource ?? null, capture.recordingStartedAt, capture.createdAt, capture.updatedAt));
  return getDiscussionCapture(capture.id)!;
}

export const getDiscussionCapture = (id: string) => getBy('id', id);
export const getDiscussionCaptureByClientRequestId = (id: string) => getBy('client_request_id', id);
export const getDiscussionCaptureByNoteId = (id: string) => getBy('note_id', id);

export function listDiscussionCaptures(query: ListDiscussionsQuery = {}): DiscussionListResult {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (query.status === 'active') clauses.push(`status NOT IN ('completed', 'cancelled')`);
  else if (query.status) { clauses.push('status = ?'); params.push(query.status); }
  if (query.projectId) { clauses.push('project_id = ?'); params.push(query.projectId); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 30)));
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const db = getSqliteDatabase();
  const total = (db.prepare(`SELECT COUNT(*) AS total FROM discussion_captures ${where}`)
    .get(...params) as { total: number }).total;
  const rows = db.prepare(`SELECT * FROM discussion_captures ${where}
    ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as DiscussionRow[];
  return { items: rows.map(discussionFromRow), total, limit, offset, hasMore: offset + rows.length < total };
}

export function getDiscussionMetrics(): DiscussionMetrics {
  const db = getSqliteDatabase();
  const rows = db.prepare('SELECT status, COUNT(*) count FROM discussion_captures GROUP BY status')
    .all() as Array<{ status: DiscussionStatus; count: number }>;
  const timing = db.prepare(`SELECT
    AVG((SELECT MIN(s.updated_at) FROM discussion_transcript_segments s
      WHERE s.discussion_id = d.id AND s.status = 'confirmed') - d.recording_started_at) first_ms,
    AVG(CASE WHEN d.completed_at IS NOT NULL THEN d.completed_at - d.recording_started_at END) complete_ms
    FROM discussion_captures d`).get() as { first_ms: number | null; complete_ms: number | null };
  const segmentMetrics = db.prepare(`SELECT
    COUNT(*) total,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) failed,
    SUM(CASE WHEN attempt_count > 1 THEN 1 ELSE 0 END) retried,
    AVG(CASE WHEN status = 'confirmed' THEN updated_at - created_at END) latency_ms
    FROM discussion_transcript_segments`).get() as {
      total: number;
      failed: number | null;
      retried: number | null;
      latency_ms: number | null;
    };
  const byStatus = Object.fromEntries(DISCUSSION_STATUSES.map((status) => [status, 0])) as Record<DiscussionStatus, number>;
  for (const row of rows) byStatus[row.status] = row.count;
  return {
    total: rows.reduce((sum, row) => sum + row.count, 0),
    byStatus,
    averageTimeToFirstTranscriptMs: timing.first_ms == null ? null : Math.max(0, Math.round(timing.first_ms)),
    averageTimeToCompleteMs: timing.complete_ms == null ? null : Math.max(0, Math.round(timing.complete_ms)),
    totalSegments: segmentMetrics.total,
    failedSegments: segmentMetrics.failed ?? 0,
    retriedSegments: segmentMetrics.retried ?? 0,
    averageSegmentLatencyMs: segmentMetrics.latency_ms == null
      ? null
      : Math.max(0, Math.round(segmentMetrics.latency_ms)),
  };
}

export function updateDiscussionCapture(
  id: string,
  patch: Partial<Omit<DiscussionCapture, 'id' | 'clientRequestId' | 'noteId' | 'createdAt'>>,
  expectedStatuses?: DiscussionStatus[],
): DiscussionCapture | null {
  const current = getDiscussionCapture(id);
  if (!current || (expectedStatuses && !expectedStatuses.includes(current.status))) return null;
  const next = { ...current, ...patch, updatedAt: patch.updatedAt ?? Date.now() };
  const statusGuard = expectedStatuses?.length ? ` AND status IN (${expectedStatuses.map(() => '?').join(',')})` : '';
  const changes = runSqliteWriteTransaction((db) => db.prepare(`UPDATE discussion_captures SET
    project_id=?, audio_attachment_id=?, source=?, status=?, duration_ms=?, expected_last_sequence=?,
    mime_type=?, audio_size_bytes=?, audio_sha256=?, canonical_transcript=?, canonical_transcript_sha256=?,
    transcript_language=?, transcript_revision=?, generated_title=?, project_inference_score=?,
    project_inference_source=?, failure_stage=?, failure_code=?, failure_message=?, recording_started_at=?,
    recording_stopped_at=?, updated_at=?, completed_at=?, audio_deleted_at=? WHERE id=?${statusGuard}`)
    .run(next.projectId ?? null, next.audioAttachmentId ?? null, next.source, next.status,
      next.durationMs ?? null, next.expectedLastSequence ?? null, next.mimeType ?? null,
      next.audioSizeBytes ?? null, next.audioSha256 ?? null, next.canonicalTranscript ?? null,
      next.canonicalTranscriptSha256 ?? null, next.transcriptLanguage ?? null, next.transcriptRevision,
      next.generatedTitle ?? null, next.projectInferenceScore ?? null, next.projectInferenceSource ?? null,
      next.failureStage ?? null, next.failureCode ?? null, next.failureMessage ?? null,
      next.recordingStartedAt, next.recordingStoppedAt ?? null, next.updatedAt,
      next.completedAt ?? null, next.audioDeletedAt ?? null, id, ...(expectedStatuses ?? [])).changes);
  return changes ? getDiscussionCapture(id) : null;
}

export function claimNextDiscussionCapture(owner: string, now = Date.now(), leaseMs = 5 * 60_000): DiscussionCapture | null {
  return runSqliteWriteTransaction((db) => {
    const row = db.prepare(`SELECT * FROM discussion_captures
      WHERE status='organizing' AND (work_lease_owner IS NULL OR work_lease_expires_at <= ?)
      ORDER BY updated_at ASC LIMIT 1`).get(now) as (DiscussionRow & { work_lease_owner: string | null }) | undefined;
    if (!row) return null;
    const changed = db.prepare(`UPDATE discussion_captures SET work_lease_owner=?, work_lease_expires_at=?, updated_at=?
      WHERE id=? AND status='organizing' AND (work_lease_owner IS NULL OR work_lease_expires_at <= ?)`)
      .run(owner, now + leaseMs, now, row.id, now).changes;
    return changed ? getDiscussionCapture(row.id) : null;
  });
}

export function releaseDiscussionWorkLease(id: string): void {
  runSqliteWriteTransaction((db) => db.prepare(
    'UPDATE discussion_captures SET work_lease_owner=NULL, work_lease_expires_at=NULL WHERE id=?',
  ).run(id));
}

export function createDiscussionTranscriptSegment(input: {
  discussionId: string; sequence: number; audioSha256: string; audioBuffer: Buffer;
  startedAtMs: number; endedAtMs: number; now?: number;
}): DiscussionTranscriptSegment {
  const existing = getDiscussionTranscriptSegment(input.discussionId, input.sequence);
  if (existing) return existing;
  const now = input.now ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(`INSERT INTO discussion_transcript_segments (
      discussion_id, sequence, audio_sha256, audio_blob, started_at_ms, ended_at_ms,
      status, revision, corrected_by_user, attempt_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'uploaded', 1, 0, 0, ?, ?)`)
      .run(input.discussionId, input.sequence, input.audioSha256, input.audioBuffer,
        input.startedAtMs, input.endedAtMs, now, now);
    db.prepare('UPDATE discussion_captures SET transcript_revision=transcript_revision+1, updated_at=? WHERE id=?')
      .run(now, input.discussionId);
  });
  return getDiscussionTranscriptSegment(input.discussionId, input.sequence)!;
}

export function getDiscussionTranscriptSegment(discussionId: string, sequence: number): DiscussionTranscriptSegment | null {
  const row = getSqliteDatabase().prepare(
    'SELECT * FROM discussion_transcript_segments WHERE discussion_id=? AND sequence=?',
  ).get(discussionId, sequence) as SegmentRow | undefined;
  return row ? segmentFromRow(row) : null;
}

export function listDiscussionTranscriptSegments(discussionId: string): DiscussionTranscriptSegment[] {
  return (getSqliteDatabase().prepare(
    'SELECT * FROM discussion_transcript_segments WHERE discussion_id=? ORDER BY sequence',
  ).all(discussionId) as SegmentRow[]).map(segmentFromRow);
}

export function claimNextDiscussionTranscriptSegment(
  owner: string, now = Date.now(), leaseMs = 2 * 60_000,
): ClaimedDiscussionTranscriptSegment | null {
  return runSqliteWriteTransaction((db) => {
    const row = db.prepare(`SELECT s.* FROM discussion_transcript_segments s
      JOIN discussion_captures d ON d.id=s.discussion_id
      WHERE (s.status='uploaded' OR (s.status='transcribing' AND s.lease_expires_at <= ?))
        AND d.status IN ('recording','stopping','sealing')
        AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= ?)
      ORDER BY s.created_at, s.sequence LIMIT 1`).get(now, now) as SegmentRow | undefined;
    if (!row?.audio_blob) return null;
    const changed = db.prepare(`UPDATE discussion_transcript_segments SET status='transcribing',
      attempt_count=attempt_count+1, next_attempt_at=NULL, lease_owner=?, lease_expires_at=?,
      revision=revision+1, updated_at=? WHERE discussion_id=? AND sequence=?
      AND (status='uploaded' OR (status='transcribing' AND lease_expires_at <= ?))`)
      .run(owner, now + leaseMs, now, row.discussion_id, row.sequence, now).changes;
    if (!changed) return null;
    const claimed = db.prepare('SELECT * FROM discussion_transcript_segments WHERE discussion_id=? AND sequence=?')
      .get(row.discussion_id, row.sequence) as SegmentRow;
    return { ...segmentFromRow(claimed), audioBuffer: Buffer.from(claimed.audio_blob!) };
  });
}

export function completeDiscussionTranscriptSegment(
  discussionId: string, sequence: number, owner: string, text: string, provider: string,
  language?: string, confidence?: number,
): DiscussionTranscriptSegment | null {
  const now = Date.now();
  const changes = runSqliteWriteTransaction((db) => {
    const changed = db.prepare(`UPDATE discussion_transcript_segments SET status='confirmed',
      raw_text=?, display_text=?, provider=?, language=?, confidence=?, audio_blob=NULL,
      lease_owner=NULL, lease_expires_at=NULL, next_attempt_at=NULL, last_error=NULL,
      revision=revision+1, updated_at=? WHERE discussion_id=? AND sequence=?
      AND status='transcribing' AND lease_owner=?`)
      .run(text, text, provider, language ?? null, confidence ?? null, now, discussionId, sequence, owner).changes;
    if (changed) db.prepare('UPDATE discussion_captures SET transcript_revision=transcript_revision+1, updated_at=? WHERE id=?')
      .run(now, discussionId);
    return changed;
  });
  return changes ? getDiscussionTranscriptSegment(discussionId, sequence) : null;
}

export function correctDiscussionTranscriptSegment(
  discussionId: string, sequence: number, displayText: string, expectedRevision: number,
): DiscussionTranscriptSegment | null {
  const now = Date.now();
  const changes = runSqliteWriteTransaction((db) => {
    const changed = db.prepare(`UPDATE discussion_transcript_segments SET display_text=?, corrected_by_user=1,
      corrected_at=?, revision=revision+1, updated_at=? WHERE discussion_id=? AND sequence=?
      AND status='confirmed' AND revision=?`)
      .run(displayText, now, now, discussionId, sequence, expectedRevision).changes;
    if (changed) db.prepare('UPDATE discussion_captures SET transcript_revision=transcript_revision+1, updated_at=? WHERE id=?')
      .run(now, discussionId);
    return changed;
  });
  return changes ? getDiscussionTranscriptSegment(discussionId, sequence) : null;
}

export function retryOrFailDiscussionTranscriptSegment(
  discussionId: string, sequence: number, owner: string, error: string, exhausted: boolean,
): DiscussionTranscriptSegment | null {
  const now = Date.now();
  const changes = runSqliteWriteTransaction((db) => db.prepare(`UPDATE discussion_transcript_segments SET
    status=?, lease_owner=NULL, lease_expires_at=NULL, next_attempt_at=?, last_error=?,
    audio_blob=CASE WHEN ? THEN NULL ELSE audio_blob END, revision=revision+1, updated_at=?
    WHERE discussion_id=? AND sequence=? AND status='transcribing' AND lease_owner=?`)
    .run(exhausted ? 'failed' : 'uploaded', exhausted ? null : now + 2_000,
      error.slice(0, 1_000), exhausted ? 1 : 0, now, discussionId, sequence, owner).changes);
  return changes ? getDiscussionTranscriptSegment(discussionId, sequence) : null;
}

export function deleteDiscussionSegmentAudio(discussionId: string): void {
  runSqliteWriteTransaction((db) => db.prepare(
    'UPDATE discussion_transcript_segments SET audio_blob=NULL WHERE discussion_id=?',
  ).run(discussionId));
}

export function createDiscussionOrganization(input: {
  discussionId: string; inputTranscriptSha256: string; promptVersion: string; modelRef: string;
}): DiscussionOrganizationRecord {
  const now = Date.now();
  const revision = (getLatestDiscussionOrganization(input.discussionId)?.revision ?? 0) + 1;
  const id = randomUUID();
  runSqliteWriteTransaction((db) => db.prepare(`INSERT INTO discussion_organizations (
    id, discussion_id, revision, input_transcript_sha256, prompt_version, model_ref, status, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`)
    .run(id, input.discussionId, revision, input.inputTranscriptSha256, input.promptVersion, input.modelRef, now));
  return getLatestDiscussionOrganization(input.discussionId)!;
}

export function getLatestDiscussionOrganization(discussionId: string): DiscussionOrganizationRecord | null {
  const row = getSqliteDatabase().prepare(
    'SELECT * FROM discussion_organizations WHERE discussion_id=? ORDER BY revision DESC LIMIT 1',
  ).get(discussionId) as OrganizationRow | undefined;
  return row ? organizationFromRow(row) : null;
}

export function completeDiscussionOrganization(id: string, organization: DiscussionOrganization): DiscussionOrganizationRecord | null {
  const now = Date.now();
  const changes = runSqliteWriteTransaction((db) => db.prepare(`UPDATE discussion_organizations SET
    organization_json=?, status='completed', error_message=NULL, completed_at=? WHERE id=? AND status='running'`)
    .run(JSON.stringify(organization), now, id).changes);
  if (!changes) return null;
  const row = getSqliteDatabase().prepare('SELECT * FROM discussion_organizations WHERE id=?')
    .get(id) as OrganizationRow;
  return organizationFromRow(row);
}

export function failDiscussionOrganization(id: string, error: string): void {
  runSqliteWriteTransaction((db) => db.prepare(`UPDATE discussion_organizations SET
    status='failed', error_message=?, completed_at=? WHERE id=? AND status='running'`)
    .run(error.slice(0, 1_000), Date.now(), id));
}

export function getDiscussionCaptureSettings(): DiscussionCaptureSettings {
  const row = getSqliteDatabase().prepare(`SELECT consent_policy_version, consent_acknowledged_at
    FROM discussion_capture_settings WHERE workspace_id='default'`)
    .get() as { consent_policy_version: number; consent_acknowledged_at: number | null };
  return { consentPolicyVersion: row.consent_policy_version,
    ...optional(row.consent_acknowledged_at != null, { consentAcknowledgedAt: row.consent_acknowledged_at! }) };
}

export function acknowledgeDiscussionCaptureConsent(policyVersion: number): DiscussionCaptureSettings {
  const now = Date.now();
  runSqliteWriteTransaction((db) => db.prepare(`UPDATE discussion_capture_settings
    SET consent_acknowledged_at=?, updated_at=? WHERE workspace_id='default' AND consent_policy_version=?`)
    .run(now, now, policyVersion));
  return getDiscussionCaptureSettings();
}
