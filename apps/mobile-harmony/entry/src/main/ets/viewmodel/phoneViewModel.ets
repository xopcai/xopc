import { image } from '@kit.ImageKit';
import { XopcPhoneBinding, XopcPhoneLiveState, XopcPhoneSummary, XopcPhoneAction, XopcPhoneFailureBody } from '../model/phone';
import { XopcPhoneRepository } from '../repository/phoneRepository';
import { XopcPhoneStream } from '../service/phoneStream';
import { gatewaySession } from '../service/gatewaySession';
import { XopcHttpError } from '../service/transport';

@ObservedV2
export class XopcPhoneViewModel {
  @Trace summary?: XopcPhoneSummary;
  @Trace state?: XopcPhoneLiveState;
  @Trace phase: string = 'idle';
  @Trace busy: boolean = false;
  @Trace error: string = '';
  @Trace imageWidth: number = 1;
  @Trace imageHeight: number = 2;
  @Trace snapshot?: image.PixelMap;
  @Trace geometry: number = 0;
  @Trace touching: boolean = false;
  private repository: XopcPhoneRepository = new XopcPhoneRepository();
  private stream: XopcPhoneStream = new XopcPhoneStream();
  private id: string = '';
  private active: boolean = false;
  private visible: boolean = false;
  private generation: number = 0;
  private operations: number = 0;
  private connection: number = -1;
  private supported?: boolean;
  private timer: number = -1;
  private heartbeat: number = -1;
  private refreshing: boolean = false;
  private streamKey: string = '';
  private surfaceId: string = '';
  private frameSeq: number = 0;
  private frameAt: number = 0;
  private lastRefresh: number = 0;

  constructor() {
    this.stream.onPhase = (phase: string): void => { if (this.phase !== 'blocked') this.phase = phase; };
    this.stream.onGeometry = (width: number, height: number, version: number): void => {
      this.imageWidth = width; this.imageHeight = height; this.geometry = version;
    };
    this.stream.onFault = (code: string): void => {
      this.clearSnapshot();
      if (code === 'PHONE_APP_DENIED' || code === 'PHONE_ACCESS_REVOKED' || code === 'PHONE_PERMISSION_REQUIRED') {
        this.error = code; this.phase = 'blocked'; this.state = undefined;
      }
    };
  }
  bind(id: string, active: boolean, visible: boolean): void {
    const connection = gatewaySession.connectionRevision();
    if (id !== this.id || connection !== this.connection) {
      this.leave(); this.generation++; this.id = id; this.connection = connection;
      this.summary = undefined; this.state = undefined; this.supported = undefined; this.error = ''; this.phase = 'idle';
      this.refreshing = false;
    }
    const wasVisible = this.visible;
    const nextActive = active && !!id;
    const nextVisible = visible && nextActive;
    if (this.active !== nextActive) {
      this.generation++; this.refreshing = false; this.busy = false;
    }
    this.active = nextActive; this.visible = nextVisible;
    if (wasVisible && !this.visible) { this.cancel(); this.touching = false; }
    if (!this.active) this.leave();
    if (this.active && this.timer === -1) this.timer = setInterval((): void => {
      if (Date.now() - this.lastRefresh >= (this.visible ? 1200 : 5000)) void this.refresh();
    }, 1200);
    if (!this.active) { clearInterval(this.timer); this.timer = -1; }
    if (this.active) void this.refresh();
  }
  surface(id: string): void { this.surfaceId = id; this.stream.setSurface(id); this.ensureStream(); }
  private clearSnapshot(): void {
    const previous = this.snapshot; this.snapshot = undefined; this.frameAt = 0; this.frameSeq = 0;
    if (previous) previous.release().catch((): void => {});
  }
  private leave(): void {
    const state = this.state; const binding = this.summary?.binding; const connection = this.connection;
    this.cancel(); this.touching = false; this.stream.close(); this.streamKey = ''; this.clearSnapshot();
    clearInterval(this.heartbeat); this.heartbeat = -1;
    if (state?.ownControl && binding && connection === gatewaySession.connectionRevision()) {
      state.ownControl = false;
      void this.repository.control(binding, state, 'release').catch((): void => {});
    }
    this.phase = 'idle';
  }
  async refresh(): Promise<void> {
    if (!this.active || this.busy || this.refreshing || this.supported === false) return;
    const generation = this.generation; const id = this.id; const connection = this.connection;
    const operationRevision = this.operations;
    this.refreshing = true; this.lastRefresh = Date.now();
    try {
      if (this.supported === undefined) {
        const supported = await this.repository.supported();
        if (generation !== this.generation || operationRevision !== this.operations) return;
        this.supported = supported; if (!supported) return;
      }
      const summary = await this.repository.summary(id);
      if (generation !== this.generation || operationRevision !== this.operations || !this.active) return;
      gatewaySession.assertConnection(connection);
      const previousBinding = this.summary?.binding;
      if (previousBinding && summary.binding && (previousBinding.transcriptId !== summary.binding.transcriptId
        || previousBinding.phoneSessionId !== summary.binding.phoneSessionId)) {
        this.leave(); this.state = undefined;
      }
      this.summary = summary;
      if (!summary.available || summary.access === 'none') { this.leave(); this.state = undefined; this.error = ''; return; }
      if (!this.visible && !this.state) return;
      const state = await this.repository.state(id);
      if (generation !== this.generation || operationRevision !== this.operations || !this.active) return;
      gatewaySession.assertConnection(connection);
      if (!state || state.report.sessionId !== summary.binding?.phoneSessionId) { this.leave(); this.state = undefined; return; }
      this.state = state;
      this.updateHeartbeat(); this.ensureStream();
      if (this.visible && this.phase === 'fallback' && !this.busy) await this.loadFrame(generation);
    } catch (error) {
      if (generation !== this.generation || operationRevision !== this.operations) return;
      const failure = error as Error;
      this.error = this.errorCode(failure);
      this.leave(); this.state = undefined;
      this.phase = 'failed';
      if (failure instanceof XopcHttpError && (failure.status === 403 || failure.status === 401)) this.summary = undefined;
    } finally { if (generation === this.generation) this.refreshing = false; }
  }
  private ensureStream(): void {
    const binding = this.summary?.binding; const state = this.state;
    if (state?.report.status === 'closed') { this.stream.close(); this.streamKey = ''; return; }
    if (state?.report.reconnectRequired) { this.phase = 'restore'; return; }
    if (!this.active || !this.surfaceId || !binding || !state || this.phase === 'fallback' || this.phase === 'blocked') return;
    const key = binding.phoneSessionId + ':' + (state.ownControl ? state.report.controlEpoch.toString() : 'view');
    if (this.streamKey === key) return;
    this.streamKey = key; this.stream.setSurface(this.surfaceId);
    void this.stream.open(this.repository, binding, state);
  }
  private updateHeartbeat(): void {
    if (this.state?.ownControl && this.active && this.heartbeat === -1) {
      this.heartbeat = setInterval((): void => { void this.command('heartbeat'); }, 5000);
    } else if (!this.state?.ownControl || !this.active) { clearInterval(this.heartbeat); this.heartbeat = -1; }
  }
  async command(op: string, action?: XopcPhoneAction): Promise<void> {
    const binding = this.summary?.binding; const state = this.state;
    if (!binding || !state || !this.active || (!this.visible && op !== 'heartbeat') || this.busy) return;
    const generation = this.generation;
    const heartbeat = op === 'heartbeat';
    if (!heartbeat) { this.operations++; this.busy = true; this.error = ''; this.cancel(); }
    try {
      const result = await this.repository.control(binding, state, op, action,
        this.phase === 'fallback' ? this.frameSeq : undefined, this.phase === 'playing' ? this.geometry : undefined);
      if (generation !== this.generation || !this.active) {
        if (result.ownControl && this.connection === gatewaySession.connectionRevision()) {
          void this.repository.control(binding, result, 'release').catch((): void => {});
        }
        return;
      }
      this.state = result;
      if (result.report.sessionId !== binding.phoneSessionId) {
        const summary = await this.repository.summary(this.id);
        if (generation !== this.generation || !this.active) return;
        this.summary = summary; this.phase = 'idle'; this.streamKey = '';
      }
      this.updateHeartbeat();
      if (!heartbeat) {
        if (this.phase !== 'fallback') this.ensureStream();
        else await this.loadFrame(generation);
      }
    } catch (error) {
      if (generation === this.generation) {
        this.error = this.errorCode(error as Error);
        if (heartbeat) { this.leave(); this.state = undefined; }
        else { this.cancel(); await this.refresh(); }
      }
    } finally { if (!heartbeat && generation === this.generation) this.busy = false; }
  }
  private async loadFrame(generation: number): Promise<void> {
    const binding = this.summary?.binding; if (!binding || !this.visible || this.touching) return;
    const frame = await this.repository.frame(binding);
    const source = image.createImageSource(frame.bytes);
    let pixel: image.PixelMap;
    try { pixel = await source.createPixelMap(); } finally { source.release(); }
    if (generation !== this.generation || !this.visible || this.phase !== 'fallback') { await pixel.release(); return; }
    this.clearSnapshot(); this.snapshot = pixel; this.frameSeq = frame.seq; this.frameAt = frame.capturedAt;
    this.imageWidth = frame.width; this.imageHeight = frame.height;
  }
  pointer(phase: string, x: number, y: number): void {
    if (!this.state?.ownControl || this.busy || !this.visible || this.phase !== 'playing') return;
    this.stream.pointer(phase, x, y);
  }
  snapshotReady(): boolean { return !!this.snapshot && this.frameSeq > 0 && Date.now() - this.frameAt < 5000; }
  cancel(): void { this.stream.cancel(); }
  retry(): void {
    this.stream.close(); this.streamKey = ''; this.phase = 'idle'; this.error = ''; this.supported = undefined;
    this.clearSnapshot(); void this.refresh();
  }
  private errorCode(error: Error): string {
    if (error instanceof XopcHttpError) {
      try { return (JSON.parse(error.body) as XopcPhoneFailureBody).error?.code ?? error.message; } catch (_) {}
    }
    return error.message;
  }
  dispose(): void {
    this.active = false; this.visible = false; this.leave(); this.generation++;
    clearInterval(this.timer); this.timer = -1;
  }
}
