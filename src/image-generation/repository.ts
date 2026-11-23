import { createHash, randomUUID } from 'node:crypto';

import type {
  ImageGenerationArtifact,
  ImageGenerationJob,
  ImageJobErrorCode,
  ImageJobState,
} from '@xopcai/gateway-contract';

import type { Config } from '../config/schema.js';
import { resolveImageGenerationModelConfigForTool } from '../agent/tools/image-generate-tool.js';
import { mediaGenerationPhase, notifyMediaGenerationAfterCommit } from '../media/generation-changes.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

export interface ImageJobOptions {
  aspectRatio?: string;
  resolution?: '1K' | '2K' | '4K';
  quality?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';
  outputFormat?: 'png' | 'jpeg' | 'webp';
  background?: 'transparent' | 'opaque' | 'auto';
  count: number;
  imageUri?: string;
  agentId?: string;
}

export interface ImageJobRow {
  id: string;
  conversation_id: string;
  transcript_id: string;
  work_id: string;
  parent_id: string | null;
  version_number: number;
  model_ref: string | null;
  request_hash: string;
  title: string;
  prompt: string;
  options_json: string;
  state: ImageJobState;
  artifacts_json: string;
  error: string | null;
  error_code: ImageJobErrorCode | null;
  next_attempt_at: number;
  lease_token: string | null;
  lease_until: number | null;
  created_at: number;
}

export function parseImageJobOptions(json: string): ImageJobOptions {
  try {
    const parsed = JSON.parse(json) as Partial<ImageJobOptions>;
    return {
      count: typeof parsed.count === 'number' && parsed.count >= 1 && parsed.count <= 4 ? parsed.count : 1,
      ...(parsed.aspectRatio ? { aspectRatio: parsed.aspectRatio } : {}),
      ...(parsed.resolution ? { resolution: parsed.resolution } : {}),
      ...(parsed.quality ? { quality: parsed.quality } : {}),
      ...(parsed.outputFormat ? { outputFormat: parsed.outputFormat } : {}),
      ...(parsed.background ? { background: parsed.background } : {}),
      ...(parsed.imageUri ? { imageUri: parsed.imageUri } : {}),
      ...(parsed.agentId ? { agentId: parsed.agentId } : {}),
    };
  } catch {
    return { count: 1 };
  }
}

export function parseImageJobArtifacts(json: string): ImageGenerationArtifact[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed as ImageGenerationArtifact[] : [];
  } catch {
    return [];
  }
}

export function publicImageJob(row: ImageJobRow): ImageGenerationJob {
  const options = parseImageJobOptions(row.options_json);
  return {
    id: row.id,
    workId: row.work_id,
    parentId: row.parent_id,
    versionNumber: row.version_number,
    modelRef: row.model_ref,
    title: row.title,
    prompt: row.prompt,
    aspectRatio: options.aspectRatio ?? null,
    resolution: options.resolution ?? null,
    quality: options.quality ?? null,
    count: options.count,
    state: row.state,
    images: parseImageJobArtifacts(row.artifacts_json),
    error: row.error,
    errorCode: row.error_code,
    createdAt: row.created_at,
  };
}

export function listImageJobs(conversationId: string, transcriptId: string): ImageGenerationJob[] {
  return (getSqliteDatabase().prepare(`SELECT * FROM image_generation_jobs WHERE conversation_id = ?
    AND transcript_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100`).all(conversationId, transcriptId) as unknown as ImageJobRow[])
    .map(publicImageJob);
}

export function getImageJob(conversationId: string, id: string): ImageJobRow | undefined {
  return getSqliteDatabase().prepare('SELECT * FROM image_generation_jobs WHERE conversation_id = ? AND id = ?')
    .get(conversationId, id) as unknown as ImageJobRow | undefined;
}

export function configuredImageGenerationModelRef(cfg?: Config, agentId?: string): string | null {
  const modelConfig = resolveImageGenerationModelConfigForTool({ cfg, agentId });
  return modelConfig?.primary ?? null;
}

export interface EnqueueImageJobRequest {
  parentId?: string;
  title?: string;
  prompt?: string;
  aspectRatio?: string;
  resolution?: '1K' | '2K' | '4K';
  quality?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';
  outputFormat?: 'png' | 'jpeg' | 'webp';
  background?: 'transparent' | 'opaque' | 'auto';
  count?: number;
  imageUri?: string;
  model?: string;
  agentId?: string;
}

export function enqueueImageJob(
  conversationId: string,
  transcriptId: string,
  toolCallId: string,
  request: EnqueueImageJobRequest,
  cfg?: Config,
) {
  const id = createHash('sha256').update(JSON.stringify([conversationId, transcriptId, toolCallId])).digest('hex');
  const hash = createHash('sha256').update(JSON.stringify([
    request.parentId, request.title, request.prompt, request.aspectRatio, request.resolution,
    request.quality, request.outputFormat, request.background, request.count, request.imageUri, request.model,
  ])).digest('hex');
  const configuredRef = request.model?.trim() || configuredImageGenerationModelRef(cfg, request.agentId);

  return runSqliteWriteTransaction(db => {
    if (db.prepare('SELECT active_transcript_id FROM sessions WHERE conversation_id = ?').get(conversationId)
      ?.active_transcript_id !== transcriptId) {
      return { error: 'The chat was reset. Ask the user to send the request again.' };
    }

    const previous = getImageJob(conversationId, id);
    if (previous) {
      return previous.request_hash === hash
        ? { job: publicImageJob(previous) }
        : { error: 'This request has already been submitted with different input.' };
    }

    const parent = request.parentId ? getImageJob(conversationId, request.parentId) : undefined;
    if (request.parentId && (parent?.transcript_id !== transcriptId || parent.state !== 'completed')) {
      return { error: 'Select a completed image version from the current chat.' };
    }
    if (!configuredRef) {
      return { error: 'Image generation is unavailable. Configure an image generation model and its API key in Settings.' };
    }

    const prompt = (request.prompt ?? parent?.prompt)?.trim();
    if (!prompt || prompt.length > 4000) {
      return { error: 'A prompt (1–4000 characters) is required for image generation.' };
    }
    const parentOptions = parent ? parseImageJobOptions(parent.options_json) : undefined;
    const title = (request.title?.trim() || parent?.title || prompt.slice(0, 60)).slice(0, 100);
    const count = request.count ?? parentOptions?.count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 4) {
      return { error: 'Image count must be an integer between 1 and 4.' };
    }

    const now = Date.now();
    const active = db.prepare(`SELECT count(*) AS count FROM image_generation_jobs
      WHERE state IN ('queued', 'running', 'saving')`).get();
    if (Number(active?.count) >= 4) {
      return { error: 'The image generation queue is full. Wait for an active request to finish.' };
    }

    const day = Math.floor(now / 86_400_000);
    const configuredLimit = process.env.XOPC_IMAGE_DAILY_LIMIT?.trim();
    const limit = configuredLimit ? Number(configuredLimit) : 60;
    if (!Number.isSafeInteger(limit) || limit < 0) {
      return { error: 'Invalid Gateway image daily limit.' };
    }
    const usage = Number(db.prepare('SELECT count AS used FROM image_generation_daily_usage WHERE day = ?').get(day)?.used ?? 0);
    if (usage >= limit) {
      return { error: 'The Gateway has reached its daily image generation limit.' };
    }

    db.prepare(`INSERT INTO image_generation_daily_usage (day, count) VALUES (?, 1)
      ON CONFLICT(day) DO UPDATE SET count = count + 1`).run(day);

    const options: ImageJobOptions = {
      count,
      ...(request.aspectRatio ?? parentOptions?.aspectRatio ? { aspectRatio: request.aspectRatio ?? parentOptions?.aspectRatio } : {}),
      ...(request.resolution ?? parentOptions?.resolution ? { resolution: request.resolution ?? parentOptions?.resolution } : {}),
      ...(request.quality ?? parentOptions?.quality ? { quality: request.quality ?? parentOptions?.quality } : {}),
      ...(request.outputFormat ?? parentOptions?.outputFormat ? { outputFormat: request.outputFormat ?? parentOptions?.outputFormat } : {}),
      ...(request.background ?? parentOptions?.background ? { background: request.background ?? parentOptions?.background } : {}),
      ...(request.imageUri ? { imageUri: request.imageUri } : {}),
      ...(request.agentId ? { agentId: request.agentId } : {}),
    };

    const workId = parent?.work_id ?? id;
    const version = Number(db.prepare('SELECT MAX(version_number) AS version FROM image_generation_jobs WHERE work_id = ?')
      .get(workId)?.version ?? 0) + 1;

    db.prepare(`INSERT INTO image_generation_jobs (id, conversation_id, transcript_id, work_id, parent_id, version_number, model_ref,
      request_hash, title, prompt, options_json, state, artifacts_json, next_attempt_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', '[]', ?, ?)`).run(
      id, conversationId, transcriptId, workId, parent?.id ?? null, version, configuredRef, hash,
      title, prompt, JSON.stringify(options), now, now,
    );
    notifyMediaGenerationAfterCommit(conversationId, transcriptId);
    return { job: publicImageJob(getImageJob(conversationId, id)!) };
  });
}

export function claimImageJob() {
  return runSqliteWriteTransaction(db => {
    const now = Date.now();
    const expired = db.prepare(`UPDATE image_generation_jobs SET state = 'failed',
      error = 'Image generation timed out before completion.', error_code = 'expired',
      lease_token = NULL, lease_until = NULL
      WHERE state IN ('running', 'saving') AND lease_until <= ? RETURNING conversation_id, transcript_id`)
      .all(now) as Array<Pick<ImageJobRow, 'conversation_id' | 'transcript_id'>>;
    for (const job of expired) notifyMediaGenerationAfterCommit(job.conversation_id, job.transcript_id);

    const row = db.prepare(`SELECT * FROM image_generation_jobs WHERE state = 'queued'
      AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until <= ?) ORDER BY next_attempt_at, rowid LIMIT 1`)
      .get(now, now) as unknown as ImageJobRow | undefined;
    if (!row) return undefined;
    const token = randomUUID();
    db.prepare('UPDATE image_generation_jobs SET lease_token = ?, lease_until = ? WHERE id = ?')
      .run(token, now + 180_000, row.id);
    return { row, token };
  });
}

export function updateImageJob(
  id: string,
  token: string,
  state: ImageJobState,
  options: {
    modelRef?: string;
    artifacts?: ImageGenerationArtifact[];
    error?: string;
    errorCode?: ImageJobErrorCode;
    delayMs?: number;
    keepLease?: boolean;
  } = {},
): boolean {
  const now = Date.now();
  const update = (db: ReturnType<typeof getSqliteDatabase>) => db.prepare(`UPDATE image_generation_jobs SET state = ?, error = ?, error_code = ?,
    model_ref = COALESCE(?, model_ref),
    artifacts_json = COALESCE(?, artifacts_json),
    next_attempt_at = ?,
    lease_token = CASE WHEN ? THEN lease_token END,
    lease_until = CASE WHEN ? THEN lease_until END
    WHERE id = ? AND lease_token = ? AND lease_until > ?
    RETURNING conversation_id, transcript_id`).get(
    state,
    options.error ?? null,
    options.errorCode ?? null,
    options.modelRef ?? null,
    options.artifacts ? JSON.stringify(options.artifacts) : null,
    now + (options.delayMs ?? 0),
    Number(options.keepLease ?? false),
    Number(options.keepLease ?? false),
    id,
    token,
    now,
  ) as Pick<ImageJobRow, 'conversation_id' | 'transcript_id'> | undefined;

  if (mediaGenerationPhase(state) === 'pending') return Boolean(update(getSqliteDatabase()));
  return runSqliteWriteTransaction(db => {
    const updated = update(db);
    if (!updated) return false;
    notifyMediaGenerationAfterCommit(updated.conversation_id, updated.transcript_id);
    return true;
  });
}
