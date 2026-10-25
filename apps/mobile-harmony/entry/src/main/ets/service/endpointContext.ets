import { i18n } from '@kit.LocalizationKit';
import { gatewaySession } from './gatewaySession';
import { layoutState } from './layoutState';
import { XopcTurnClaim } from '../model/realtime';

interface ContextAck { connectionEpoch?: string; revision: number; }
interface ContextEnvelope { ok: boolean; payload?: ContextAck; }
interface ContextValues { 'environment.timezone': string; 'environment.locale': string; }
interface ContextReport {
  version: number; reportId: string; connectionEpoch: string; sequence: number;
  baseRevision: null; mode: string; capturedAt: number; values: ContextValues;
}
interface ContextHeartbeat { connectionEpoch: string; sequence: number; availability: string; }
interface ContextReportBody { origin: XopcTurnClaim; report: ContextReport; }
interface ContextHeartbeatBody { origin: XopcTurnClaim; heartbeat: ContextHeartbeat; }

export class XopcEndpointContextPublisher {
  private timer: number = -1;
  private generation: number = 0;
  private sequence: number = 0;
  private heartbeatSequence: number = 0;
  private nextReport: number = 0;
  private epoch: string = '';
  private running: boolean = false;
  private claim?: XopcTurnClaim;
  constructor(private uuid: () => string) {}
  start(claim: XopcTurnClaim): void {
    this.stop(); this.claim = claim;
    this.timer = setInterval((): void => { this.tick(); }, 15000);
    this.tick();
  }
  stop(): void {
    this.generation++; clearInterval(this.timer); this.timer = -1;
    this.claim = undefined; this.epoch = ''; this.sequence = 0; this.heartbeatSequence = 0;
    this.nextReport = 0; this.running = false;
  }
  private async request(path: string, body?: Object): Promise<ContextAck> {
    const text = body ? await gatewaySession.request(path, 'POST', JSON.stringify(body)) : await gatewaySession.request(path);
    const result = JSON.parse(text) as ContextEnvelope;
    if (!result.ok || !result.payload) throw new Error('CONTEXT_UNAVAILABLE');
    return result.payload;
  }
  private async tick(): Promise<void> {
    if (this.running || !this.claim) return;
    this.running = true;
    const generation = this.generation;
    const claim = this.claim;
    const root = '/api/user-context/environment';
    try {
      if (!this.epoch) {
        const ack = await this.request(root + '/endpoints/' + encodeURIComponent(claim.endpointId));
        if (generation !== this.generation) return;
        this.epoch = ack.connectionEpoch ?? '';
        if (!this.epoch) throw new Error('CONTEXT_UNAVAILABLE');
      }
      const heartbeat: ContextHeartbeatBody = { origin: claim, heartbeat: { connectionEpoch: this.epoch,
        sequence: ++this.heartbeatSequence, availability: layoutState.foreground ? 'foreground' : 'background' } };
      await this.request(root + '/heartbeats', heartbeat);
      if (generation !== this.generation || !layoutState.foreground) return;
      const now = Date.now();
      if (now < this.nextReport) return;
      const report: ContextReportBody = { origin: claim, report: { version: 1, reportId: this.uuid(), connectionEpoch: this.epoch,
        sequence: ++this.sequence, baseRevision: null, mode: 'full', capturedAt: now,
        values: { 'environment.timezone': i18n.getTimeZone().getID(), 'environment.locale': i18n.System.getSystemLocale() } } };
      await this.request(root + '/reports', report);
      if (generation !== this.generation) return;
      this.nextReport = now + 60000;
    } catch {
      if (generation === this.generation) { this.epoch = ''; this.nextReport = 0; }
    } finally { if (generation === this.generation) this.running = false; }
  }
}
