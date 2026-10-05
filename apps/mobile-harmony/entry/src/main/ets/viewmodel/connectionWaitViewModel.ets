import { XopcConnectionAction, XopcConnectionActionRequest, XopcConnectionNeed, XopcConnectionWaitSnapshot, XopcConnectionWaitActionResult } from '../model/connectionWait';
import { XopcPayload } from '../model/realtime';
import { XopcDeviceCrypto } from '../service/deviceCrypto';
import { gatewaySession } from '../service/gatewaySession';
import { localSessionStore } from '../service/localSessionStore';
import { XopcHttpError } from '../service/transport';

@ObservedV2
export class XopcConnectionWaitViewModel {
  @Trace snapshot?: XopcConnectionWaitSnapshot;
  @Trace busy: boolean = false;
  @Trace error: string = '';
  private conversationId: string = '';
  private gatewayId: string = '';
  private generation: number = 0;
  private request: number = 0;
  private timer: number = -1;
  private active: boolean = false;
  private refreshing: boolean = false;
  private refreshPending: boolean = false;
  private crypto: XopcDeviceCrypto = new XopcDeviceCrypto();

  start(id: string): void {
    const gatewayId = gatewaySession.currentProfile()?.gatewayId ?? '';
    if (id === this.conversationId && gatewayId === this.gatewayId) { this.resume(); return; }
    this.pause(); this.generation++; this.conversationId = id; this.gatewayId = gatewayId;
    this.snapshot = undefined; this.busy = false; this.error = '';
    this.resume();
  }

  pause(): void { this.active = false; this.request++; clearInterval(this.timer); this.timer = -1; }
  resume(): void {
    if (!this.conversationId || this.active) return;
    this.active = true; void this.refresh(); this.updateTimer();
  }
  onReturn(): void {
    this.resume();
    if (this.snapshot?.wait?.needs.some((need: XopcConnectionNeed): boolean => need.phase === 'authorizing')) void this.act('check');
  }
  dispose(): void { this.pause(); this.generation++; this.conversationId = ''; this.snapshot = undefined; }

  private updateTimer(): void {
    const shouldPoll = this.active && !!this.snapshot?.wait;
    if (shouldPoll && this.timer === -1) this.timer = setInterval((): void => { void this.refresh(); }, 5000);
    else if (!shouldPoll && this.timer !== -1) { clearInterval(this.timer); this.timer = -1; }
  }

  private apply(next: XopcConnectionWaitSnapshot): void {
    const current = this.snapshot;
    if (current?.transcriptId === next.transcriptId && current.wait && next.wait && current.wait.id === next.wait.id
      && current.wait.version > next.wait.version) return;
    if (current?.transcriptId === next.transcriptId && next.revision < current.revision) return;
    this.snapshot = next;
    this.error = '';
    this.updateTimer();
  }

  async refresh(): Promise<void> {
    if (!this.active || !this.conversationId) return;
    if (this.gatewayId !== (gatewaySession.currentProfile()?.gatewayId ?? '')) {
      this.start(this.conversationId);
      return;
    }
    if (this.refreshing) { this.refreshPending = true; return; }
    this.refreshing = true;
    const id = this.conversationId;
    const gatewayId = this.gatewayId;
    const generation = this.generation;
    const request = ++this.request;
    try {
      if (await localSessionStore.read(id)) return;
      const raw = await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/connection-wait');
      const payload = (JSON.parse(raw) as XopcPayload<XopcConnectionWaitSnapshot>).payload;
      if (!payload || !payload.transcriptId || (payload.wait && payload.wait.conversationId !== id)) throw new Error('INVALID_CONNECTION_WAIT');
      if (generation === this.generation && request === this.request && this.active && gatewayId === gatewaySession.currentProfile()?.gatewayId) this.apply(payload);
    } catch (error) {
      if (generation === this.generation && request === this.request && this.active) {
        if (error instanceof XopcHttpError && error.status === 404) { this.snapshot = undefined; this.updateTimer(); }
        else this.error = (error as Error).message;
      }
    } finally {
      this.refreshing = false;
      if (this.refreshPending) { this.refreshPending = false; if (this.active) void this.refresh(); }
    }
  }

  async act(action: XopcConnectionAction, needKey?: string, accountId?: string): Promise<string> {
    const snapshot = this.snapshot;
    const wait = snapshot?.wait;
    if (!wait || this.busy || !this.active) return '';
    const generation = this.generation;
    const id = this.conversationId;
    const gatewayId = this.gatewayId;
    this.busy = true; this.error = ''; this.request++;
    try {
      const body: XopcConnectionActionRequest = { action, needKey, accountId, waitId: wait.id, expectedTranscriptId: snapshot.transcriptId,
        expectedVersion: wait.version, idempotencyKey: this.crypto.uuid() };
      const raw = await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/connection-wait/actions', 'POST', JSON.stringify(body));
      const payload = (JSON.parse(raw) as XopcPayload<XopcConnectionWaitActionResult>).payload;
      if (!payload?.snapshot) throw new Error('INVALID_CONNECTION_ACTION');
      if (generation === this.generation && id === this.conversationId && gatewayId === gatewaySession.currentProfile()?.gatewayId) {
        this.apply(payload.snapshot);
        return payload.authorizationUrl ?? '';
      }
    } catch (error) {
      if (generation === this.generation) {
        if (error instanceof XopcHttpError && error.status === 409) void this.refresh();
        else this.error = (error as Error).message;
      }
    } finally { if (generation === this.generation) this.busy = false; }
    return '';
  }
}
