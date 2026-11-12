import { randomUUID } from 'node:crypto';

import { estimateVideoCostFen, VIDEO_MODELS, type VideoGenerationDraft, type VideoGenerationJob, type VideoGenerationState } from '@xopcai/gateway-contract';

import { getVideoModel } from './settings.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { archiveSpaceGeneratedMedia } from '../space/ingest.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

type VideoRequest = Pick<VideoGenerationJob, 'id' | 'transcriptId' | 'prompt' | 'duration' | 'ratio' | 'resolution' | 'imageName' | 'modelRef'>;
type VideoJobPlacement = Pick<VideoGenerationJob, 'draftCreatedAt' | 'summary'>;
const jobPlacements = new DurableState<Record<string, VideoJobPlacement>>('video-generation-job-placement');

interface JobRow {
  id: string;
  conversation_id: string;
  transcript_id: string;
  request_hash: string;
  model_ref: VideoGenerationJob['modelRef'];
  prompt: string;
  duration: number;
  ratio: VideoGenerationJob['ratio'];
  resolution: VideoGenerationJob['resolution'];
  image_name: string | null;
  image_mime: string | null;
  image_bytes: Uint8Array | null;
  state: VideoGenerationState;
  provider_task_id: string | null;
  error: string | null;
  created_at: number;
}

export function publicVideoJob(row: JobRow, placement?: VideoJobPlacement): VideoGenerationJob {
  return {
    id: row.id, transcriptId: row.transcript_id, modelRef: row.model_ref, prompt: row.prompt, duration: row.duration,
    ratio: row.ratio, resolution: row.resolution, imageName: row.image_name,
    state: row.state, error: row.error, createdAt: row.created_at, ...placement,
  };
}

export function listVideoJobs(conversationId: string): VideoGenerationJob[] {
  const placements = jobPlacements.get(conversationId);
  return (getSqliteDatabase().prepare(`SELECT id, transcript_id, model_ref, prompt, duration, ratio, resolution,
    image_name, state, error, created_at FROM video_generation_jobs WHERE conversation_id = ?
    ORDER BY created_at DESC, rowid DESC`).all(conversationId) as unknown as JobRow[]).map(row => publicVideoJob(row, placements?.[row.id]));
}

export function deleteVideoJobPlacements(conversationId: string): void {
  jobPlacements.delete(conversationId);
}

export function listVideoJobIds(conversationId: string): string[] {
  return getSqliteDatabase().prepare('SELECT id FROM video_generation_jobs WHERE conversation_id = ?')
    .all(conversationId).map(row => String(row.id));
}

export function getVideoJob(conversationId: string, id: string): JobRow | undefined {
  return getSqliteDatabase().prepare('SELECT * FROM video_generation_jobs WHERE conversation_id = ? AND id = ?')
    .get(conversationId, id) as unknown as JobRow | undefined;
}

export function enqueueVideoJob(conversationId: string, request: VideoRequest, requestHash: string,
  image?: { bytes: Buffer; mime: string }, draft?: Pick<VideoGenerationDraft, 'createdAt' | 'summary'>) {
  return runSqliteWriteTransaction(db => {
    const session = db.prepare('SELECT active_transcript_id FROM sessions WHERE conversation_id = ?').get(conversationId);
    if (session?.active_transcript_id !== request.transcriptId) return { error: 'conversation_changed' } as const;
    const existing = db.prepare('SELECT * FROM video_generation_jobs WHERE id = ?').get(request.id) as unknown as JobRow | undefined;
    if (existing) {
      return existing.conversation_id === conversationId && existing.request_hash === requestHash && existing.model_ref === request.modelRef
        ? { job: publicVideoJob(existing, jobPlacements.get(conversationId)?.[existing.id]) }
        : { error: 'idempotency_conflict' } as const;
    }
    if (getVideoModel() !== request.modelRef) return { error: 'model_changed' } as const;
    const active = db.prepare(`SELECT count(*) AS count FROM video_generation_jobs
      WHERE state IN ('queued','submitting','submitted','running','saving')`).get();
    if (Number(active?.count) >= 3) return { error: 'queue_full' } as const;

    const now = Date.now();
    const day = Math.floor(now / 86_400_000);
    const provider = VIDEO_MODELS[request.modelRef].provider;
    const configuredBudget = (provider === 'dashscope-cn'
      ? process.env.XOPC_WAN_DAILY_BUDGET_CNY : process.env.XOPC_SEEDANCE_DAILY_BUDGET_CNY)?.trim();
    const budget = configuredBudget ? Number(configuredBudget) : Number.NaN;
    const budgetFen = Number.isFinite(budget) && budget >= 0 ? Math.floor(budget * 100) : Infinity;
    const costFen = estimateVideoCostFen(request.modelRef, request.duration, request.resolution);
    const reserved = Number(db.prepare('SELECT reserved_fen FROM video_generation_provider_budget WHERE provider = ? AND day = ?').get(provider, day)?.reserved_fen ?? 0);
    if (reserved + costFen > budgetFen) return { error: 'budget_exhausted' } as const;
    db.prepare(`INSERT INTO video_generation_provider_budget (provider, day, reserved_fen) VALUES (?, ?, ?)
      ON CONFLICT(provider, day) DO UPDATE SET reserved_fen = reserved_fen + excluded.reserved_fen`).run(provider, day, costFen);
    db.prepare(`INSERT INTO video_generation_jobs (id, conversation_id, transcript_id, request_hash, model_ref,
      prompt, duration, ratio, resolution, image_name, image_mime, image_bytes, state, next_attempt_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`).run(request.id, conversationId,
      request.transcriptId, requestHash, request.modelRef, request.prompt, request.duration, request.ratio, request.resolution,
      request.imageName, image?.mime ?? null, image?.bytes ?? null, now, now);
    const placement = draft ? { draftCreatedAt: draft.createdAt, summary: draft.summary } : undefined;
    if (placement) {
      jobPlacements.set(conversationId, { ...jobPlacements.get(conversationId), [request.id]: placement });
    }
    return { job: publicVideoJob(getVideoJob(conversationId, request.id)!, placement) };
  });
}

export function claimVideoJob(now = Date.now()) {
  return runSqliteWriteTransaction(db => {
    // A lost submit response can represent a paid request. Resume only work with a known remote ID.
    db.prepare(`UPDATE video_generation_jobs SET state = 'submission_unknown', image_bytes = NULL,
      error = 'The provider may have accepted the request. Check its console before generating again.',
      lease_token = NULL, lease_until = NULL WHERE state = 'submitting' AND lease_until <= ?`).run(now);
    const row = db.prepare(`SELECT * FROM video_generation_jobs
      WHERE state IN ('queued','submitted','running','saving') AND next_attempt_at <= ?
      AND (lease_until IS NULL OR lease_until <= ?) ORDER BY next_attempt_at, rowid LIMIT 1`)
      .get(now, now) as unknown as JobRow | undefined;
    if (!row) return null;
    const token = randomUUID();
    db.prepare('UPDATE video_generation_jobs SET lease_token = ?, lease_until = ? WHERE id = ?')
      .run(token, now + 60_000, row.id);
    return { row, token };
  });
}

export function beginVideoSubmission(id: string, token: string): boolean {
  return getSqliteDatabase().prepare(`UPDATE video_generation_jobs SET state = 'submitting'
    WHERE id = ? AND lease_token = ? AND lease_until > ? AND state = 'queued'`)
    .run(id, token, Date.now()).changes === 1;
}

export function updateVideoJob(id: string, token: string, state: VideoGenerationState, options: {
  providerTaskId?: string; delayMs?: number; error?: string; keepLease?: boolean;
} = {}): boolean {
  const now = Date.now();
  const update = (db: ReturnType<typeof getSqliteDatabase>) => db.prepare(`UPDATE video_generation_jobs SET state = ?, error = ?,
    provider_task_id = COALESCE(?, provider_task_id), next_attempt_at = ?,
    lease_token = CASE WHEN ? THEN lease_token ELSE NULL END,
    lease_until = CASE WHEN ? THEN lease_until ELSE NULL END,
    image_bytes = CASE WHEN ? = 'queued' THEN image_bytes ELSE NULL END
    WHERE id = ? AND lease_token = ? AND lease_until > ?`).run(state, options.error ?? null,
    options.providerTaskId ?? null, now + (options.delayMs ?? 0), Number(options.keepLease ?? false),
    Number(options.keepLease ?? false), state, id, token, now).changes === 1;
  if (state !== 'completed') return update(getSqliteDatabase());
  return runSqliteWriteTransaction(db => {
    const updated = update(db);
    if (updated) archiveSpaceGeneratedMedia(db, 'video', id);
    return updated;
  });
}
