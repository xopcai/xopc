import { createHash, randomUUID } from 'node:crypto';

import type { MusicGenerationJob, MusicJobErrorCode, MusicJobState, MusicMode } from '@xopcai/gateway-contract';

import { archiveSpaceGeneratedMedia } from '../space/ingest.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { configuredMusicModel } from './providers.js';

export interface MusicJobRow {
  id: string;
  conversation_id: string;
  transcript_id: string;
  work_id: string;
  parent_id: string | null;
  version_number: number;
  model_ref: string;
  request_hash: string;
  title: string;
  mode: MusicMode;
  prompt: string;
  lyrics: string | null;
  state: MusicJobState;
  provider_task_id: string | null;
  duration_ms: number | null;
  error: string | null;
  error_code: MusicJobErrorCode | null;
  created_at: number;
}

export function publicMusicJob(row: MusicJobRow): MusicGenerationJob {
  return {
    id: row.id, workId: row.work_id, parentId: row.parent_id, versionNumber: row.version_number,
    modelRef: row.model_ref, title: row.title,
    mode: row.mode, prompt: row.prompt, lyrics: row.lyrics, state: row.state, durationMs: row.duration_ms,
    error: row.error, errorCode: row.error_code, createdAt: row.created_at,
  };
}

export function listMusicJobs(conversationId: string, transcriptId: string): MusicGenerationJob[] {
  return (getSqliteDatabase().prepare(`SELECT * FROM music_generation_jobs WHERE conversation_id = ?
    AND transcript_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100`).all(conversationId, transcriptId) as unknown as MusicJobRow[])
    .map(publicMusicJob);
}

export function listMusicJobIds(conversationId: string): string[] {
  return getSqliteDatabase().prepare('SELECT id FROM music_generation_jobs WHERE conversation_id = ?')
    .all(conversationId).map(row => String(row.id));
}

export function getMusicJob(conversationId: string, id: string): MusicJobRow | undefined {
  return getSqliteDatabase().prepare('SELECT * FROM music_generation_jobs WHERE conversation_id = ? AND id = ?')
    .get(conversationId, id) as unknown as MusicJobRow | undefined;
}

type MusicRequest = {
  parentId?: string;
  title?: string;
  mode?: MusicMode;
  prompt?: string;
  lyrics?: string;
};

export async function enqueueMusicJob(conversationId: string, transcriptId: string, toolCallId: string, request: MusicRequest, signal?: AbortSignal) {
  const id = createHash('sha256').update(JSON.stringify([conversationId, transcriptId, toolCallId])).digest('hex');
  const hash = createHash('sha256').update(JSON.stringify([
    request.parentId, request.title, request.mode, request.prompt, request.lyrics,
  ])).digest('hex');
  const route = await configuredMusicModel();
  signal?.throwIfAborted();
  return runSqliteWriteTransaction(db => {
    if (db.prepare('SELECT active_transcript_id FROM sessions WHERE conversation_id = ?').get(conversationId)
      ?.active_transcript_id !== transcriptId) return { error: 'The chat was reset. Ask the user to send the request again.' };

    const previous = getMusicJob(conversationId, id);
    if (previous) return previous.request_hash === hash
      ? { job: publicMusicJob(previous) }
      : { error: 'This request has already been submitted with different input.' };

    const parent = request.parentId ? getMusicJob(conversationId, request.parentId) : undefined;
    if (request.parentId && (parent?.transcript_id !== transcriptId || parent.state !== 'completed')) {
      return { error: 'Select a completed version from the current chat.' };
    }
    if (!route) return { error: 'Music generation is unavailable. Configure the Gateway music model and its API key.' };
    const mode = request.mode ?? (request.lyrics ? 'song' : parent?.mode ?? route.defaults.mode);
    const title = (request.title ?? parent?.title)?.trim();
    const prompt = (request.prompt ?? parent?.prompt)?.trim();
    const lyrics = mode === 'song' ? request.lyrics ?? parent?.lyrics ?? null : null;
    if (mode === 'song' && !lyrics?.trim()) {
      return { error: 'Song generation requires lyrics. Provide complete lyrics, or use instrumental mode.' };
    }
    if (!route.capabilities.modes.includes(mode) || !title || !prompt || title.length > 100
      || Array.from(prompt).length > route.capabilities.maxPromptCharacters
      || (lyrics !== null && Array.from(lyrics).length > route.capabilities.maxLyricsCharacters)
      || (mode === 'instrumental' && request.lyrics !== undefined)) {
      return { error: 'Invalid music input. Check the selected mode, description and lyrics limits before submitting.' };
    }

    const now = Date.now();
    const active = db.prepare(`SELECT count(*) AS count FROM music_generation_jobs
      WHERE state IN ('queued', 'submitting', 'submitted', 'running', 'saving')`).get();
    if (Number(active?.count) >= 3) return { error: 'The music queue is full. Wait for an active request to finish.' };

    const day = Math.floor(now / 86_400_000);
    const configuredLimit = process.env.XOPC_MUSIC_DAILY_LIMIT?.trim();
    const limit = configuredLimit ? Number(configuredLimit) : 20;
    if (!Number.isSafeInteger(limit) || limit < 0) return { error: 'Invalid Gateway music daily limit.' };
    const usage = Number(db.prepare('SELECT count AS used FROM music_generation_daily_usage WHERE day = ?').get(day)?.used ?? 0);
    if (usage >= limit) return { error: 'The Gateway has reached its daily music generation limit.' };

    db.prepare(`INSERT INTO music_generation_daily_usage (day, count) VALUES (?, 1)
      ON CONFLICT(day) DO UPDATE SET count = count + 1`).run(day);
    const workId = parent?.work_id ?? id;
    const version = Number(db.prepare('SELECT MAX(version_number) AS version FROM music_generation_jobs WHERE work_id = ?')
      .get(workId)?.version ?? 0) + 1;
    db.prepare(`INSERT INTO music_generation_jobs (id, conversation_id, transcript_id, work_id, parent_id, version_number, model_ref,
      request_hash, title, mode, prompt, lyrics, state, next_attempt_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`).run(
      id, conversationId, transcriptId, workId, parent?.id ?? null, version, route.ref, hash,
      title, mode, prompt, lyrics, now, now,
    );
    return { job: publicMusicJob(getMusicJob(conversationId, id)!) };
  });
}

export function claimMusicJob() {
  return runSqliteWriteTransaction(db => {
    const now = Date.now();
    db.prepare(`UPDATE music_generation_jobs SET state = 'submission_unknown', error = NULL, error_code = NULL,
      lease_token = NULL, lease_until = NULL
      WHERE state = 'submitting' AND lease_until <= ?`).run(now);
    const row = db.prepare(`SELECT * FROM music_generation_jobs WHERE state IN ('queued', 'submitted', 'running', 'saving')
      AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until <= ?) ORDER BY next_attempt_at, rowid LIMIT 1`)
      .get(now, now) as unknown as MusicJobRow | undefined;
    if (!row) return undefined;
    const token = randomUUID();
    db.prepare('UPDATE music_generation_jobs SET lease_token = ?, lease_until = ? WHERE id = ?')
      .run(token, now + 120_000, row.id);
    return { row, token };
  });
}

export function updateMusicJob(id: string, token: string, state: MusicJobState, options: {
  taskId?: string; durationMs?: number | null; error?: string; errorCode?: MusicJobErrorCode;
  delayMs?: number; keepLease?: boolean;
} = {}): boolean {
  const now = Date.now();
  const update = (db: ReturnType<typeof getSqliteDatabase>) => db.prepare(`UPDATE music_generation_jobs SET state = ?, error = ?, error_code = ?,
    provider_task_id = COALESCE(?, provider_task_id), duration_ms = COALESCE(?, duration_ms), next_attempt_at = ?,
    lease_token = CASE WHEN ? THEN lease_token END, lease_until = CASE WHEN ? THEN lease_until END
    WHERE id = ? AND lease_token = ? AND lease_until > ?`).run(
    state, options.error ?? null, options.errorCode ?? null,
    options.taskId ?? null, options.durationMs ?? null, now + (options.delayMs ?? 0),
    Number(options.keepLease ?? false), Number(options.keepLease ?? false), id, token, now,
  ).changes === 1;
  if (state !== 'completed') return update(getSqliteDatabase());
  return runSqliteWriteTransaction(db => {
    const updated = update(db);
    if (updated) archiveSpaceGeneratedMedia(db, 'music', id);
    return updated;
  });
}
