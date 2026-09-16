import { webSocket } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { XopcDeviceCrypto } from './deviceCrypto';
import { gatewaySession } from './gatewaySession';
import { XopcHttpError } from './transport';
import { endpointProof, XopcCursors } from '../common/realtimeProtocol';
import {
  XopcEndpointHello, XopcEndpointRegistration, XopcTicketRequest, XopcTicket, XopcPayload,
  XopcHello, XopcFrame, XopcTurnClaim, XopcReady, XopcEvent, XopcGap, XopcRealtimeError,
  XopcSubscriptions, XopcTopics, XopcSubscribed
} from '../model/realtime';

class XopcEmptyPayload {}

export class XopcRealtimeClient {
  private crypto: XopcDeviceCrypto = new XopcDeviceCrypto('endpoint-key');
  private socket?: webSocket.WebSocket;
  private generation: number = 0;
  private stopped: boolean = true;
  private ready: boolean = false;
  private reconnectTimer: number = -1;
  private heartbeatTimer: number = -1;
  private attempt: number = 0;
  private lastReceived: number = 0;
  private claim?: XopcTurnClaim;
  private cursors: XopcCursors = new XopcCursors();
  onState: (state: string) => void = (_state: string): void => {};
  onEvent: (event: XopcEvent) => void = (_event: XopcEvent): void => {};
  onGap: (topic: string) => void = (_topic: string): void => {};

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    clearTimeout(this.reconnectTimer); this.reconnectTimer = -1;
    this.release();
    this.onState('offline');
  }

  reset(): void { this.stop(); this.cursors.clear(); }

  async forgetIdentity(): Promise<void> { this.reset(); await this.crypto.clearKey(); }

  turnClaim(): XopcTurnClaim {
    if (!this.ready || !this.claim) throw new Error('REALTIME_NOT_READY');
    return this.claim;
  }

  subscribe(topic: string): void {
    if (this.cursors.has(topic)) return;
    this.cursors.add(topic);
    if (this.ready) {
      const payload: XopcSubscriptions = { subscriptions: this.cursors.snapshot().filter((s): boolean => s.topic === topic) };
      this.send('realtime.subscribe', payload);
    }
  }

  unsubscribe(topic: string): void {
    this.cursors.remove(topic);
    const payload: XopcTopics = { topics: [topic] };
    if (this.ready) this.send('realtime.unsubscribe', payload);
  }

  private release(): void {
    this.ready = false; this.claim = undefined;
    clearInterval(this.heartbeatTimer); this.heartbeatTimer = -1;
    const old = this.socket; this.socket = undefined;
    if (old) {
      old.off('open'); old.off('message'); old.off('close'); old.off('error');
      old.close().catch((_error: Error): void => {});
    }
  }

  private retry(generation: number): void {
    if (generation !== this.generation || this.stopped || this.reconnectTimer !== -1) return;
    this.generation++;
    this.release();
    this.onState('reconnecting');
    const delay = Math.min(30000, 1000 * Math.pow(2, this.attempt++)) * (0.75 + Math.random() * 0.5);
    this.reconnectTimer = setTimeout((): void => { this.reconnectTimer = -1; this.connect(); }, delay);
  }

  private async connect(): Promise<void> {
    const generation = ++this.generation;
    this.onState('connecting');
    try {
      const profile = gatewaySession.currentProfile();
      if (!profile) throw new Error('NOT_PAIRED');
      const registration: XopcEndpointRegistration = {
        principalId: profile.deviceId, displayName: 'xopc HarmonyOS', kind: 'mobile', platform: 'harmonyos',
        publicKey: await this.crypto.publicKeyDer()
      };
      await gatewaySession.request('/api/endpoint-tools/principals', 'POST', JSON.stringify(registration));
      const clientId = 'harmonyos:' + profile.deviceId;
      const ticketRequest: XopcTicketRequest = { clientId, clientKind: 'mobile' };
      const response = JSON.parse(await gatewaySession.request('/api/realtime/tickets', 'POST', JSON.stringify(ticketRequest))) as XopcPayload<XopcTicket>;
      if (!response.payload?.ticket) throw new Error('INVALID_REALTIME_TICKET');
      const endpoint: XopcEndpointHello = {
        principalId: profile.deviceId, endpointId: clientId, connectionInstanceId: this.crypto.uuid(),
        displayName: registration.displayName, kind: 'mobile', platform: 'harmonyos', appVersion: '0.1.0',
        availability: 'foreground', nonce: this.crypto.uuid(), signedAt: Date.now(), signature: '', tools: []
      };
      endpoint.signature = await this.crypto.sign(endpointProof(endpoint));
      if (generation !== this.generation || this.stopped) return;
      const origin = gatewaySession.activeOrigin();
      await gatewaySession.verifyRoute(profile, origin);
      if (generation !== this.generation || this.stopped) return;
      const socket = webSocket.createWebSocket(); this.socket = socket;
      socket.on('open', (_error: BusinessError, _value: Object): void => {
        if (generation !== this.generation) return;
        const hello: XopcHello = { ticket: response.payload.ticket, clientId, clientKind: 'mobile', subscriptions: this.cursors.snapshot(), endpoint };
        this.send('realtime.hello', hello);
      });
      socket.on('message', (_error: BusinessError, value: string | ArrayBuffer): void => {
        if (generation !== this.generation) return;
        if (typeof value !== 'string' || value.length > 4 * 1024 * 1024) { this.retry(generation); return; }
        try { this.receive(value); } catch (_) { this.retry(generation); }
      });
      socket.on('close', (_error: BusinessError, value: webSocket.CloseResult): void => {
        if (generation !== this.generation) return;
        if (value.code === 4409 || value.code === 4403) this.fail(value.code === 4409 ? 'protocol_incompatible' : 'unauthorized');
        else this.retry(generation);
      });
      socket.on('error', (_error: BusinessError): void => { this.retry(generation); });
      this.lastReceived = Date.now();
      this.heartbeatTimer = setInterval((): void => {
        if (Date.now() - this.lastReceived > 45000 || (!this.ready && Date.now() - this.lastReceived > 10000)) this.retry(generation);
        else if (this.ready) this.send('realtime.ping', new XopcEmptyPayload());
      }, 5000);
      await socket.connect(origin.replace(/^https:/, 'wss:') + '/api/realtime/v1/ws');
    } catch (error) {
      if (generation !== this.generation) return;
      if ((error instanceof XopcHttpError && (error.status === 401 || error.status === 403))
        || (error as Error).message === 'DEVICE_AUTH_DENIED') this.fail('unauthorized');
      else this.retry(generation);
    }
  }

  private fail(state: string): void { this.stop(); this.onState(state); }

  private send(kind: string, payload: Object): void {
    if (!this.socket) return;
    const generation = this.generation;
    const frame: XopcFrame<Object> = { protocolVersion: 2, messageId: this.crypto.uuid(), kind, sentAt: Date.now(), payload };
    this.socket.send(JSON.stringify(frame)).catch((_error: Error): void => { this.retry(generation); });
  }

  private receive(raw: string): void {
    const frame = JSON.parse(raw) as XopcFrame<Object>;
    if (frame.protocolVersion !== 2 || !frame.payload) throw new Error('INVALID_REALTIME_FRAME');
    this.lastReceived = Date.now();
    if (frame.kind === 'realtime.ready') {
      const payload = frame.payload as XopcReady;
      if (!payload.endpoint?.turnToken || !payload.endpoint.endpointId) throw new Error('MISSING_ENDPOINT_CLAIM');
      this.claim = { type: 'endpoint', endpointId: payload.endpoint.endpointId, token: payload.endpoint.turnToken };
      this.ready = true; this.attempt = 0;
      this.onState('connected');
    } else if (frame.kind === 'realtime.event') {
      const event = frame.payload as XopcEvent;
      if (typeof event.topic !== 'string' || typeof event.event !== 'string' || !event.data) throw new Error('INVALID_EVENT');
      if (this.cursors.accept(event.topic, event.seq)) this.onEvent(event);
    } else if (frame.kind === 'realtime.subscribed') {
      const subscribed = frame.payload as XopcSubscribed;
      this.cursors.rebase(subscribed.topic, subscribed.cursor);
    } else if (frame.kind === 'realtime.gap') {
      // Snapshot recovery belongs to the repository; never append partial replay onto stale state.
      const gap = frame.payload as XopcGap;
      if (!this.cursors.has(gap.topic)) return;
      this.cursors.rebase(gap.topic, gap.earliestSeq - 1);
      if (!gap.recoverable) {
        // A lost run buffer cannot be replayed. Subscribe live while the view reloads persisted history.
        const subscriptions: XopcSubscriptions = { subscriptions: [{ topic: gap.topic }] };
        this.send('realtime.subscribe', subscriptions);
      }
      this.onGap(gap.topic);
    } else if (frame.kind === 'realtime.error') {
      this.fail('error:' + (frame.payload as XopcRealtimeError).code);
    }
  }
}

export const realtimeClient: XopcRealtimeClient = new XopcRealtimeClient();
