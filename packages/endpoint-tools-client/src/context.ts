import {
  ENDPOINT_CONTEXT_HEARTBEAT_MS, ENDPOINT_CONTEXT_REFRESH_MS,
  type EndpointContextValues,
} from '@xopcai/endpoint-tools-protocol';

interface ContextClaim { endpointId: string; token: string }
interface ContextConnection { connectionEpoch: string; revision: number; reportSequence?: number; heartbeatSequence?: number }
export interface EndpointContextPublisherOptions {
  request(path: string, body?: unknown, signal?: AbortSignal): Promise<{ ok: boolean; payload?: ContextConnection }>;
  capture(): EndpointContextValues | Promise<EndpointContextValues>;
  isForeground(): boolean;
  createId(): string;
  now?: () => number;
}

/** Shares only registered basic fields while in use; never requests personal permissions. */
export class EndpointContextPublisher {
  private claim?: ContextClaim;
  private connection?: ContextConnection;
  private sequence = 0;
  private heartbeatSequence = 0;
  private nextCapture = 0;
  private timer?: ReturnType<typeof setInterval>;
  private controller?: AbortController;
  private pending?: Promise<void>;
  private refreshRequested = false;
  constructor(private readonly options: EndpointContextPublisherOptions) {}
  start(claim: ContextClaim) {
    this.stop();
    this.claim = claim;
    this.controller = new AbortController();
    this.timer = setInterval(() => { void this.tick(); }, ENDPOINT_CONTEXT_HEARTBEAT_MS);
    void this.tick();
  }
  stop() {
    clearInterval(this.timer); this.timer = undefined;
    this.controller?.abort(); this.controller = undefined;
    this.claim = undefined; this.connection = undefined;
    this.sequence = 0; this.heartbeatSequence = 0; this.nextCapture = 0;
    this.pending = undefined; this.refreshRequested = false;
  }
  refresh() { this.nextCapture = 0; this.refreshRequested = true; return this.tick(); }
  tick(): Promise<void> {
    if (this.pending) return this.pending;
    const controller = this.controller;
    if (!controller || !this.claim) return Promise.resolve();
    const pending = this.publish(this.claim, controller).catch(() => {
      if (this.controller === controller) { this.connection = undefined; this.nextCapture = 0; }
    }).finally(() => {
      if (this.pending !== pending) return;
      this.pending = undefined;
      if (this.refreshRequested) { this.refreshRequested = false; void this.tick(); }
    });
    this.pending = pending;
    return pending;
  }
  private async publish(claim: ContextClaim, controller: AbortController) {
    const request = async (path: string, body?: unknown) => {
      const result = await this.options.request(path, body, controller.signal);
      controller.signal.throwIfAborted();
      if (!result.ok || !result.payload || !Number.isSafeInteger(result.payload.revision)) throw new Error('Context report unavailable');
      return result.payload;
    };
    const root = '/api/user-context/environment';
    if (!this.connection) {
      this.connection = await request(`${root}/endpoints/${encodeURIComponent(claim.endpointId)}`);
      if (!this.connection.connectionEpoch) throw new Error('Context connection unavailable');
      this.sequence = Math.max(this.sequence, this.connection.reportSequence ?? 0);
      this.heartbeatSequence = Math.max(this.heartbeatSequence, this.connection.heartbeatSequence ?? 0);
    }
    const connection = this.connection;
    const origin = { type: 'endpoint', ...claim };
    await request(`${root}/heartbeats`, { origin, heartbeat: { connectionEpoch: connection.connectionEpoch,
      sequence: ++this.heartbeatSequence, availability: this.options.isForeground() ? 'foreground' : 'background' } });
    if (!this.options.isForeground()) return;
    const now = (this.options.now ?? Date.now)();
    if (now < this.nextCapture) return;
    const values = await this.options.capture();
    controller.signal.throwIfAborted();
    if (!this.options.isForeground()) { this.refreshRequested = true; return; }
    const ack = await request(`${root}/reports`, { origin, report: {
      version: 1, reportId: this.options.createId(), connectionEpoch: connection.connectionEpoch,
      sequence: ++this.sequence, baseRevision: null, mode: 'full', capturedAt: now, values,
    } });
    connection.revision = ack.revision;
    this.nextCapture = now + ENDPOINT_CONTEXT_REFRESH_MS;
  }
}
