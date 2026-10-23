import { createHash } from 'node:crypto';

import type { PhoneObservation } from './contracts.js';

/** Active execution time excludes explicit human intervention. */
export class PhoneOperationBudget {
  readonly controller = new AbortController();
  private remaining = 90_000;
  private started = 0;
  private timer?: ReturnType<typeof setTimeout>;
  resume(): void {
    if (this.timer || this.controller.signal.aborted) return;
    this.started = Date.now();
    this.timer = setTimeout(() => this.controller.abort(), this.remaining);
    this.timer.unref();
  }
  pause(): void {
    if (!this.timer) return;
    clearTimeout(this.timer); this.timer = undefined;
    this.remaining = Math.max(0, this.remaining - (Date.now() - this.started));
  }
  dispose(): void { this.pause(); }
}

export type PhoneLiveFrame = Omit<PhoneObservation, 'elements' | 'frameId'> & { seq: number };
export class PhoneFrameCache {
  private history: Array<Omit<PhoneLiveFrame, 'frame'> & { layout: string }> = [];
  private frame?: PhoneLiveFrame;
  private seq = 0;
  set(observation: PhoneObservation): void {
    this.frame?.frame.fill(0);
    this.frame = { seq: ++this.seq, capturedAt: observation.capturedAt, width: observation.width, height: observation.height,
      rotation: observation.rotation, package: observation.package, frame: Buffer.from(observation.frame) };
    const { frame: _pixels, ...metadata } = this.frame;
    this.history.push({ ...metadata, layout: this.layout(observation) });
    this.history = this.history.filter(frame => Date.now() - frame.capturedAt <= 10_000).slice(-128);
  }
  get(): PhoneLiveFrame | undefined { return this.frame; }
  layout(observation: PhoneObservation): string { return createHash('sha256').update(JSON.stringify(observation.elements)).digest('hex'); }
  metadata(seq: number | undefined) { return this.history.find(frame => frame.seq === seq); }
  invalidate(): void { this.frame?.frame.fill(0); this.frame = undefined; }
  clear(): void { this.invalidate(); this.history = []; }
}
