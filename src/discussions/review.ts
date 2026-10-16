import { z } from 'zod';
import type { DiscussionAnnotation, DiscussionAnnotationInput, DiscussionEvidence, DiscussionResolvedAnnotation } from '@xopcai/gateway-contract';
import type { NotesService } from '../notes/service.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { DiscussionServiceError } from './errors.js';
import { getDiscussionCapture, listDiscussionTranscriptSegments } from './repository.js';
import { readTranscriptRevision, saveTranscriptRevision } from './revisions.js';
import { pcmEpoch, playbackRanges, pointToPcm, probeMediaEpoch, type RecordingTimeline } from './media-timeline.js';

const anchorSchema = z.object({ type: z.enum(['time', 'transcript']), capturedAt: z.number().int().nonnegative(),
  epoch: z.number().int().min(0).max(100).optional(), coordinate: z.enum(['encoded','pcm']).optional(), offsetMs: z.number().min(0).max(8_000_000).optional(),
  positionMs: z.number().min(0).max(8_000_000).optional(), transcriptRevision: z.number().int().nonnegative().optional(),
  segmentIds: z.array(z.number().int().nonnegative()).min(1).max(100).optional(),
}).strict().refine(anchor => anchor.type === 'transcript' ? anchor.transcriptRevision !== undefined && !!anchor.segmentIds?.length && anchor.offsetMs === undefined && anchor.positionMs === undefined
  : anchor.transcriptRevision === undefined && anchor.segmentIds === undefined && !(anchor.offsetMs !== undefined && anchor.positionMs !== undefined) && (anchor.offsetMs === undefined || anchor.epoch !== undefined));
const inputSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), kind: z.enum(['highlight','question','note']), text: z.string().max(4000),
  anchor: anchorSchema, expectedRevision: z.number().int().nonnegative(), deleted: z.boolean().optional() });
type AnnotationRow = { id: string; kind: DiscussionAnnotation['kind']; text: string; anchor_json: string; revision: number; deleted: number; created_at: number; updated_at: number };
const map = (row: AnnotationRow): DiscussionAnnotation => ({ id: row.id, kind: row.kind, text: row.text, anchor: JSON.parse(row.anchor_json), revision: row.revision, deleted: !!row.deleted, createdAt: row.created_at, updatedAt: row.updated_at });
const requireCapture = (id: string) => { const capture = getDiscussionCapture(id); if (!capture) throw new DiscussionServiceError('not_found', 'Discussion not found'); return capture; };

export function listAnnotations(id: string): DiscussionAnnotation[] {
  requireCapture(id);
  return (getSqliteDatabase().prepare('SELECT * FROM discussion_annotations WHERE discussion_id=? ORDER BY created_at,id').all(id) as AnnotationRow[]).map(map).sort((a,b) => a.anchor.capturedAt - b.anchor.capturedAt || a.id.localeCompare(b.id));
}

export function putAnnotation(id: string, value: DiscussionAnnotationInput): DiscussionAnnotation {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) throw new DiscussionServiceError('invalid_input', 'Invalid annotation');
  const input = parsed.data;
  return runSqliteWriteTransaction(db => {
    const capture = requireCapture(id);
    if (input.anchor.type === 'transcript') {
      if (input.anchor.transcriptRevision === capture.transcriptRevision) saveTranscriptRevision(id);
      const segments = readTranscriptRevision(id, input.anchor.transcriptRevision!);
      if (!segments || input.anchor.segmentIds!.some(sequence => !segments.some(segment => segment.sequence === sequence && segment.status === 'confirmed'))) throw new DiscussionServiceError('conflict', 'Transcript evidence is no longer available');
    }
    const row = db.prepare('SELECT * FROM discussion_annotations WHERE discussion_id=? AND id=?').get(id, input.id) as AnnotationRow | undefined;
    const current = row ? map(row) : undefined;
    const anchor = JSON.stringify(input.anchor);
    if (current && current.kind === input.kind && current.text === input.text && current.deleted === !!input.deleted && JSON.stringify(current.anchor) === anchor) return current;
    if ((current?.revision ?? 0) !== input.expectedRevision) throw new DiscussionServiceError('conflict', 'Annotation changed; reload before saving');
    if (current && JSON.stringify(current.anchor) !== anchor) {
      const previous = current.anchor;
      const resolution = previous.type === 'time' && previous.offsetMs === undefined && previous.positionMs === undefined
        && input.anchor.type === 'time' && previous.capturedAt === input.anchor.capturedAt && previous.epoch === input.anchor.epoch && previous.coordinate === input.anchor.coordinate;
      if (!resolution) throw new DiscussionServiceError('conflict', 'Original annotation anchor is immutable');
    }
    if (!current && Number((db.prepare('SELECT COUNT(*) n FROM discussion_annotations WHERE discussion_id=?').get(id) as { n: number }).n) >= 1000) throw new DiscussionServiceError('invalid_input', 'Annotation limit reached');
    const now = Date.now(); const revision = (current?.revision ?? 0) + 1;
    db.prepare(`INSERT INTO discussion_annotations(discussion_id,id,kind,text,anchor_json,revision,deleted,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(discussion_id,id) DO UPDATE SET kind=excluded.kind,text=excluded.text,anchor_json=excluded.anchor_json,revision=excluded.revision,deleted=excluded.deleted,updated_at=excluded.updated_at`)
      .run(id,input.id,input.kind,input.text,anchor,revision,input.deleted ? 1 : 0,current?.createdAt ?? now,now);
    return { id: input.id, kind: input.kind, text: input.text, anchor: input.anchor, revision, deleted: !!input.deleted, createdAt: current?.createdAt ?? now, updatedAt: now };
  });
}

const timingAttempts = new Map<string,number>();
const timingInFlight = new Map<string, Promise<RecordingTimeline | undefined>>();
export async function recordingTimeline(id: string, notes: NotesService): Promise<RecordingTimeline | undefined> {
  const capture = requireCapture(id);
  if (!capture.audioAttachmentId || capture.audioDeletedAt || !capture.durationMs) return;
  const key = `${id}:${capture.audioSha256}`;
  if (timingInFlight.has(key)) return timingInFlight.get(key);
  const cached = getSqliteDatabase().prepare('SELECT timeline_json FROM discussion_media_timeline WHERE discussion_id=? AND audio_sha256=?').get(id,capture.audioSha256 ?? '') as { timeline_json: string } | undefined;
  let previous: RecordingTimeline | undefined;
  try { previous = cached ? JSON.parse(cached.timeline_json) as RecordingTimeline : undefined; } catch { /* Rebuild a damaged derived cache from immutable media. */ }
  if (previous && Array.isArray(previous.epochs) && (previous.primary === 'pcm' || previous.epochs.every(epoch => epoch.verified))) return previous;
  if (capture.mimeType?.includes('wav')) return { primary: 'pcm', epochs: [pcmEpoch(capture.durationMs)] };
  if (previous && Date.now() - (timingAttempts.get(key) ?? 0) < 30_000) return previous;
  timingAttempts.set(key,Date.now());
  if (timingAttempts.size > 256) timingAttempts.delete(timingAttempts.keys().next().value!);
  const pending = (async () => {
    const attachment = await notes.getAttachmentPath(capture.noteId,capture.audioAttachmentId!);
    if (!attachment) return;
    const timeline: RecordingTimeline = { primary: 'encoded', epochs: [await probeMediaEpoch(attachment.filePath,capture.durationMs!,0,AbortSignal.timeout(35_000))] };
    if (getDiscussionCapture(id)?.audioSha256 === capture.audioSha256) getSqliteDatabase().prepare('INSERT OR REPLACE INTO discussion_media_timeline(discussion_id,audio_sha256,timeline_json) VALUES(?,?,?)').run(id,capture.audioSha256 ?? '',JSON.stringify(timeline));
    return timeline;
  })().finally(() => timingInFlight.delete(key));
  timingInFlight.set(key,pending); return pending;
}

export async function evidenceFor(id: string, revision: number, ids: number[], notes: NotesService): Promise<DiscussionEvidence> {
  const capture = requireCapture(id);
  if (!Number.isSafeInteger(revision) || revision < 0 || !ids.length || ids.length > 100 || ids.some(id => !Number.isSafeInteger(id) || id < 0)) throw new DiscussionServiceError('invalid_input','Invalid evidence reference');
  if (capture.transcriptRevision === revision) saveTranscriptRevision(id);
  const source = readTranscriptRevision(id,revision);
  if (!source || ids.some(id => !source.some(segment => segment.sequence === id && segment.status === 'confirmed'))) throw new DiscussionServiceError('not_found','Referenced transcript revision or segment is unavailable');
  const attachment = capture.audioAttachmentId && !capture.audioDeletedAt ? await notes.getAttachmentPath(capture.noteId,capture.audioAttachmentId) : null;
  const timeline = attachment ? await recordingTimeline(id,notes) : undefined;
  return { transcriptRevision: revision, stale: revision !== getDiscussionCapture(id)?.transcriptRevision, audioAvailable: !!attachment,
    timingVerified: !!timeline && (timeline.primary === 'pcm' || timeline.epochs.every(epoch => epoch.verified)),
    segments: source.filter(segment => ids.includes(segment.sequence)).map(segment => ({ sequence: segment.sequence,
      startedAtMs: segment.startedAtMs, endedAtMs: segment.endedAtMs, text: segment.displayText ?? segment.rawText ?? '', speakerLabel: segment.speakerLabel,
      playback: timeline ? playbackRanges(timeline,segment.startedAtMs,segment.endedAtMs) : [] })) };
}

export async function resolvedAnnotations(id: string, notes: NotesService): Promise<DiscussionResolvedAnnotation[]> {
  const capture = requireCapture(id); const annotations = listAnnotations(id);
  const timeline = await recordingTimeline(id,notes);
  const current = listDiscussionTranscriptSegments(id).filter(segment => segment.status === 'confirmed');
  return Promise.all(annotations.map(async annotation => {
    const anchor = annotation.anchor;
    if (annotation.deleted) return { annotation, state: 'unavailable' as const, playback: [] };
    if (anchor.type === 'transcript') {
      const evidence = await evidenceFor(id,anchor.transcriptRevision!,anchor.segmentIds!,notes).catch(() => undefined);
      return { annotation, state: evidence ? 'located' as const : 'unavailable' as const, evidence, playback: evidence?.segments.flatMap(segment => segment.playback) ?? [] };
    }
    const epoch = timeline?.epochs[anchor.epoch ?? 0];
    const position = anchor.positionMs ?? (epoch && anchor.offsetMs !== undefined ? anchor.coordinate === 'pcm' ? (anchor.offsetMs < epoch.durationMs ? epoch.baseMs + anchor.offsetMs : undefined) : pointToPcm(epoch,anchor.offsetMs) : undefined);
    const durable = !capture.audioDeletedAt && !!capture.audioAttachmentId && position !== undefined && position >= 0 && position < (capture.durationMs ?? 0);
    if (!durable) return { annotation, state: !capture.audioAttachmentId && !capture.audioDeletedAt ? 'pending' as const : 'unavailable' as const, playback: [] };
    const refs = current.filter(segment => segment.startedAtMs <= position && segment.endedAtMs > position).map(segment => segment.sequence);
    const evidence = refs.length ? await evidenceFor(id,capture.transcriptRevision,refs,notes) : undefined;
    return { annotation, state: 'located' as const, positionMs: position,
      playback: timeline ? playbackRanges(timeline,Math.max(0,position - 2000),Math.min(capture.durationMs!,position + 8000)) : [], evidence };
  }));
}
