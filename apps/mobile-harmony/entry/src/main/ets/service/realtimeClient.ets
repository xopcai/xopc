import { cancelDeviceLocation, cancelAllDeviceLocations } from './deviceLocation';
import { i18n } from '@kit.LocalizationKit';
import { XopcEndpointContext } from '../model/sessionCommand';
import { deviceToolCatalog, invokeDeviceTool } from './deviceTools';
import { webSocket } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { XopcDeviceCrypto } from './deviceCrypto';
import { gatewaySession } from './gatewaySession';
import { XopcHttpError } from './transport';
import { xopcAppVersion } from '../common/appInfo';
import { endpointProof, XopcCursors, XOPC_REALTIME_PROTOCOL_VERSION } from '../common/realtimeProtocol';
import {
  XopcEndpointHello, XopcEndpointRegistration, XopcTicketRequest, XopcTicket, XopcPayload,
  XopcHello, XopcFrame, XopcTurnClaim, XopcReady, XopcEvent, XopcGap, XopcRealtimeError,
  XopcSubscriptions, XopcTopics, XopcSubscribed, XopcErrorEnvelope
} from '../model/realtime';

interface XopcDeviceEndpointMessage { type: string; payload: Object; }
interface XopcDeviceCancellation { invocationId: string; }
interface XopcDeviceEndpointFrame { protocolVersion: number; messageId: string; type: string; sentAt: number; payload: Object; }
class XopcEmptyPayload {}
interface XopcDeviceCompatibility { turnDeviceContextV1?: boolean; deviceStateToolsV1?: boolean; deviceLocationTasksV1?: boolean; }

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
  private supportsDeviceContext: boolean = false;

  environment(): XopcEndpointContext | undefined {
    if (!this.supportsDeviceContext || !this.claim) return undefined;
    return { version: 1, capturedAt: Date.now(), timezone: i18n.getTimeZone().getID(), locale: i18n.System.getSystemLocale() };
  }
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
    cancelAllDeviceLocations();
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
    let phase: string = 'profile';
    this.onState('connecting');
    try {
      const profile = gatewaySession.currentProfile();
      if (!profile) throw new Error('NOT_PAIRED');
      const registration: XopcEndpointRegistration = {
        principalId: profile.deviceId, displayName: 'xopc HarmonyOS', kind: 'mobile', platform: 'harmonyos',
        publicKey: await this.crypto.publicKeyDer()
      };
      phase = 'compatibility';
      const compatibility = JSON.parse(await gatewaySession.request('/api/endpoint-tools/compatibility')) as XopcPayload<XopcDeviceCompatibility>;
      this.supportsDeviceContext = compatibility.payload?.turnDeviceContextV1 === true;
      phase = 'register';
      await gatewaySession.request('/api/endpoint-tools/principals', 'POST', JSON.stringify(registration));
      const clientId = 'harmonyos:' + profile.deviceId;
      const ticketRequest: XopcTicketRequest = {
        clientId,
        clientKind: 'mobile',
        protocolVersion: XOPC_REALTIME_PROTOCOL_VERSION
      };
      phase = 'ticket';
      const response = JSON.parse(await gatewaySession.request('/api/realtime/tickets', 'POST', JSON.stringify(ticketRequest))) as XopcPayload<XopcTicket>;
      if (!response.payload?.ticket || !response.payload.realtime) throw new Error('INVALID_REALTIME_TICKET');
      if (XOPC_REALTIME_PROTOCOL_VERSION < response.payload.realtime.minVersion) {
        this.fail('client_update_required');
        return;
      }
      if (XOPC_REALTIME_PROTOCOL_VERSION > response.payload.realtime.maxVersion) {
        this.fail('gateway_update_required');
        return;
      }
      const endpoint: XopcEndpointHello = {
        principalId: profile.deviceId, endpointId: clientId, connectionInstanceId: this.crypto.uuid(),
        displayName: registration.displayName, kind: 'mobile', platform: 'harmonyos', appVersion: xopcAppVersion(),
        availability: 'foreground', nonce: this.crypto.uuid(), signedAt: Date.now(), signature: '', tools: compatibility.payload?.deviceStateToolsV1 === true ? deviceToolCatalog(compatibility.payload?.deviceLocationTasksV1 === true) : []
      };
      phase = 'sign';
      endpoint.signature = await this.crypto.sign(endpointProof(endpoint));
      if (generation !== this.generation || this.stopped) return;
      const origin = gatewaySession.activeOrigin();
      phase = 'verify-route';
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
        if (typeof value !== 'string' || value.length > 4 * 1024 * 1024) {
          hilog.warn(0x0000, 'XopcRealtime', 'Rejected frame: type=%{public}s', typeof value);
          this.retry(generation); return;
        }
        try { this.receive(value); } catch (error) {
          const message = (error as Error).message;
          const reason = ['INVALID_REALTIME_FRAME', 'INVALID_EVENT', 'MISSING_ENDPOINT_CLAIM'].includes(message) ? message : 'CALLBACK_OR_JSON';
          hilog.warn(0x0000, 'XopcRealtime', 'Frame processing failed: %{public}s', reason); this.retry(generation);
        }
      });
      socket.on('close', (_error: BusinessError, value: webSocket.CloseResult): void => {
        if (generation !== this.generation) return;
        hilog.info(0x0000, 'XopcRealtime', 'Socket closed: %{public}d', value.code);
        if (value.code === 4409 || value.code === 4403) {
          this.fail(value.code === 4409 ? 'gateway_update_required' : 'unauthorized');
        }
        else this.retry(generation);
      });
      socket.on('error', (error: BusinessError): void => {
        hilog.warn(0x0000, 'XopcRealtime', 'Socket failed: %{public}d', error.code); this.retry(generation);
      });
      this.lastReceived = Date.now();
      this.heartbeatTimer = setInterval((): void => {
        if (Date.now() - this.lastReceived > 45000 || (!this.ready && Date.now() - this.lastReceived > 10000)) this.retry(generation);
        else if (this.ready) this.send('realtime.ping', new XopcEmptyPayload());
      }, 5000);
      phase = 'socket';
      await socket.connect(origin.replace(/^https:/, 'wss:') + '/api/realtime/v1/ws');
    } catch (error) {
      if (generation !== this.generation) return;
      const reason = (error as Error).message ?? '';
      const safeReason = /^[A-Z][A-Z_]{1,79}$/.test(reason) ? reason : 'PLATFORM_ERROR';
      hilog.warn(0x0000, 'XopcRealtime', 'Connection setup failed: phase=%{public}s HTTP=%{public}d reason=%{public}s code=%{public}d', phase, error instanceof XopcHttpError ? error.status : 0, safeReason, (error as BusinessError).code ?? 0);
      if ((error instanceof XopcHttpError && (error.status === 401 || error.status === 403))
        || (error as Error).message === 'DEVICE_AUTH_DENIED') this.fail('unauthorized');
      else if (error instanceof XopcHttpError && error.status === 426) {
        this.fail(this.compatibilityState(error.body));
      }
      else this.retry(generation);
    }
  }

  private fail(state: string): void { this.stop(); this.onState(state); }

  private send(kind: string, payload: Object): void {
    if (!this.socket) return;
    if (kind.startsWith('tool.')) {
      const inner: XopcDeviceEndpointFrame = { protocolVersion: 2, messageId: this.crypto.uuid(), type: kind, sentAt: Date.now(), payload };
      this.send('endpoint.message', inner); return;
    }
    const generation = this.generation;
    const frame: XopcFrame<Object> = { protocolVersion: XOPC_REALTIME_PROTOCOL_VERSION, messageId: this.crypto.uuid(), kind, sentAt: Date.now(), payload };
    this.socket.send(JSON.stringify(frame)).catch((_error: Error): void => { this.retry(generation); });
  }

  private receive(raw: string): void {
    const frame = JSON.parse(raw) as XopcFrame<Object>;
    if (frame.protocolVersion !== XOPC_REALTIME_PROTOCOL_VERSION || !frame.payload) throw new Error('INVALID_REALTIME_FRAME');
    this.lastReceived = Date.now();
    if (frame.kind === 'realtime.ready') {
      const payload = frame.payload as XopcReady;
      if (!payload.endpoint?.turnToken || !payload.endpoint.endpointId) throw new Error('MISSING_ENDPOINT_CLAIM');
      this.claim = { type: 'endpoint', endpointId: payload.endpoint.endpointId, token: payload.endpoint.turnToken };
      this.ready = true; this.attempt = 0;
      this.onState('connected');
    } else if (frame.kind === 'endpoint.message') {
      const inner = frame.payload as XopcDeviceEndpointMessage;
      if (inner.type === 'tool.invoke') invokeDeviceTool(inner.payload, (kind: string, body: Object): void => { this.send(kind, body); });
      else if (inner.type === 'tool.cancel') cancelDeviceLocation((inner.payload as XopcDeviceCancellation).invocationId);
    } else if (frame.kind === 'realtime.event') {
      const event = frame.payload as XopcEvent;
      if (typeof event.topic !== 'string' || typeof event.event !== 'string') throw new Error('INVALID_EVENT');
      // Gateway invalidations may have a null payload. Advance their cursor without disconnecting.
      if (this.cursors.accept(event.topic, event.seq) && event.data !== null && event.data !== undefined) this.onEvent(event);
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

  private compatibilityState(body: string): string {
    try {
      const envelope = JSON.parse(body) as XopcErrorEnvelope;
      if (envelope.error?.code === 'CLIENT_UPDATE_REQUIRED') return 'client_update_required';
      if (envelope.error?.code === 'GATEWAY_UPDATE_REQUIRED') return 'gateway_update_required';
    } catch (_) {}
    return 'gateway_update_required';
  }
}

export const realtimeClient: XopcRealtimeClient = new XopcRealtimeClient();
