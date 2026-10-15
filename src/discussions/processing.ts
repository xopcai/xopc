import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import { getDiscussionCapture, updateDiscussionCapture } from './repository.js';
import type { DiscussionCapture, DiscussionProcessingProgress } from './types.js';

export interface RecoveredTranscriptSegment {
  text: string;
  startedAtMs: number;
  endedAtMs: number;
  speakerLabel?: string;
  correctedByUser?: boolean;
  rawText?: string;
}
export interface TranscriptionCheckpoint { segments: RecoveredTranscriptSegment[]; language?: string }
export interface ProcessingRun {
  discussion_id: string;
  run_id: string;
  audio_sha256: string | null;
  base_transcript_revision: number;
  force_audio: number;
  retry_stage: string | null;
  attempt_count: number;
  next_attempt_at: number | null;
  lease_owner: string | null;
  lease_until: number | null;
}
const LEASE_MS = 60_000;
export const PROCESSING_MAX_ATTEMPTS = 3;

export function getProcessingRun(id: string): ProcessingRun | undefined {
  return getSqliteDatabase().prepare('SELECT * FROM discussion_processing WHERE discussion_id=?').get(id) as unknown as ProcessingRun | undefined;
}

/** A new original-audio generation leaves published transcript/summary revisions untouched. */
export function createProcessingRun(capture: DiscussionCapture, forceAudio = false): ProcessingRun {
  return runSqliteWriteTransaction(db => {
    db.prepare('DELETE FROM discussion_processing WHERE discussion_id=?').run(capture.id);
    db.prepare(`INSERT INTO discussion_processing (discussion_id, run_id, audio_sha256, base_transcript_revision, force_audio)
      VALUES (?, ?, ?, ?, ?)`).run(capture.id, randomUUID(), capture.audioSha256 ?? null, capture.transcriptRevision, forceAudio ? 1 : 0);
    return getProcessingRun(capture.id)!;
  });
}

export function ensureProcessingRun(capture: DiscussionCapture, alignSource = false): ProcessingRun {
  const run = getProcessingRun(capture.id);
  return !run || (alignSource && (run.audio_sha256 !== (capture.audioSha256 ?? null) || run.base_transcript_revision !== capture.transcriptRevision))
    ? createProcessingRun(capture, run?.force_audio === 1) : run;
}

export function resetProcessingRetry(id: string): void {
  getSqliteDatabase().prepare('UPDATE discussion_processing SET retry_stage=NULL, attempt_count=0, next_attempt_at=NULL WHERE discussion_id=?').run(id);
}

export function processingProgress(id: string): DiscussionProcessingProgress | undefined {
  const run = getProcessingRun(id);
  if (!run) return undefined;
  const row = getSqliteDatabase().prepare(`SELECT COUNT(*) count, COALESCE(SUM(ended_at_ms-started_at_ms),0) duration
    FROM discussion_transcription_checkpoints WHERE run_id=?`).get(run.run_id) as { count: number; duration: number };
  return { fromAudio: run.force_audio === 1, completedChunks: row.count, transcribedMs: Math.round(row.duration),
    attemptCount: run.attempt_count, maxAttempts: PROCESSING_MAX_ATTEMPTS,
    ...(run.next_attempt_at !== null ? { nextAttemptAt: run.next_attempt_at } : {}) };
}

export function claimSealingCapture(owner: string, now: number): DiscussionCapture | null {
  return runSqliteWriteTransaction(db => {
    const row = db.prepare(`SELECT d.id FROM discussion_captures d LEFT JOIN discussion_processing p ON p.discussion_id=d.id
      WHERE d.status IN ('stopping','sealing') AND (p.next_attempt_at IS NULL OR p.next_attempt_at<=?)
      AND (p.lease_until IS NULL OR p.lease_until<=?) ORDER BY d.updated_at, d.id LIMIT 1`).get(now, Date.now()) as { id: string } | undefined;
    if (!row) return null;
    const capture = getDiscussionCapture(row.id)!;
    ensureProcessingRun(capture, true);
    db.prepare('UPDATE discussion_processing SET lease_owner=?, lease_until=? WHERE discussion_id=?').run(owner, Date.now() + LEASE_MS, row.id);
    return capture;
  });
}

export function renewSealingLease(id: string, owner: string): boolean {
  return getSqliteDatabase().prepare(`UPDATE discussion_processing SET lease_until=? WHERE discussion_id=? AND lease_owner=? AND lease_until>?`)
    .run(Date.now() + LEASE_MS, id, owner, Date.now()).changes === 1;
}
export function releaseSealingLease(id: string, owner: string): void {
  getSqliteDatabase().prepare('UPDATE discussion_processing SET lease_owner=NULL,lease_until=NULL WHERE discussion_id=? AND lease_owner=?').run(id, owner);
}

export function assertProcessingRun(run: ProcessingRun, owner: string, signal: AbortSignal): void {
  signal.throwIfAborted();
  const current = getDiscussionCapture(run.discussion_id);
  if (!current || current.status !== 'sealing' || current.audioDeletedAt || current.audioSha256 !== (run.audio_sha256 ?? undefined)
    || current.transcriptRevision !== run.base_transcript_revision || getProcessingRun(current.id)?.run_id !== run.run_id
    || !renewSealingLease(current.id, owner)) throw new Error('Transcription processing lease or source revision changed');
}

export function readCheckpoint(runId: string, start: number, end: number): TranscriptionCheckpoint | undefined {
  const row = getSqliteDatabase().prepare('SELECT result_json FROM discussion_transcription_checkpoints WHERE run_id=? AND started_at_ms=? AND ended_at_ms=?')
    .get(runId, start, end) as { result_json: string } | undefined;
  return row ? JSON.parse(row.result_json) as TranscriptionCheckpoint : undefined;
}
export function saveCheckpoint(runId: string, start: number, end: number, result: TranscriptionCheckpoint): void {
  getSqliteDatabase().prepare(`INSERT INTO discussion_transcription_checkpoints (run_id,started_at_ms,ended_at_ms,result_json,created_at) VALUES (?,?,?,?,?)`)
    .run(runId, start, end, JSON.stringify(result), Date.now());
}

export function isTransientProcessingError(error: unknown, depth = 0): boolean {
  if (depth > 3) return false;
  const item = error as { status?: number; statusCode?: number; code?: string; reasonCode?: string; cause?: unknown } | undefined;
  const status = item?.status ?? item?.statusCode;
  if (status !== undefined) return [408, 425, 429].includes(status) || status >= 500;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/not configured|no model configured|no api key|invalid.*key|unauthorized|forbidden|authentication|unsupported|invalid.*(audio|time range)|no text|audio.*missing|checksum mismatch|transcript.*missing|ENOENT|lease|revision changed/i.test(text)) return false;
  if (item?.reasonCode === 'not_configured' || item?.reasonCode === 'unsupported_format') return false;
  if (item?.reasonCode === 'timeout' || item?.reasonCode === 'provider_error') return true;
  if (/timeout|timed out|rate.?limit|temporar|unavailable|fetch failed|network|connection error|ECONN|ETIMEDOUT|EAI_AGAIN|socket|overload|internal server|server error|try again|invalid discussion organization|invalid evidence|truncated|\b(408|429|5\d\d)\b|SyntaxError/i.test(text)) return true;
  return item?.cause !== undefined && item.cause !== error ? isTransientProcessingError(item.cause, depth + 1) : false;
}

/** Persist bounded retries instead of sleeping inside a worker and blocking other recordings. */
export function failOrRetryProcessing(capture: DiscussionCapture, stage: 'transcript_sealing' | 'organization', error: unknown): DiscussionCapture | null {
  return runSqliteWriteTransaction(db => {
    const current = getDiscussionCapture(capture.id);
    if (!current || current.status !== (stage === 'organization' ? 'organizing' : 'sealing')) return null;
    const run = ensureProcessingRun(current);
    const attempts = (run.retry_stage === stage ? run.attempt_count : 0) + 1;
    const retry = attempts < PROCESSING_MAX_ATTEMPTS && isTransientProcessingError(error);
    const next = retry ? Date.now() + 5_000 * 4 ** (attempts - 1) : null;
    db.prepare('UPDATE discussion_processing SET retry_stage=?,attempt_count=?,next_attempt_at=? WHERE discussion_id=?')
      .run(stage, attempts, next, capture.id);
    return updateDiscussionCapture(capture.id, { status: retry ? current.status : 'needs_attention',
      failureStage: stage, failureCode: retry ? 'processing_retry_scheduled' : `${stage}_failed`,
      failureMessage: (error instanceof Error ? error.message : String(error)).slice(0, 1_000),
    }, [current.status]);
  });
}

/** Race the signal as well as passing it downstream, so an uncooperative provider cannot hold the worker. */
export async function withProcessingDeadline<T>(work: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, timeoutMs: number): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error('Processing request timed out')), timeoutMs);
  timer.unref();
  const signal = AbortSignal.any([parent, timeout.signal]);
  let abort!: () => void;
  try {
    signal.throwIfAborted();
    const aborted = new Promise<never>((_resolve, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); });
    return await Promise.race([work(signal), aborted]);
  } finally { clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort); }
}
