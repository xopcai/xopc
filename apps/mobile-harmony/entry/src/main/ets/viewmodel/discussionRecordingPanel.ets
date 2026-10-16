import { XopcRecordingPanelActions } from '../model/discussionCapture';
export { XopcRecordingPanelActions } from '../model/discussionCapture';
/** Presentation state has no ownership of the microphone, audio writes or upload jobs. */
export interface XopcRecordingPanelAvailability { mark: boolean; pause: boolean; finish: boolean; }
export function recordingPanelAvailability(capture: XopcRecordingPanelActions): XopcRecordingPanelAvailability {
  return { mark: capture.phase === 'recording' && capture.captureStatus === 'recording' && capture.inputConfirmed,
    pause: capture.phase === 'recording' || capture.phase === 'paused',
    finish: capture.phase === 'recording' || capture.phase === 'paused' || (capture.phase === 'error' && !capture.recoveryBusy) };
}

@ObservedV2
export class XopcDiscussionRecordingPanel {
  @Trace dismissed: boolean = false;
  @Trace compact: boolean = false;
  @Trace detailsOpen: boolean = false;
  @Trace transcriptOpen: boolean = false;
  @Trace positionMenu: boolean = false;
  @Trace windowWidth: number = 0;
  @Trace windowHeight: number = 0;
  @Trace panelX: number = 12;
  @Trace panelY: number = 12;
  @Trace finishing: boolean = false;
  @Trace notice: boolean = false;
  private placed: boolean = false;
  private dragging: boolean = false;
  private originX: number = 0;
  private originY: number = 0;
  private lastDragAt: number = -1000;
  private finishTask?: Promise<void>;

  get small(): boolean { return this.compact; }
  get narrow(): boolean { return this.windowWidth < 360; }
  get cardWidth(): number { return Math.max(0,Math.min(this.small ? 348 : 400,this.windowWidth - 24)); }
  get cardHeight(): number {
    const preferred = this.positionMenu ? 152 : this.small ? (this.narrow ? 156 : 108) + (this.notice ? 36 : 0) : 432;
    return Math.max(0,Math.min(preferred,this.windowHeight - 24));
  }
  resize(width: number,height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    this.dragging = false;
    this.windowWidth = width; this.windowHeight = height;
    if (!this.placed) { this.panelX = width - this.cardWidth - 12; this.panelY = height - this.cardHeight - 12; this.placed = true; }
    this.fit();
  }
  fit(): void {
    this.panelX = Math.max(12,Math.min(this.panelX,Math.max(12,this.windowWidth - this.cardWidth - 12)));
    this.panelY = Math.max(12,Math.min(this.panelY,Math.max(12,this.windowHeight - this.cardHeight - 12)));
  }
  setCompact(compact: boolean): void { this.compact = compact; this.positionMenu = false; this.dragging = false; this.fit(); }
  fresh(): void { this.dismissed = false; this.setCompact(false); this.detailsOpen = false; this.transcriptOpen = false; }
  setNotice(notice: boolean): void { this.notice = notice; this.fit(); }
  togglePositions(now: number = Date.now()): void {
    if (this.dragging || now - this.lastDragAt < 250) return;
    this.positionMenu = !this.positionMenu; this.fit();
  }
  corner(right: boolean,bottom: boolean): void {
    this.positionMenu = false; this.dragging = false;
    this.panelX = right ? this.windowWidth - this.cardWidth - 12 : 12;
    this.panelY = bottom ? this.windowHeight - this.cardHeight - 12 : 12; this.fit();
  }
  dragStart(): void {
    this.positionMenu = false; this.originX = this.panelX; this.originY = this.panelY; this.dragging = true;
  }
  dragTo(dx: number,dy: number): void {
    if (!this.dragging || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.panelX = this.originX + dx; this.panelY = this.originY + dy; this.fit();
  }
  dragEnd(now: number = Date.now()): void { this.dragging = false; this.lastDragAt = now; }
  dragCancel(now: number = Date.now()): void {
    if (this.dragging) { this.panelX = this.originX; this.panelY = this.originY; this.fit(); }
    this.dragEnd(now);
  }
  async mark(capture: XopcRecordingPanelActions): Promise<void> {
    if (!this.finishing && recordingPanelAvailability(capture).mark) await capture.mark();
  }
  pause(capture: XopcRecordingPanelActions): void {
    if (!this.finishing && recordingPanelAvailability(capture).pause) capture.togglePause();
  }
  finish(capture: XopcRecordingPanelActions,onSaved: (id: string) => void): Promise<void> {
    if (this.finishTask) return this.finishTask;
    if (!recordingPanelAvailability(capture).finish) return Promise.resolve();
    this.finishing = true;
    this.finishTask = capture.stop().then((id: string): void => {
      if (id && capture.phase === 'completed') onSaved(id);
    }).finally((): void => { this.finishing = false; this.finishTask = undefined; });
    return this.finishTask;
  }
}
