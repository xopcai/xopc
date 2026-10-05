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
  @Trace detail?: XopcDiscussionDetail;
  @Trace loading: boolean = false;
  @Trace error: string = '';
  @Trace retrying: boolean = false;
  private repository: XopcDiscussionCaptureRepository = new XopcDiscussionCaptureRepository();
  private noteId: string = '';
  private generation: number = 0;
  private refreshing: boolean = false;
  private timer: number = -1;
  private onNoteUpdated: () => void = (): void => {};
  private lastNoteUpdate: string = '';

  start(noteId: string, onNoteUpdated: () => void = (): void => {}): void {
    this.stop();
    this.noteId = noteId;
    this.onNoteUpdated = onNoteUpdated;
    this.lastNoteUpdate = '';
    this.detail = undefined;
    this.error = '';
    this.loading = true;
    void this.refresh();
  }

  stop(): void {
    this.generation++;
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
      this.detail = detail;
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
      if (generation === this.generation) this.error = (error as Error).message;
    } finally {
      if (generation === this.generation) { this.refreshing = false; this.loading = false; }
    }
  }

  async retry(): Promise<void> {
    const id = this.detail?.discussion.id;
    if (!id || this.retrying) return;
    this.retrying = true;
    this.error = '';
    try { await this.repository.retry(id); await this.refresh(); }
    catch (error) { this.error = (error as Error).message; }
    finally { this.retrying = false; }
  }
}
