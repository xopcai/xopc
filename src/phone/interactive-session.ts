import { PhoneError } from './contracts.js';
import type { PhoneInteractiveProvider, PhonePointer, PhoneVideoPacket } from './live-provider.js';

/** Shared device source with bounded video gating and ordered, fenced input. */
export class PhoneInteractiveSession {
  private viewers = new Map<string, { packet: (packet: PhoneVideoPacket) => void; fault: (code: string) => void; key: boolean }>();
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0; private seq = new Map<string, number>();
  private packets: PhoneVideoPacket[] = []; private bytes = 0; private checkedAt = 0;
  private allowed = false; private closed = false; private timer?: ReturnType<typeof setTimeout>;
  private unsubscribe?: () => void; private config?: PhoneVideoPacket;
  private started?: Promise<void>;
  private gesture?: { x: number; y: number; at: number };
  private verification?: Promise<void>;
  constructor(readonly provider: PhoneInteractiveProvider, private checkScreen: () => Promise<void>,
    private authorize: (client: string, epoch: number) => void,
    private onGesture: (action: 'tap' | 'longPress' | 'swipe') => void = () => {}) {}
  start(): Promise<void> {
    return this.started ??= (async () => {
      await this.checkScreen(); this.checkedAt = Date.now(); this.allowed = true;
      this.unsubscribe = this.provider.subscribe(packet => {
        if (packet.config) this.config = packet;
        this.packets.push(packet); this.bytes += packet.data.length;
        if (this.bytes > 2 * 1024 * 1024) { this.packets = []; this.bytes = 0; for (const viewer of this.viewers.values()) viewer.key = false; }
      });
      await this.provider.start();
      void this.poll();
    })();
  }
  private verifyScreen(): Promise<void> {
    return this.verification ??= this.checkScreen().then(() => { this.checkedAt = Date.now(); this.allowed = true; }, error => {
      this.allowed = false; throw error;
    }).finally(() => { this.verification = undefined; });
  }
  private async poll(): Promise<void> {
    if (this.closed) return;
    // Verify foreground after capture, before publishing the staged packets.
    const packets = this.packets; this.packets = []; this.bytes = 0;
    try {
      const wasAllowed = this.allowed;
      await this.verifyScreen();
      if (this.closed) return;
      if (!wasAllowed) this.provider.refresh();
      for (const packet of packets) for (const viewer of this.viewers.values()) {
        if (packet.geometry && packet.geometry.version !== this.provider.geometry.version) continue;
        if (packet.config) { viewer.key = false; viewer.packet(packet); }
        else if (packet.key || viewer.key) {
          if (!viewer.key && this.config) viewer.packet(this.config);
          viewer.key = true; viewer.packet(packet);
        }
      }
    } catch (error) {
      this.allowed = false;
      this.packets = []; this.bytes = 0;
      await this.revoke().catch(() => {});
      const code = error instanceof PhoneError ? error.code : 'PHONE_VIDEO_DISCONNECTED';
      for (const viewer of this.viewers.values()) { viewer.key = false; viewer.fault(code); }
    }
    if (!this.closed) this.timer = setTimeout(() => void this.poll(), 35);
  }
  subscribe(client: string, packet: (packet: PhoneVideoPacket) => void, fault: (code: string) => void): () => void {
    if (this.viewers.has(client) || this.viewers.size >= 4) throw new PhoneError('PHONE_VIEW_BUSY', 'Phone viewer connection limit reached', 409);
    this.viewers.set(client, { packet, fault, key: false });
    this.provider.refresh();
    return () => { this.viewers.delete(client); this.seq.delete(client); };
  }
  input(client: string, input: PhonePointer): Promise<void> {
    this.authorize(client, input.epoch);
    if (this.closed || !this.allowed) throw new PhoneError('PHONE_SCREEN_UNVERIFIED', 'Wait for an authorized phone frame', 409);
    if (input.seq <= (this.seq.get(client) ?? 0)) throw new PhoneError('PHONE_INPUT_SEQUENCE', 'Stale input sequence', 409);
    if (this.pending >= 8) throw new PhoneError('PHONE_INPUT_BACKPRESSURE', 'Input queue full; release and start a new gesture', 409);
    this.seq.set(client, input.seq); this.pending++;
    const work = this.queue.catch(() => {}).then(async () => {
      this.authorize(client, input.epoch);
      // A cloud round trip may outlast the freshness window. Reverify rather than
      // injecting against stale authorization or terminating a healthy gesture.
      if (Date.now() - this.checkedAt > 300) await this.verifyScreen();
      this.authorize(client, input.epoch);
      if (!this.allowed || this.closed) throw new PhoneError('PHONE_APP_DENIED', 'Phone screen is unavailable', 403);
      await this.provider.pointer(input);
      if (input.phase === 'down') this.gesture = { x: input.x, y: input.y, at: Date.now() };
      else if (input.phase === 'up' || input.phase === 'cancel') {
        const start = this.gesture; this.gesture = undefined;
        if (start && input.phase === 'up') this.onGesture(Math.hypot(start.x - input.x, start.y - input.y) > 18 ? 'swipe' : (input.durationMs ?? Date.now() - start.at) > 600 ? 'longPress' : 'tap');
      }
    }).finally(() => { this.pending--; });
    this.queue = work; return work;
  }
  async revoke(): Promise<void> {
    const work = this.queue.catch(() => {}).then(async () => { await this.provider.revoke(); this.gesture = undefined; });
    this.queue = work; await work;
  }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true; clearTimeout(this.timer);
    await this.revoke().catch(() => {}); this.unsubscribe?.();
    for (const viewer of this.viewers.values()) viewer.fault('PHONE_VIDEO_ENDED');
    this.viewers.clear(); this.packets = []; this.config = undefined;
    await this.provider.close();
  }
  get viewerCount(): number { return this.viewers.size; }
  verifyGeometry(version: number): boolean { return this.allowed && Date.now() - this.checkedAt < 300 && version === this.provider.geometry.version; }
  authorizeClient(client: string, epoch: number): void { this.authorize(client, epoch); }
}
