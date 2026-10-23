import { createHash } from 'node:crypto';
import type { DiscussionOrganization, DiscussionReview, DiscussionReviewEntry, DiscussionEvidenceSegment, DiscussionPlaybackRange } from '@xopcai/gateway-contract';
import type { NotesService } from '../notes/service.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { DiscussionServiceError } from './errors.js';
import { getProcessingRun, type TranscriptionCheckpoint } from './processing.js';
import { getDiscussionCapture, getLatestDiscussionOrganization, listDiscussionTranscriptSegments } from './repository.js';
import { readTranscriptRevision } from './revisions.js';
import { recordingTimeline, listAnnotations } from './review.js';
import { playbackRanges, pointToPcm } from './media-timeline.js';

export type ChapterScope = { source: string; revision: number; transcript: string };
export function chapterScope(id: string): ChapterScope {
  const capture = getDiscussionCapture(id)!;
  return { source: capture.audioSha256 ?? '', revision: capture.transcriptRevision, transcript: capture.canonicalTranscriptSha256 ?? '' };
}
export function saveReviewChapter(id: string, hash: string, position: number, chapter: DiscussionOrganization, scope: ChapterScope): void {
  runSqliteWriteTransaction(db => {
    if (JSON.stringify(chapterScope(id)) !== JSON.stringify(scope)) return;
    db.prepare(`DELETE FROM discussion_chapter_progress WHERE discussion_id=? AND source_sha256=? AND transcript_revision=? AND transcript_sha256=? AND position=?`)
      .run(id,scope.source,scope.revision,scope.transcript,position);
    db.prepare('INSERT OR REPLACE INTO discussion_chapter_progress VALUES (?,?,?,?,?,?,?)')
      .run(id,scope.source,scope.revision,scope.transcript,hash,position,JSON.stringify(chapter));
  });
}

/** Union, rather than the latest timestamp or sum, describes verified coverage. */
export function unionReviewRanges(ranges: DiscussionPlaybackRange[], duration: number): DiscussionPlaybackRange[] {
  const sorted = ranges.filter(r => Number.isFinite(r.startedAtMs) && Number.isFinite(r.endedAtMs) && r.endedAtMs > r.startedAtMs)
    .map(r => ({ startedAtMs: Math.max(0,r.startedAtMs), endedAtMs: Math.min(duration,r.endedAtMs) }))
    .filter(r => r.endedAtMs > r.startedAtMs).sort((a,b) => a.startedAtMs - b.startedAtMs);
  const output: DiscussionPlaybackRange[] = [];
  for (const range of sorted) {
    const last = output.at(-1);
    if (last && range.startedAtMs <= last.endedAtMs) last.endedAtMs = Math.max(last.endedAtMs,range.endedAtMs);
    else output.push({ ...range });
  }
  return output;
}
const fold = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
function excerpt(text: string, query: string): string {
  if (text.length <= 700) return text;
  const at = query ? Math.max(0,fold(text).indexOf(query) - 180) : 0;
  return `${at ? '…' : ''}${text.slice(at,at + 700)}${at + 700 < text.length ? '…' : ''}`;
}

export async function longRecordingReview(id: string, notes: NotesService, options: { query?: string; offset?: number; limit?: number; version?: string } = {}): Promise<DiscussionReview> {
  const capture = getDiscussionCapture(id);
  if (!capture) throw new DiscussionServiceError('not_found','Discussion not found');
  const query = (options.query ?? '').trim(); const offset = options.offset ?? 0; const limit = options.limit ?? 20;
  if (query.length > 200 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new DiscussionServiceError('invalid_input','Invalid review query or pagination');
  const sourceSegments = listDiscussionTranscriptSegments(id).filter(s => s.status === 'confirmed');
  const record = getLatestDiscussionOrganization(id); const organization = record?.organization;
  const duration = capture.durationMs ?? Math.max(0,...sourceSegments.map(s => s.endedAtMs));
  const run = getProcessingRun(id);
  const checkpoints = run && run.audio_sha256 === (capture.audioSha256 ?? null)
    ? getSqliteDatabase().prepare('SELECT started_at_ms,ended_at_ms,result_json FROM discussion_transcription_checkpoints WHERE run_id=? ORDER BY started_at_ms').all(run.run_id) as { started_at_ms: number; ended_at_ms: number; result_json: string }[] : [];
  const scope = chapterScope(id);
  const chunks = getSqliteDatabase().prepare(`SELECT chapter_json FROM discussion_chapter_progress WHERE discussion_id=? AND source_sha256=? AND transcript_revision=? AND transcript_sha256=? ORDER BY position`)
    .all(id,scope.source,scope.revision,scope.transcript) as { chapter_json: string }[];
  const partialChapters = chunks.map(row => JSON.parse(row.chapter_json) as DiscussionOrganization);
  const timeline = await recordingTimeline(id,notes);
  const attachment = capture.audioAttachmentId && !capture.audioDeletedAt ? await notes.getAttachmentPath(capture.noteId,capture.audioAttachmentId) : null;
  const playable = (start: number,end: number) => attachment && timeline ? playbackRanges(timeline,start,end) : [];
  const segment = (s: { sequence: number; startedAtMs: number; endedAtMs: number; displayText?: string; rawText?: string; speakerLabel?: string }): DiscussionEvidenceSegment => ({ sequence: s.sequence,startedAtMs: s.startedAtMs,endedAtMs: s.endedAtMs,text: s.displayText ?? s.rawText ?? '',speakerLabel: s.speakerLabel,playback: playable(s.startedAtMs,s.endedAtMs) });
  const entries: DiscussionReviewEntry[] = sourceSegments.map((s,index) => ({ id: `transcript:${capture.transcriptRevision}:${s.sequence}`,kind: 'transcript',title: s.speakerLabel ?? '',text: s.displayText ?? s.rawText ?? '',transcriptRevision: capture.transcriptRevision,provisional: false,stale: false,startedAtMs: s.startedAtMs,endedAtMs: s.endedAtMs,segments: sourceSegments.slice(Math.max(0,index-1),index+2).map(segment),playback: playable(Math.max(0,s.startedAtMs-3000),Math.min(duration,s.endedAtMs+5000)) }));
  // Checkpoints belong to their processing run, never to published sequence numbers.
  if (capture.status === 'sealing' || (capture.status === 'needs_attention' && capture.failureStage === 'transcript_sealing')) {
    for (const row of checkpoints) {
      const checkpoint = JSON.parse(row.result_json) as TranscriptionCheckpoint;
      for (const [index,s] of checkpoint.segments.entries()) entries.push({ id: `checkpoint:${run!.run_id}:${row.started_at_ms}:${index}`,kind: 'transcript',title: '',text: s.text,provisional: true,stale: false,startedAtMs: s.startedAtMs,endedAtMs: s.endedAtMs,segments: [{ sequence: index,startedAtMs: s.startedAtMs,endedAtMs: s.endedAtMs,text: s.text,playback: playable(s.startedAtMs,s.endedAtMs) }],playback: playable(Math.max(0,s.startedAtMs-3000),Math.min(duration,s.endedAtMs+5000)) });
    }
  }
  const revisions = new Map<number, typeof sourceSegments>([[capture.transcriptRevision,sourceSegments]]);
  const revisionSegments = (revision: number) => {
    if (!revisions.has(revision)) revisions.set(revision,(readTranscriptRevision(id,revision) ?? []).filter(s => s.status === 'confirmed'));
    return revisions.get(revision)!;
  };
  // Resolve each historical revision once, rather than re-reading a long snapshot for every mark.
  const annotations = listAnnotations(id).map(annotation => {
    const anchor = annotation.anchor;
    const epoch = timeline?.epochs[anchor.epoch ?? 0];
    const position = anchor.positionMs ?? (epoch && anchor.offsetMs !== undefined
      ? anchor.coordinate === 'pcm' ? (anchor.offsetMs < epoch.durationMs ? epoch.baseMs + anchor.offsetMs : undefined) : pointToPcm(epoch,anchor.offsetMs) : undefined);
    const durable = !!attachment && position !== undefined && position >= 0 && position < duration;
    const revision = anchor.transcriptRevision ?? capture.transcriptRevision;
    const refs = anchor.type === 'transcript' ? revisionSegments(revision).filter(s => anchor.segmentIds?.includes(s.sequence))
      : durable ? sourceSegments.filter(s => s.startedAtMs <= position! && s.endedAtMs > position!) : [];
    const valid = anchor.type === 'transcript' ? refs.length === anchor.segmentIds?.length : durable;
    const evidence = refs.length && valid ? { transcriptRevision: revision,stale: revision !== capture.transcriptRevision,segments: refs.map(segment) } : undefined;
    return { annotation,positionMs: durable ? position : undefined,evidence,
      state: valid ? 'located' : !capture.audioAttachmentId && !capture.audioDeletedAt ? 'pending' : 'unavailable',
      playback: anchor.type === 'transcript' ? evidence?.segments.flatMap(s => s.playback) ?? [] : durable ? playable(Math.max(0,position!-2000),Math.min(duration,position!+8000)) : [] };
  });
  const chapters: DiscussionReviewEntry[] = [];
  const appendChapters = (org: DiscussionOrganization,revision: number,provisional: boolean,prefix: string) => {
    const historical = revisionSegments(revision);
    org.chapters.forEach((c,index) => {
      if (!Number.isFinite(c.startedAtMs) || !Number.isFinite(c.endedAtMs) || c.startedAtMs < 0 || c.endedAtMs <= c.startedAtMs || c.endedAtMs > duration) return;
      const within = historical.filter(s => s.status === 'confirmed' && s.endedAtMs > c.startedAtMs && s.startedAtMs < c.endedAtMs);
      chapters.push({ id: `${prefix}:${index}`,kind: 'chapter',title: c.title,text: c.summary,transcriptRevision: revision,provisional,stale: revision !== capture.transcriptRevision,startedAtMs: c.startedAtMs,endedAtMs: c.endedAtMs,segments: within.slice(0,3).map(segment),playback: playable(c.startedAtMs,Math.min(c.endedAtMs,c.startedAtMs+120000)),highlightCount: annotations.filter(a => !a.annotation.deleted && (a.positionMs ?? a.evidence?.segments[0]?.startedAtMs ?? -1) >= c.startedAtMs && (a.positionMs ?? a.evidence?.segments[0]?.startedAtMs ?? -1) < c.endedAtMs).length,actionCount: org.actionItems.filter(a => !a.ignored && a.evidenceSegmentIds.some(seq => within.some(s => s.sequence === seq))).length });
    });
  };
  if (organization) appendChapters(organization,record!.transcriptRevision,false,`chapter:${record!.revision}`);
  // Keep the old complete overview available while exposing newly completed chapters separately.
  if (capture.status !== 'completed') partialChapters.forEach((org,index) => appendChapters(org,capture.transcriptRevision,true,`partial:${index}`));
  entries.push(...chapters);
  if (organization) {
    const revision = record!.transcriptRevision;
    const historical = revisionSegments(revision);
    const facts = [ { id: 'summary',text: organization.summary,evidenceSegmentIds: organization.summaryEvidenceSegmentIds ?? [] },...(organization.keyPointEvidence ?? []),...organization.decisions,...organization.risks,...organization.openQuestions,...organization.actionItems.map(a => ({ ...a,text: a.title })) ];
    for (const fact of facts) {
      if ('ignored' in fact && fact.ignored) continue;
      const rev = 'evidenceRevision' in fact ? fact.evidenceRevision ?? revision : revision;
      const source = rev === revision ? historical : revisionSegments(rev);
      const referenced = source.filter(s => s.status === 'confirmed' && fact.evidenceSegmentIds.includes(s.sequence));
      entries.push({ id: `analysis:${record!.revision}:${fact.id}`,kind: 'analysis',title: '',text: fact.text,transcriptRevision: rev,provisional: false,stale: rev !== capture.transcriptRevision,startedAtMs: referenced[0]?.startedAtMs,endedAtMs: referenced.at(-1)?.endedAtMs,segments: referenced.slice(0,3).map(segment),playback: referenced.slice(0,3).flatMap(s => playable(s.startedAtMs,s.endedAtMs)) });
    }
  }
  for (const a of annotations.filter(a => !a.annotation.deleted)) entries.push({ id: `annotation:${a.annotation.id}`,kind: 'annotation',title: a.annotation.kind,text: a.annotation.text,transcriptRevision: a.evidence?.transcriptRevision,provisional: a.state === 'pending',stale: a.evidence?.stale ?? false,startedAtMs: a.positionMs ?? a.evidence?.segments[0]?.startedAtMs,segments: a.evidence?.segments.slice(0,3) ?? [],playback: a.playback });
  const currentProcessed = (capture.status === 'organizing' || capture.status === 'completed') && capture.canonicalTranscript && duration > 0
    ? [{ startedAtMs: 0,endedAtMs: duration }] : [...(run?.force_audio ? [] : sourceSegments),...checkpoints.map(r => ({ startedAtMs: r.started_at_ms,endedAtMs: r.ended_at_ms }))];
  const processedRanges = unionReviewRanges(currentProcessed,duration);
  const analysisRanges = unionReviewRanges(chapters.filter(c => c.provisional || !c.stale).map(c => ({ startedAtMs: c.startedAtMs!,endedAtMs: c.endedAtMs! })),duration);
  const needle = fold(query);
  const matches = entries.filter(e => needle ? fold(`${e.title}\n${e.text}\n${e.kind === 'annotation' ? e.segments.map(s => s.text).join('\n') : ''}`).includes(needle) : e.provisional && e.kind === 'transcript');
  const version = createHash('sha256').update(JSON.stringify([capture.audioSha256,capture.audioDeletedAt,capture.status,capture.transcriptRevision,record?.revision,processedRanges,analysisRanges,entries.map(e => [e.id,e.title,e.text,e.startedAtMs,e.endedAtMs,e.stale,e.provisional])])).digest('hex').slice(0,24);
  if (options.version && options.version !== version) throw new DiscussionServiceError('conflict','Review updated; restart search');
  // A source/revision mutation during asynchronous media inspection invalidates this projection.
  const fresh = getDiscussionCapture(id);
  if (fresh?.audioSha256 !== capture.audioSha256 || fresh?.transcriptRevision !== capture.transcriptRevision || fresh?.audioDeletedAt !== capture.audioDeletedAt)
    throw new DiscussionServiceError('conflict','Review updated; retry');
  return { version,query,offset,total: matches.length,hasMore: offset+limit < matches.length,hits: matches.slice(offset,offset+limit).map(e => ({ ...e,text: excerpt(e.text,needle) })),chapters,
    coverage: { durationMs: duration,audioAvailable: !!attachment,transcriptRanges: unionReviewRanges(sourceSegments,duration),processedRanges,processedMs: processedRanges.reduce((sum,r) => sum+r.endedAtMs-r.startedAtMs,0),continuousThroughMs: processedRanges[0]?.startedAtMs === 0 ? processedRanges[0].endedAtMs : 0,analysisRanges,analysisRevision: record?.transcriptRevision,analysisStale: !!record && record.transcriptRevision !== capture.transcriptRevision,complete: capture.status === 'completed' } };
}
