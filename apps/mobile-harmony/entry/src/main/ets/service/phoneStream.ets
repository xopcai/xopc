import { XopcPhonePointerQueue } from '../common/phonePointerQueue';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { webSocket } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import phoneVideo from 'libphonevideo.so';
import { connectionProof } from './requestProof';
import { gatewaySession } from './gatewaySession';
import { XopcPhoneRepository } from '../repository/phoneRepository';
import { XopcPhoneBinding, XopcPhoneLiveState, XopcPhoneVideoGeometry, XopcPhoneVideoMessage } from '../model/phone';

interface XopcPhonePointerMessage {
  type: string; phase: string; seq: number; epoch: number; geometry: number; x: number; y: number;
}
interface XopcPhoneCancelMessage { type: string; epoch: number; }
let activePhoneStream: XopcPhoneStream | undefined;
export class XopcPhoneStream {
  private socket?: webSocket.WebSocket;
  private generation: number = 0;
  private pointerQueue: XopcPhonePointerQueue = new XopcPhonePointerQueue();
  private epoch: number = 0;
  private geometry: number = 0;
  private surface: string = '';
  private stats: number = -1;
  private startedAt: number = 0;
  private lastReceivedAt: number = 0;
  private configured: boolean = false;
  private keySeen: boolean = false;
  private pending: number = 0;
  private sending: Promise<void> = Promise.resolve();
  onPhase: (phase: string) => void = (_phase: string): void => {};
  onGeometry: (width: number, height: number, version: number) => void = (_width: number, _height: number, _version: number): void => {};
  onFault: (code: string) => void = (_code: string): void => {};
  constructor() {
    this.pointerQueue.onSend = (phase: string, x: number, y: number, seq: number): void => {
      const packet: XopcPhonePointerMessage = { type: 'pointer', phase, seq, epoch: this.epoch, geometry: this.geometry, x, y };
      this.send(JSON.stringify(packet));
    };
    this.pointerQueue.onCancel = (): void => {
      if (this.socket && this.epoch) {
        const packet: XopcPhoneCancelMessage = { type: 'cancelPointers', epoch: this.epoch };
        this.send(JSON.stringify(packet));
      }
    };
  }
  setSurface(id: string): void { this.surface = id; }
  async open(repository: XopcPhoneRepository, binding: XopcPhoneBinding, state: XopcPhoneLiveState): Promise<void> {
    this.close();
    const generation = this.generation;
    const revision = gatewaySession.connectionRevision();
    this.epoch = state.ownControl ? state.report.controlEpoch : 0;
    this.onPhase('connecting');
    try {
      if (!this.surface) throw new Error('PHONE_SURFACE_UNAVAILABLE');
      const ticket = await repository.ticket(binding, state);
      if (generation !== this.generation) return;
      const url = gatewaySession.activeOrigin().replace(/^https:/, 'wss:') + ticket.path;
      const proof = await connectionProof(url, ticket.ticket);
      gatewaySession.assertConnection(revision);
      if (generation !== this.generation) return;
      const socket = webSocket.createWebSocket(); this.socket = socket;
      socket.on('message', (_error: BusinessError, data: string | ArrayBuffer): void => {
        if (generation !== this.generation) return;
        try { this.receive(data); } catch (error) { this.fail((error as Error).message); }
      });
      socket.on('close', (_error: BusinessError, result: webSocket.CloseResult): void => {
        if (generation === this.generation) {
          hilog.warn(0x0000, 'XopcPhone', 'Video socket closed: code=%{public}d', result.code);
          this.fail('PHONE_VIDEO_DISCONNECTED');
        }
      });
      socket.on('error', (): void => { if (generation === this.generation) this.fail('PHONE_VIDEO_FAILED'); });
      await socket.connect(url, { header: proof, protocol: 'xopc-phone-v1, ' + ticket.ticket });
      if (generation !== this.generation) return;
      this.startedAt = Date.now(); this.lastReceivedAt = Date.now();
      this.stats = setInterval((): void => {
        if (this.pointerQueue.pendingSince && Date.now() - this.pointerQueue.pendingSince > 5000) { this.fail('PHONE_INPUT_ACK_TIMEOUT'); return; }
        if (Date.now() - this.lastReceivedAt > 12000 || !phoneVideo.frames() && Date.now() - this.startedAt > 8000) {
          this.fail('PHONE_VIDEO_TIMEOUT'); return;
        }
        if (phoneVideo.frames() > 0) this.onPhase('playing');
        this.send(JSON.stringify({ type: 'ping' }));
      }, 1000);
    } catch (error) { if (generation === this.generation) this.fail((error as Error).message); }
  }
  private receive(data: string | ArrayBuffer): void {
    this.lastReceivedAt = Date.now();
    if (typeof data === 'string') {
      const message = JSON.parse(data) as XopcPhoneVideoMessage;
      if (message.type === 'ack' && message.seq) this.pointerQueue.ack(message.seq);
      if (message.type === 'fault') { this.fail(message.code ?? 'PHONE_VIDEO_FAILED'); return; }
      if (message.type === 'geometry') {
        const dimensions = JSON.parse(data) as XopcPhoneVideoGeometry;
        this.cancel(); this.geometry = dimensions.version; this.keySeen = false;
        if (activePhoneStream && activePhoneStream !== this) activePhoneStream.close();
        activePhoneStream = this;
        this.configured = phoneVideo.configure(this.surface, dimensions.width, dimensions.height);
        if (!this.configured) throw new Error('PHONE_VIDEO_DECODER_UNAVAILABLE');
        this.onGeometry(dimensions.width, dimensions.height, dimensions.version);
        this.onPhase('connecting'); this.startedAt = Date.now();
      }
      return;
    }
    if (data.byteLength <= 32 || data.byteLength > 4 * 1024 * 1024 || !this.configured) return;
    const header = new DataView(data);
    if (header.getUint32(4) !== this.geometry) return;
    const flags = header.getUint8(0);
    if (!(flags & 1) && !this.keySeen && !(flags & 2)) return;
    if (flags & 2) this.keySeen = true;
    const pts = header.getUint32(12) * 4294967296 + header.getUint32(16);
    if (!phoneVideo.push(data.slice(32), pts, flags)) throw new Error('PHONE_VIDEO_DECODER_OVERLOADED');
    this.lastReceivedAt = Date.now();
  }
  private send(body: string): void {
    const socket = this.socket;
    const generation = this.generation;
    if (!socket) return;
    if (++this.pending > 64) { this.fail('PHONE_INPUT_CONGESTED'); return; }
    this.sending = this.sending.catch((): void => {}).then(async (): Promise<void> => {
      if (generation !== this.generation) return;
      await socket.send(body); this.pending--;
    }).catch((): void => { if (generation === this.generation) this.fail('PHONE_INPUT_DISCONNECTED'); });
  }
  pointer(phase: string, x: number, y: number): void {
    if (!this.socket || !this.epoch || !this.geometry) return;
    this.pointerQueue.pointer(phase, x, y);
  }
  cancel(): void { this.pointerQueue.cancel(); }
  private fail(code: string): void {
    hilog.warn(0x0000, 'XopcPhone', 'Video stopped: reason=%{public}s', /^[A-Z][A-Z_]{1,79}$/.test(code) ? code : 'PLATFORM_ERROR');
    this.close(); this.onFault(code); this.onPhase('fallback');
  }
  close(): void {
    this.cancel(); this.generation++; clearInterval(this.stats); this.stats = -1;
    const socket = this.socket; this.socket = undefined;
    if (socket) socket.close().catch((): void => {});
    if (activePhoneStream === this) { phoneVideo.stop(); activePhoneStream = undefined; }
    this.epoch = 0; this.geometry = 0; this.pending = 0; this.configured = false; this.keySeen = false;
  }
}
