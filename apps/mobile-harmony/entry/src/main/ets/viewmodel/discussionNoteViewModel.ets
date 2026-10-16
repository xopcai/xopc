import { discussionOutcomeInput } from '../common/discussionOutcome';
import { XopcRecordingOutcomeInput } from '../common/recordingOutcome';
import { XopcDiscussionReview, XopcReviewEntry, XopcEvidenceSegment } from '../model/discussionCapture';
import { gatewaySession } from '../service/gatewaySession';
import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { XopcDiscussionEvidence, XopcResolvedAnnotation, XopcDiscussionAnnotation, XopcDiscussionTranscriptSegment, XopcPlaybackRange } from '../model/discussionCapture';
import { XopcAnnotationStore, XopcAnnotationSync, XopcLocalAnnotation } from '../service/discussionAnnotations';
import { discussionReviewPlayback } from '../service/discussionReviewPlayback';
import { XopcDiscussionDetail } from '../model/discussionCapture';
import { XopcDiscussionCaptureRepository } from '../repository/discussionCaptureRepository';

const REFRESH_INTERVAL_MS: number = 3000;

export function discussionStillProcessing(detail: XopcDiscussionDetail): boolean {
  const status = detail.discussion.status;
  return status === 'recording' || status === 'stopping' || status === 'sealing' || status === 'organizing' ||
    detail.recordingJob?.state === 'queued' || detail.recordingJob?.state === 'running';
}

@ObservedV2
export class XopcDiscussionNoteViewModel {
  @Trace review?: XopcDiscussionReview;
  @Trace reviewQuery: string = '';
  @Trace reviewError: string = '';
  @Trace reviewLoading: boolean = false;
  @Trace previewEntry?: XopcReviewEntry;
  private reviewRequest: number = 0;
  private searchTimer: number = -1;
  @Trace resumePositionMs: number = 0;
  @Trace tab: string = 'summary';
  @Trace evidence?: XopcDiscussionEvidence;
  @Trace annotations: XopcResolvedAnnotation[] = [];
  @Trace localAnnotations: XopcLocalAnnotation[] = [];
  @Trace annotationError: string = '';
  @Trace selectedSegment: number = -1;
  private context?: common.Context;
  private annotationStore: XopcAnnotationStore = new XopcAnnotationStore();
  private annotationSync: XopcAnnotationSync = new XopcAnnotationSync(this.annotationStore);
  @Trace detail?: XopcDiscussionDetail;
  @Trace loading: boolean = false;
  @Trace error: string = '';
  @Trace retrying: boolean = false;
  private repository: XopcDiscussionCaptureRepository = new XopcDiscussionCaptureRepository();
  private noteId: string = '';
  private generation: number = 0;
  private evidenceRequest: number = 0;
  private refreshing: boolean = false;
  private timer: number = -1;
  private onNoteUpdated: () => void = (): void => {};
  private lastNoteUpdate: string = '';

  start(noteId: string, onNoteUpdated: () => void = (): void => {}): void {
    this.stop();
    this.noteId = noteId;
    this.onNoteUpdated = onNoteUpdated;
    this.lastNoteUpdate = '';
    this.evidence = undefined; this.annotations = []; this.localAnnotations = []; this.tab = 'summary'; this.resumePositionMs = 0;
    this.detail = undefined; this.review = undefined; this.reviewQuery = ''; this.reviewError = ''; this.previewEntry = undefined; this.selectedSegment = -1;
    this.error = '';
    this.loading = true;
    void this.refresh();
  }

  stop(): void {
    if (this.noteId && this.context) void this.annotationStore.saveReviewTab(this.noteId,this.tab).catch((): void => {});
    if (discussionReviewPlayback.noteId === this.noteId) void discussionReviewPlayback.stop();
    this.generation++; this.reviewRequest++;
    if (this.searchTimer !== -1) clearTimeout(this.searchTimer);
    this.searchTimer = -1;
    this.noteId = '';
    this.refreshing = false;
    if (this.timer !== -1) clearInterval(this.timer);
    this.timer = -1;
  }

  async refresh(): Promise<void> {
    if (!this.noteId || this.refreshing) return;
    const generation = this.generation;
    this.refreshing = true;
    try {
      const detail = await this.repository.byNote(this.noteId);
      if (generation !== this.generation) return;
      const first = !this.detail;
      if (this.detail && (this.detail.discussion.audioAttachmentId !== detail.discussion.audioAttachmentId || this.detail.discussion.audioDeletedAt !== detail.discussion.audioDeletedAt)) {
        this.reviewRequest++; this.review = undefined; this.evidence = undefined; this.previewEntry = undefined;
        if (discussionReviewPlayback.noteId === this.noteId) void discussionReviewPlayback.stop();
      }
      if (this.evidence && this.evidence.transcriptRevision !== detail.transcript.revision) {
        const old = this.evidence;
        this.evidence = { transcriptRevision: old.transcriptRevision,stale: true,audioAvailable: old.audioAvailable,timingVerified: old.timingVerified,segments: old.segments };
      }
      this.detail = detail;
      if (!this.reviewQuery.trim() || !this.review) void this.refreshReview();
      if (first && this.context) void this.restoreReviewPosition();
      if (this.context) void this.refreshAnnotations();
      this.error = '';
      const updateKey = detail.discussion.status === 'completed' || detail.discussion.audioAttachmentId
        ? detail.discussion.status + ':' + (detail.discussion.audioAttachmentId ?? '') : '';
      if (updateKey && updateKey !== this.lastNoteUpdate) {
        this.lastNoteUpdate = updateKey;
        this.onNoteUpdated();
      }
      if (discussionStillProcessing(detail)) {
        if (this.timer === -1) this.timer = setInterval((): void => { void this.refresh(); }, REFRESH_INTERVAL_MS);
      } else if (this.timer !== -1) {
        clearInterval(this.timer);
        this.timer = -1;
      }
    } catch (error) {
      if (generation === this.generation) {
        this.error = (error as Error).message;
        if (this.timer === -1 && (!this.detail || discussionStillProcessing(this.detail))) this.timer = setInterval((): void => { void this.refresh(); },REFRESH_INTERVAL_MS);
      }
    } finally {
      if (generation === this.generation) { this.refreshing = false; this.loading = false; }
    }
  }

  setReviewQuery(query: string): void {
    this.reviewQuery = query; this.reviewRequest++; this.review = undefined; this.previewEntry = undefined;
    if (this.searchTimer !== -1) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout((): void => { void this.refreshReview(); },250);
  }
  async refreshReview(more: boolean = false): Promise<void> {
    const id = this.detail?.discussion.id; if (!id || (more && !this.review)) return;
    const generation = this.generation; const request = ++this.reviewRequest; const connection = gatewaySession.connectionRevision();
    const previous = this.review; const query = this.reviewQuery;
    this.reviewLoading = true;
    try {
      const result = await this.repository.review(id,query,more ? previous?.hits.length ?? 0 : 0,more ? previous?.version ?? '' : '');
      gatewaySession.assertConnection(connection);
      if (generation !== this.generation || request !== this.reviewRequest || query !== this.reviewQuery) return;
      if (more && previous) result.hits = previous.hits.concat(result.hits);
      this.review = result; this.reviewError = '';
    } catch (caught) { if (generation === this.generation && request === this.reviewRequest) this.reviewError = (caught as Error).message; }
    finally { if (generation === this.generation && request === this.reviewRequest) this.reviewLoading = false; }
  }
  openReviewEntry(entry: XopcReviewEntry): void {
    this.previewEntry = entry;
    this.evidence = { transcriptRevision: entry.transcriptRevision ?? 0,stale: entry.stale || (entry.transcriptRevision !== undefined && entry.transcriptRevision !== this.detail?.transcript.revision) || (entry.provisional && entry.kind !== 'chapter'),
      audioAvailable: this.review?.coverage.audioAvailable ?? false,timingVerified: entry.segments.some((s: XopcEvidenceSegment): boolean => s.playback.length > 0),segments: entry.segments };
  }
  locateReviewSegment(sequence: number): void {
    if (this.evidence?.stale || (this.previewEntry?.provisional && this.previewEntry.kind !== 'chapter') || this.evidence?.transcriptRevision !== this.detail?.transcript.revision) return;
    this.selectedSegment = sequence; this.tab = 'transcript'; this.reviewQuery = ''; this.evidence = undefined; this.previewEntry = undefined; void this.refreshReview();
  }
  transcriptRows(): XopcDiscussionTranscriptSegment[] {
    const rows = this.detail?.transcript.segments ?? [];
    const index = rows.findIndex((row: XopcDiscussionTranscriptSegment): boolean => row.sequence === this.selectedSegment);
    return index < 0 ? rows : rows.slice(Math.max(0,index - 1),index + 2);
  }
  private async restoreReviewPosition(): Promise<void> {
    if (!this.context) return; const generation = this.generation;
    try {
      await this.annotationStore.initialize(this.context); const saved = await this.annotationStore.reviewPosition(this.noteId);
      if (generation !== this.generation || !saved) return;
      if (saved.tab === 'summary' || saved.tab === 'transcript' || saved.tab === 'marks') this.tab = saved.tab;
      if (saved.sourceId === this.detail?.discussion.audioAttachmentId) this.resumePositionMs = saved.positionMs;
    } catch (_error) {}
  }
  async resumePlayback(): Promise<void> { await this.play({ startedAtMs: this.resumePositionMs,endedAtMs: this.resumePositionMs + 30000 }); }
  setContext(context: common.Context): void { this.context = context; }
  async refreshAnnotations(): Promise<void> {
    const id = this.detail?.discussion.id; const context = this.context; const recordingId = this.detail?.discussion.clientRequestId;
    if (!id || !context || !recordingId) return;
    const generation = this.generation; const connection = gatewaySession.connectionRevision();
    try {
      await this.annotationStore.initialize(context);
      gatewaySession.assertConnection(connection); if (generation !== this.generation) return;
      const local = await this.annotationStore.list(recordingId);
      if (generation !== this.generation) return;
      this.localAnnotations = local;
      let syncError: string = '';
      try { await this.annotationSync.sync(recordingId,id); } catch (caught) { syncError = (caught as Error).message; }
      const remote = await this.repository.annotations(id);
      gatewaySession.assertConnection(connection);
      if (generation !== this.generation) return;
      this.annotations = remote; this.localAnnotations = await this.annotationStore.list(recordingId); this.annotationError = syncError;
    } catch (caught) { if (generation === this.generation) this.annotationError = (caught as Error).message; }
  }
  async cite(sequences: number[],revision?: number,play: boolean = false): Promise<void> {
    const id = this.detail?.discussion.id; if (!id || !sequences.length) return;
    const generation = this.generation; const request = ++this.evidenceRequest;
    try {
      const evidence = await this.repository.evidence(id,revision ?? this.detail?.organization?.transcriptRevision ?? this.detail?.transcript.revision ?? 0,sequences);
      if (generation !== this.generation) return;
      if (request !== this.evidenceRequest) return;
      evidence.stale = evidence.stale || evidence.transcriptRevision !== this.detail?.transcript.revision;
      this.previewEntry = undefined; this.evidence = evidence;
      if (play && evidence.segments.length && evidence.segments[0].playback.length) await this.play(evidence.segments[0].playback[0]);
    } catch (caught) { if (generation === this.generation) this.error = (caught as Error).message; }
  }
  async play(range: XopcPlaybackRange): Promise<void> {
    if (this.context && this.detail && this.noteId && !this.detail.discussion.audioDeletedAt) await discussionReviewPlayback.play(this.context,this.noteId,this.detail.discussion.id,range,this.detail.discussion.audioAttachmentId ?? '');
  }
  async markSegment(segment: XopcDiscussionTranscriptSegment): Promise<void> {
    const now = Date.now();
    const annotation: XopcDiscussionAnnotation = { id: util.generateRandomUUID(),kind: 'highlight',text: '',
      anchor: { type: 'transcript',capturedAt: now,transcriptRevision: this.detail?.transcript.revision ?? 0,segmentIds: [segment.sequence] },
      revision: 0,deleted: false,createdAt: now,updatedAt: now };
    if (await this.saveAnnotation(annotation)) this.tab = 'marks';
  }
  async saveAnnotation(annotation: XopcDiscussionAnnotation): Promise<boolean> {
    const recordingId = this.detail?.discussion.clientRequestId; const context = this.context;
    if (!recordingId || !context) return false;
    const generation = this.generation; const connection = gatewaySession.connectionRevision();
    try {
      await this.annotationStore.initialize(context); gatewaySession.assertConnection(connection); await this.annotationStore.save(recordingId,annotation);
      if (generation !== this.generation) return false; gatewaySession.assertConnection(connection);
      this.localAnnotations = await this.annotationStore.list(recordingId); this.annotationError = '';
      void this.refreshAnnotations(); return true;
    } catch (caught) { if (generation !== this.generation) return false; this.annotationError = (caught as Error).message; return false; }
  }
  visibleAnnotations(): XopcDiscussionAnnotation[] {
    const rows: XopcDiscussionAnnotation[] = this.annotations.map((item: XopcResolvedAnnotation): XopcDiscussionAnnotation => item.annotation);
    for (const local of this.localAnnotations) {
      const index = rows.findIndex((item: XopcDiscussionAnnotation): boolean => item.id === local.annotation.id);
      if (index >= 0 && local.state !== 'synced') rows[index] = local.annotation;
      else if (index < 0) rows.push(local.annotation);
    }
    return rows.filter((item: XopcDiscussionAnnotation): boolean => !item.deleted || this.annotationConflict(item.id)).sort((left: XopcDiscussionAnnotation,right: XopcDiscussionAnnotation): number => left.anchor.capturedAt - right.anchor.capturedAt);
  }
  annotationPending(id: string): boolean {
    return this.localAnnotations.some((row: XopcLocalAnnotation): boolean => row.annotation.id === id && row.state !== 'synced');
  }
  annotationConflict(id: string): boolean { return this.localAnnotations.some((row: XopcLocalAnnotation): boolean => row.annotation.id === id && row.state === 'conflict'); }
  annotationRanges(id: string): XopcPlaybackRange[] { return this.annotations.find((row: XopcResolvedAnnotation): boolean => row.annotation.id === id)?.playback ?? []; }
  async useServerAnnotation(id: string): Promise<void> {
    const local = this.localAnnotations.find((row: XopcLocalAnnotation): boolean => row.annotation.id === id);
    const remote = this.annotations.find((row: XopcResolvedAnnotation): boolean => row.annotation.id === id);
    if (local && remote) { await this.annotationStore.acknowledge(local,remote.annotation); await this.refreshAnnotations(); }
  }
  async removeAnnotation(annotation: XopcDiscussionAnnotation): Promise<void> {
    const removed: XopcDiscussionAnnotation = { id: annotation.id,kind: annotation.kind,text: annotation.text,anchor: annotation.anchor,revision: annotation.revision,deleted: true,createdAt: annotation.createdAt,updatedAt: Date.now() };
    await this.saveAnnotation(removed);
  }
  async locateAnnotation(id: string): Promise<void> {
    const resolved = this.annotations.find((item: XopcResolvedAnnotation): boolean => item.annotation.id === id);
    if (resolved?.evidence) this.evidence = resolved.evidence;

  }

  outcome(localSave: string = 'unknown',sync: string = 'pending'): XopcRecordingOutcomeInput {
    return discussionOutcomeInput(this.detail,localSave,sync);
  }
  async retryOutcome(mode: string): Promise<void> {
    if (mode !== 'analyze') { await this.retry(mode === 'regenerate'); return; }
    const id = this.detail?.discussion.id;
    if (!id || this.retrying) return;
    this.retrying = true; this.error = '';
    try { await this.repository.organize(id,this.detail?.discussion.template ?? 'general'); await this.refresh(); }
    catch (error) { this.error = (error as Error).message; }
    finally { this.retrying = false; }
  }
  async retry(fromAudio: boolean = false): Promise<void> {
    const id = this.detail?.discussion.id;
    if (!id || this.retrying) return;
    this.retrying = true;
    this.error = '';
    try { await this.repository.retry(id, fromAudio); await this.refresh(); }
    catch (error) { this.error = (error as Error).message; }
    finally { this.retrying = false; }
  }
}
