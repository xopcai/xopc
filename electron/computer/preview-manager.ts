import { randomUUID } from 'node:crypto';
import type { ComputerPreviewFrame, ComputerPreviewPreset, ComputerPreviewState } from '@xopcai/computer-control-contract';
import type { ComputerPreviewAuthority } from '../../src/computer/broker.js';

export interface PreviewPixels { width: number; height: number; bytes: Uint8Array }
export interface PreviewCapture {
  close(): void;
  setPreset(preset: 'compact' | 'expanded'): void;
}
export interface PreviewSink {
  send(message: ComputerPreviewState | ComputerPreviewFrame): void;
  close(): void;
}
export interface PreviewDependencies {
  authority(): ComputerPreviewAuthority | undefined;
  validate(authority: ComputerPreviewAuthority): Promise<void>;
  capture(authority: ComputerPreviewAuthority, preset: 'compact' | 'expanded',
    frame: (pixels: PreviewPixels) => Promise<void>, failed: (code: string) => void): Promise<PreviewCapture>;
  changed(state: ComputerPreviewState): void;
}

/** One local viewer, bounded by presentation acknowledgement; no model observations. */
export class ComputerPreviewManager {
  private state?: ComputerPreviewState;
  private key?: string;
  private authority?: ComputerPreviewAuthority;
  private releaseAuthority?: () => void;
  private subscription?: { id: string; sink: PreviewSink; preset: ComputerPreviewPreset };
  private capture?: PreviewCapture;
  private captureController?: AbortController;
  private revision = 0;
  private streamEpoch = 0;
  private sequence = 0;
  private pending?: { sequence: number; resolve(): void; timer: ReturnType<typeof setTimeout> };
  private disposed = false;
  constructor(private readonly deps: PreviewDependencies) {}

  sync(): void {
    if (this.disposed) return;
    const authority = this.deps.authority();
    if (!authority) {
      if (this.state && this.state.status !== 'ended') {
        this.stopCapture(); this.emit('ended'); this.closeSubscription();
        this.releaseAuthority?.(); this.releaseAuthority = undefined;
      }
      this.authority = undefined; this.key = undefined;
      return;
    }
    const key = JSON.stringify([authority.conversationId, authority.runId, authority.brokerEpoch, authority.computerSessionId,
      authority.target?.appId, authority.target?.pid, authority.target?.processIdentity, authority.target?.windowId]);
    if (key === this.key) return;
    this.stopCapture(); this.closeSubscription(); this.releaseAuthority?.();
    this.key = key; this.authority = authority;
    const abort = () => this.sync();
    authority.signal.addEventListener('abort', abort, { once: true });
    this.releaseAuthority = () => authority.signal.removeEventListener('abort', abort);
    this.state = { previewId: randomUUID(), conversationId: authority.conversationId, runId: authority.runId,
      computerSessionId: authority.computerSessionId, brokerEpoch: authority.brokerEpoch, appName: authority.appName,
      targetEpoch: (this.state?.targetEpoch ?? 0) + 1, status: authority.target ? 'available' : 'preparing' };
    this.notify();
  }
  current(conversationId: string): ComputerPreviewState | undefined {
    this.sync();
    return this.state?.conversationId === conversationId ? { ...this.state } : undefined;
  }
  subscribe(conversationId: string, runId: string | undefined, preset: 'compact' | 'expanded', sink: PreviewSink): string {
    this.sync();
    if (!this.authority?.target || !this.state || this.authority.conversationId !== conversationId
      || runId !== undefined && this.authority.runId !== runId) throw new Error('COMPUTER_PREVIEW_SESSION_UNAVAILABLE');
    this.stopCapture(); this.closeSubscription();
    const id = randomUUID(); this.subscription = { id, sink, preset };
    this.emit('preparing');
    void this.startCapture();
    return id;
  }
  setPreset(id: string, preset: ComputerPreviewPreset): void {
    this.assertSubscription(id);
    this.subscription!.preset = preset;
    if (preset === 'paused') { this.stopCapture(); this.emit('paused'); }
    else if (this.capture) this.capture.setPreset(preset);
    else { this.emit('preparing'); void this.startCapture(); }
  }
  acknowledge(id: string, streamEpoch: number, sequence: number): void {
    if (this.subscription?.id === id && this.streamEpoch === streamEpoch && this.pending?.sequence === sequence) this.clearPending();
  }
  unsubscribe(id: string): void {
    if (this.subscription?.id !== id) return;
    this.stopCapture(); this.closeSubscription();
    if (this.authority) this.emit('available');
  }
  controlSession(id: string): string {
    this.sync(); this.assertSubscription(id);
    if (!this.authority) throw new Error('COMPUTER_PREVIEW_REVOKED');
    return this.authority.computerSessionId;
  }
  private assertSubscription(id: string): void {
    if (this.subscription?.id !== id) throw new Error('COMPUTER_PREVIEW_REVOKED');
  }
  private emit(status: ComputerPreviewState['status'], errorCode?: string): void {
    if (!this.state) return;
    this.state = { ...this.state, status, errorCode };
    this.notify();
    try { this.subscription?.sink.send({ ...this.state }); } catch { this.stopCapture(); this.closeSubscription(); }
  }
  private notify(): void { try { if (this.state) this.deps.changed({ ...this.state }); } catch { /* Preview delivery never fails an input command. */ } }
  private async startCapture(): Promise<void> {
    const authority = this.authority, subscription = this.subscription;
    if (!authority || !subscription || subscription.preset === 'paused') return;
    const revision = ++this.revision;
    const controller = new AbortController(); this.captureController = controller;
    const epoch = ++this.streamEpoch;
    const current = () => !this.disposed && revision === this.revision && this.subscription === subscription
      && this.authority === authority && !authority.signal.aborted;
    try {
      await this.deps.validate(authority);
      if (!current()) return;
      const capture = await this.deps.capture({ ...authority, signal: AbortSignal.any([authority.signal, controller.signal]) }, subscription.preset, async pixels => {
        if (!current() || !this.state) return;
        if (!Number.isInteger(pixels.width) || !Number.isInteger(pixels.height) || pixels.width < 1 || pixels.height < 1
          || pixels.width > 1600 || pixels.height > 1600 || pixels.bytes.byteLength < 1 || pixels.bytes.byteLength > 2 * 1024 * 1024) {
          throw new Error('COMPUTER_PREVIEW_INVALID_FRAME');
        }
        if (this.state.status !== 'live') this.emit('live');
        const sequence = ++this.sequence;
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => {
            this.stopCapture(); this.emit('unavailable', 'COMPUTER_PREVIEW_PRESENTATION_TIMEOUT');
          }, 1500);
          this.pending = { sequence, resolve, timer };
          try { subscription.sink.send({ version: 1, previewId: this.state!.previewId, targetEpoch: this.state!.targetEpoch,
            streamEpoch: epoch, sequence, width: pixels.width, height: pixels.height, mimeType: 'image/jpeg', bytes: pixels.bytes }); }
          catch { this.unsubscribe(subscription.id); }
        });
      }, code => {
        if (current()) { this.stopCapture(); this.emit('unavailable', code); }
      });
      if (!current()) { capture.close(); return; }
      this.capture = capture;
    } catch {
      if (current()) { this.stopCapture(); this.emit('unavailable', 'COMPUTER_PREVIEW_CAPTURE_UNAVAILABLE'); }
    }
  }
  private clearPending(): void {
    const pending = this.pending; this.pending = undefined;
    if (pending) { clearTimeout(pending.timer); pending.resolve(); }
  }
  private stopCapture(): void {
    this.revision++; this.captureController?.abort(); this.captureController = undefined;
    this.clearPending(); this.capture?.close(); this.capture = undefined;
  }
  private closeSubscription(): void {
    const subscription = this.subscription; this.subscription = undefined; subscription?.sink.close();
  }
  dispose(): void {
    this.disposed = true; this.stopCapture(); this.emit('ended'); this.closeSubscription();
    this.releaseAuthority?.(); this.authority = undefined;
  }
}
