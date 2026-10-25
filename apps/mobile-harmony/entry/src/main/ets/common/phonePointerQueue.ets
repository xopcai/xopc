interface XopcQueuedPhonePoint { x: number; y: number; }
/** One transport-confirmed pointer at a time; MOVE coalesces without losing the final UP. */
export class XopcPhonePointerQueue {
  private sequence: number = 0;
  private outstanding: number = 0;
  private held: boolean = false;
  private latestMove?: XopcQueuedPhonePoint;
  private endPoint?: XopcQueuedPhonePoint;
  pendingSince: number = 0;
  onSend: (phase: string, x: number, y: number, seq: number) => void = (_phase: string, _x: number, _y: number, _seq: number): void => {};
  onCancel: () => void = (): void => {};
  pointer(phase: string, x: number, y: number): void {
    if (phase === 'cancel') { this.cancel(); return; }
    if (phase === 'down') {
      this.cancel(); this.held = true; this.dispatch('down', x, y); return;
    }
    if (!this.held) return;
    if (phase === 'move') this.latestMove = { x, y };
    else if (phase === 'up') {
      this.held = false;
      if (this.latestMove) this.latestMove = { x, y };
      this.endPoint = { x, y };
    }
    this.drain();
  }
  ack(seq: number): void {
    if (seq !== this.outstanding) return;
    this.outstanding = 0; this.pendingSince = 0; this.drain();
  }
  private drain(): void {
    if (this.outstanding) return;
    const move = this.latestMove;
    if (move) { this.latestMove = undefined; this.dispatch('move', move.x, move.y); return; }
    const end = this.endPoint;
    if (end) { this.endPoint = undefined; this.dispatch('up', end.x, end.y); }
  }
  private dispatch(phase: string, x: number, y: number): void {
    this.outstanding = ++this.sequence; this.pendingSince = Date.now();
    this.onSend(phase, x, y, this.outstanding);
  }
  cancel(): void {
    const active = this.held || this.outstanding !== 0 || this.endPoint !== undefined;
    this.held = false; this.latestMove = undefined; this.endPoint = undefined;
    this.outstanding = 0; this.pendingSince = 0;
    if (active) this.onCancel();
  }
}
