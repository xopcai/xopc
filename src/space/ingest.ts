import { createHash, randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import {
  parseTurnOutcome, type TaskResultDelivery, type TurnOutcomeDeliverable,
} from '@xopcai/gateway-contract';

import { MEDIA_ARTIFACT_MAX_BYTES, mimeTypeFromMediaPath, resolveMediaBufferPath } from '../media/store.js';
import { tryParseMediaUri } from '../media/uri.js';

type Origin = {
  key: string;
  kind: 'chat' | 'task' | 'automation';
  conversationId: string;
  transcriptId?: string;
  entryId?: string;
  projectId?: string;
  taskId?: string;
  automationRunId?: string;
  label?: string;
  createdAt: number;
};

export const SPACE_VIDEO_MAX_BYTES = 256 * 1024 * 1024;

type Content = { fileName: string; mimeType: string; size: number; kind: string; mediaId?: string; body?: string; sha256?: string };

function insertOrigin(db: DatabaseSync, origin: Origin, itemId: string, versionId: string): void {
  db.prepare(`INSERT INTO space_origins(source_key, item_id, version_id, kind, conversation_id, transcript_id,
    entry_id, project_id, task_id, automation_run_id, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(origin.key, itemId, versionId, origin.kind, origin.conversationId, origin.transcriptId ?? null,
      origin.entryId ?? null, origin.projectId ?? null, origin.taskId ?? null, origin.automationRunId ?? null, origin.label ?? null);
}

export function archiveSpaceContent(db: DatabaseSync, origin: Origin, identity: string, title: string, content: Content, userInitiated = false): string | null {
  const receipt = db.prepare('SELECT item_id FROM space_origins WHERE source_key = ?').get(origin.key);
  if (receipt) {
    if (!userInitiated) return receipt.item_id as string | null;
    if (typeof receipt.item_id === 'string') {
      db.prepare('UPDATE space_items SET trashed_at = NULL, revision = revision + 1 WHERE id = ? AND trashed_at IS NOT NULL').run(receipt.item_id);
      return receipt.item_id;
    }
    db.prepare('DELETE FROM space_origins WHERE source_key = ?').run(origin.key);
  }
  // A second delivery can reference a previously purged file. Preserve the purge across replay.
  const mediaKey = content.mediaId ? `media:${content.mediaId}` : undefined;
  if (!userInitiated && mediaKey && db.prepare('SELECT 1 FROM space_origins WHERE source_key = ? AND item_id IS NULL').get(mediaKey)) return null;
  const existing = db.prepare(`SELECT i.id, v.created_at
    FROM space_items i JOIN space_versions v ON v.id = i.current_version_id WHERE i.identity_key = ?`).get(identity);
  const itemId = (existing?.id as string | undefined) ?? randomUUID();
  const sameMedia = content.mediaId
    ? db.prepare('SELECT id FROM space_versions WHERE item_id = ? AND media_id = ?').get(itemId, content.mediaId)?.id
    : undefined;
  if (sameMedia) {
    insertOrigin(db, origin, itemId, String(sameMedia));
    return itemId;
  }
  const versionId = randomUUID();
  if (!existing) {
    db.prepare('INSERT INTO space_items(id, identity_key, title, kind, current_version_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(itemId, identity, title.slice(0, 240), content.kind, versionId, origin.createdAt);
  }
  const ordinal = Number(db.prepare('SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM space_versions WHERE item_id = ?').get(itemId)?.ordinal);
  db.prepare(`INSERT INTO space_versions(id, item_id, ordinal, file_name, mime_type, size_bytes, media_id, body, sha256, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(versionId, itemId, ordinal, content.fileName, content.mimeType, content.size,
      content.mediaId ?? null, content.body ?? null, content.sha256 ?? null, origin.createdAt);
  if (existing && origin.createdAt >= Number(existing.created_at)) {
    db.prepare('UPDATE space_items SET current_version_id = ?, updated_at = ?, revision = revision + 1 WHERE id = ?')
      .run(versionId, origin.createdAt, itemId);
  }
  insertOrigin(db, origin, itemId, versionId);
  if (mediaKey && !db.prepare('SELECT 1 FROM space_origins WHERE source_key = ?').get(mediaKey)) {
    insertOrigin(db, { ...origin, key: mediaKey }, itemId, versionId);
  }
  return itemId;
}

export function spaceMarkdown(title: string, body: string): Content {
  return {
    fileName: `${title.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 120)}.md`,
    mimeType: 'text/markdown', size: Buffer.byteLength(body), kind: 'document', body,
    sha256: createHash('sha256').update(body).digest('hex'),
  };
}

function archiveFile(db: DatabaseSync, origin: Origin, file: TurnOutcomeDeliverable): void {
  if (file.availability !== 'available' || file.location !== 'artifact_store' || !file.uri) return;
  const media = tryParseMediaUri(file.uri);
  if (media?.bucket !== 'outbound') return;
  if (media.id === '..' || media.id === '.') return;
  const path = resolveMediaBufferPath(media.id, media.bucket);
  const stat = safeMediaStat(path);
  if (!stat?.isFile() || stat.size > MEDIA_ARTIFACT_MAX_BYTES || (file.sizeBytes !== undefined && file.sizeBytes !== stat.size)) return;
  const identity = db.prepare('SELECT i.identity_key FROM space_versions v JOIN space_items i ON i.id = v.item_id WHERE v.media_id = ? LIMIT 1').get(media.id)?.identity_key;
  archiveSpaceContent(db, origin, typeof identity === 'string' ? identity : `media:${media.id}`, file.title, {
    kind: file.kind, mediaId: media.id, fileName: file.title,
    mimeType: file.mimeType ?? mimeTypeFromMediaPath(path), size: stat.size, sha256: file.sha256,
  });
}

export function archiveSpaceTurn(db: DatabaseSync, source: { conversationId: string; transcriptId: string; entryId: string; createdAt: number; outcome: unknown }): void {
  const outcome = parseTurnOutcome(source.outcome);
  if (!outcome?.deliverables.length) return;
  if (db.prepare('SELECT 1 FROM task_runs WHERE conversation_id = ? LIMIT 1').get(source.conversationId)) return;
  const session = db.prepare('SELECT name, project_id FROM sessions WHERE conversation_id = ?').get(source.conversationId);
  if (!session) return;
  const automation = db.prepare(`SELECT run_id, automation_name FROM automation_runs WHERE conversation_id = ?
    AND COALESCE(started_at_ms, created_at_ms) <= ? AND (ended_at_ms IS NULL OR ended_at_ms >= ?)
    ORDER BY created_at_ms DESC LIMIT 1`).get(source.conversationId, source.createdAt, source.createdAt - 5_000);
  for (const file of outcome.deliverables) {
    archiveFile(db, {
      ...source, key: `turn:${source.entryId}:${file.artifactId}`, kind: automation ? 'automation' : 'chat',
      projectId: (session.project_id as string | null) ?? undefined,
      label: (automation?.automation_name ?? session.name ?? undefined) as string | undefined,
      automationRunId: automation?.run_id as string | undefined,
    }, file);
  }
}

export function archiveSpaceTaskDelivery(db: DatabaseSync, delivery: TaskResultDelivery, entryId?: string): void {
  const project = db.prepare('SELECT project_id FROM tasks WHERE task_id = ?').get(delivery.taskId);
  const origin = {
    kind: 'task' as const, conversationId: delivery.conversationId, transcriptId: delivery.originTranscriptId,
    entryId, projectId: (project?.project_id as string | null) ?? undefined, taskId: delivery.taskId,
    label: delivery.taskTitle, createdAt: delivery.createdAt,
  };
  for (const file of delivery.outcome.deliverables) {
    archiveFile(db, { ...origin, key: `delivery:${delivery.deliveryId}:${file.artifactId}` }, file);
  }
  const body = (delivery.text ?? delivery.outcome.research?.finalText)?.trim();
  if (body && body !== 'NO_REPLY') {
    archiveSpaceContent(db, { ...origin, key: `delivery-body:${delivery.deliveryId}` }, `task-body:${delivery.taskId}`,
      delivery.taskTitle, spaceMarkdown(delivery.taskTitle, body));
  }
}

function safeMediaStat(path: string) {
  try { return lstatSync(path, { throwIfNoEntry: false }); }
  catch { return undefined; }
}

export function archiveSpaceGeneratedMedia(db: DatabaseSync, kind: 'music' | 'video', id: string): void {
  const job = kind === 'music'
    ? db.prepare("SELECT conversation_id, transcript_id, title, work_id, created_at FROM music_generation_jobs WHERE id = ? AND state = 'completed'").get(id)
    : db.prepare("SELECT conversation_id, transcript_id, prompt AS title, created_at FROM video_generation_jobs WHERE id = ? AND state = 'completed'").get(id);
  if (!job || !/^[a-f0-9-]{32,64}$/i.test(id)) return;
  const conversationId = String(job.conversation_id);
  const session = db.prepare('SELECT name, project_id FROM sessions WHERE conversation_id = ?').get(conversationId);
  if (!session) return;
  const mediaId = kind === 'music' ? `music-${id}.mp3` : `wan-${id}.mp4`;
  const stat = safeMediaStat(resolveMediaBufferPath(mediaId, 'outbound'));
  if (!stat?.isFile() || !stat.size || stat.size > SPACE_VIDEO_MAX_BYTES) return;
  const title = String(job.title).trim().slice(0, 120) || (kind === 'music' ? 'Music' : 'Video');
  archiveSpaceContent(db, {
    key: `generation:${kind}:${id}`, kind: 'chat', conversationId, transcriptId: String(job.transcript_id),
    createdAt: Number(job.created_at), projectId: (session.project_id as string | null) ?? undefined,
    label: (session.name as string | null) ?? undefined,
  }, kind === 'music' ? `music-work:${String(job.work_id)}` : `media:${mediaId}`, title, {
    fileName: `${title.replace(/[\\/\u0000-\u001f]/g, '_')}.${kind === 'music' ? 'mp3' : 'mp4'}`,
    mimeType: kind === 'music' ? 'audio/mpeg' : 'video/mp4', size: stat.size, kind: kind === 'music' ? 'audio' : 'video', mediaId,
  });
}
