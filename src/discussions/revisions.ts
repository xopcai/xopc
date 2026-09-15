import { createHash } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import { getDiscussionCapture, listDiscussionTranscriptSegments, updateDiscussionCapture } from './repository.js';
import { assembleDiscussionTranscript } from './transcript.js';
import type { DiscussionTranscriptSegment } from './types.js';

export function saveTranscriptRevision(id: string): number {
  const capture = getDiscussionCapture(id);
  if (!capture) throw new Error('Discussion not found');
  getSqliteDatabase().prepare('INSERT OR IGNORE INTO discussion_transcript_revisions (discussion_id, revision, segments_json, created_at) VALUES (?, ?, ?, ?)')
    .run(id, capture.transcriptRevision, JSON.stringify(listDiscussionTranscriptSegments(id)), Date.now());
  return capture.transcriptRevision;
}

export function readTranscriptRevision(id: string, revision: number): DiscussionTranscriptSegment[] | null {
  const row = getSqliteDatabase().prepare('SELECT segments_json FROM discussion_transcript_revisions WHERE discussion_id=? AND revision=?').get(id, revision) as { segments_json: string } | undefined;
  return row ? JSON.parse(row.segments_json) as DiscussionTranscriptSegment[] : null;
}

export function replaceTranscriptSegments(id: string, segments: Array<{ text: string; startedAtMs: number; endedAtMs: number; speakerLabel?: string; correctedByUser?: boolean; rawText?: string }>): void {
  runSqliteWriteTransaction((db) => {
    saveTranscriptRevision(id);
    db.prepare('DELETE FROM discussion_transcript_segments WHERE discussion_id=?').run(id);
    const insert = db.prepare(`INSERT INTO discussion_transcript_segments
      (discussion_id, sequence, audio_sha256, started_at_ms, ended_at_ms, status, raw_text, display_text, speaker_label, revision, corrected_by_user, attempt_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, 1, ?, 0, ?, ?)`);
    segments.forEach((segment, index) => insert.run(id, index, createHash('sha256').update(segment.text).digest('hex'), segment.startedAtMs, segment.endedAtMs, segment.rawText ?? segment.text, segment.text, segment.speakerLabel ?? null, segment.correctedByUser ? 1 : 0, Date.now(), Date.now()));
    db.prepare('UPDATE discussion_captures SET transcript_revision=transcript_revision+1 WHERE id=?').run(id);
    saveTranscriptRevision(id);
  });
}

export function refreshCanonicalTranscript(id: string): void {
  const text = assembleDiscussionTranscript(listDiscussionTranscriptSegments(id));
  updateDiscussionCapture(id, { canonicalTranscript: text, canonicalTranscriptSha256: createHash('sha256').update(text).digest('hex') });
}
