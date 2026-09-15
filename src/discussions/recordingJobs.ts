import { createHash, randomUUID } from 'node:crypto';

import type { DiscussionRecordingJob, DiscussionRecordingManifest } from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import { DiscussionServiceError } from './errors.js';
import { listRecordingChunks } from './recording.js';

const LEASE_MS = 60_000;

type JobRow = { id: string; discussion_id: string; input_json: string; manifest_hash: string; state: DiscussionRecordingJob['state']; error: string | null };
function mapJob(row: JobRow): DiscussionRecordingJob {
  return { id: row.id, discussionId: row.discussion_id, state: row.state, ...(row.error ? { error: row.error } : {}) };
}

export function getRecordingJob(discussionId: string): DiscussionRecordingJob | null {
  const row = getSqliteDatabase().prepare('SELECT * FROM discussion_recording_jobs WHERE discussion_id=?').get(discussionId) as JobRow | undefined;
  return row ? mapJob(row) : null;
}

export function getRecordingJobInput(discussionId: string): DiscussionRecordingManifest | null {
  const row = getSqliteDatabase().prepare('SELECT input_json FROM discussion_recording_jobs WHERE discussion_id=?').get(discussionId) as { input_json: string } | undefined;
  return row ? JSON.parse(row.input_json) as DiscussionRecordingManifest : null;
}

export function submitRecordingJob(discussionId: string, input: DiscussionRecordingManifest): DiscussionRecordingJob {
  const inputJson = JSON.stringify({ chunkCount: input.chunkCount, mimeType: input.mimeType, fileName: input.fileName, lastSequence: input.lastSequence });
  return runSqliteWriteTransaction(db => {
    const chunks = listRecordingChunks(discussionId);
    const manifestHash = createHash('sha256').update(inputJson).update(JSON.stringify(chunks)).digest('hex');
    const existing = db.prepare('SELECT * FROM discussion_recording_jobs WHERE discussion_id=?').get(discussionId) as JobRow | undefined;
    if (existing && existing.input_json !== inputJson) throw new DiscussionServiceError('conflict', 'Recording manifest differs from the submitted recording');
    if (existing && chunks.length && existing.manifest_hash !== manifestHash) throw new DiscussionServiceError('conflict', 'Recording contents differ from the submitted manifest');
    if (existing?.state === 'cancelled') throw new DiscussionServiceError('conflict', 'Recording job was cancelled');
    if (existing?.state === 'failed') db.prepare("UPDATE discussion_recording_jobs SET state='queued', error=NULL, updated_at=? WHERE id=?").run(Date.now(), existing.id);
    if (!existing) db.prepare("INSERT INTO discussion_recording_jobs (id, discussion_id, input_json, manifest_hash, state, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)").run(randomUUID(), discussionId, inputJson, manifestHash, Date.now(), Date.now());
    return getRecordingJob(discussionId)!;
  });
}

export function claimRecordingJob(owner: string, now = Date.now()) {
  return runSqliteWriteTransaction(db => {
    const row = db.prepare(`SELECT j.* FROM discussion_recording_jobs j JOIN discussion_captures d ON d.id=j.discussion_id
      WHERE (j.state='queued' OR (j.state='running' AND j.lease_until<=?))
      AND (d.status IN ('recording','stopping','needs_attention') OR d.audio_attachment_id IS NOT NULL)
      AND d.status<>'cancelled' AND d.audio_deleted_at IS NULL
      ORDER BY j.created_at LIMIT 1`).get(now) as JobRow | undefined;
    if (!row) return null;
    db.prepare("UPDATE discussion_recording_jobs SET state='running', lease_owner=?, lease_until=?, updated_at=? WHERE id=?").run(owner, now + LEASE_MS, now, row.id);
    return { ...mapJob(row), input: JSON.parse(row.input_json) as DiscussionRecordingManifest };
  });
}

export function renewRecordingJob(id: string, owner: string, now = Date.now()): boolean {
  return getSqliteDatabase().prepare("UPDATE discussion_recording_jobs SET lease_until=? WHERE id=? AND state='running' AND lease_owner=? AND lease_until>?").run(now + LEASE_MS, id, owner, now).changes === 1;
}

export function finishRecordingJob(id: string, owner: string, error?: string): boolean {
  return getSqliteDatabase().prepare(`UPDATE discussion_recording_jobs SET state=?, error=?, lease_owner=NULL, lease_until=NULL, updated_at=?
    WHERE id=? AND state='running' AND lease_owner=? AND lease_until>?`).run(error === undefined ? 'completed' : 'failed', error?.slice(0, 1_000) ?? null, Date.now(), id, owner, Date.now()).changes === 1;
}

export function cancelRecordingJob(discussionId: string): void {
  getSqliteDatabase().prepare("UPDATE discussion_recording_jobs SET state='cancelled', lease_owner=NULL, lease_until=NULL, updated_at=? WHERE discussion_id=? AND state<>'completed'").run(Date.now(), discussionId);
}
