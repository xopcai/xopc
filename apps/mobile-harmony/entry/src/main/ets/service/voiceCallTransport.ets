import { webSocket } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { systemDateTime } from '@kit.BasicServicesKit';
import { XopcVoiceAudioFrame, XopcVoiceClientPayload, XopcVoiceServerEvent, XopcVoiceSession } from '../model/voice';
import {
  XOPC_VOICE_PROTOCOL_VERSION, XOPC_VOICE_PROXY_WS_PATH, xopcDecodeVoiceAudio, xopcEncodeVoiceUplink,
  xopcParseVoiceEvent, xopcVoiceClientMessage, xopcVoiceUuid
} from '../common/voiceProtocol';

export interface XopcVoiceSendResult {
  accepted: boolean;
  quality: string;
  queueAgeMs: number;
}

export interface XopcVoiceTransportCallbacks {
  onEvent: (event: XopcVoiceServerEvent) => void;
  onAudio: (frame: XopcVoiceAudioFrame) => void;
  onClose: (reason: string) => void;
  onRtt: (milliseconds: number) => void;
}

export class XopcVoiceCallTransport {
  private callbacks: XopcVoiceTransportCallbacks;
  private socket?: webSocket.WebSocket;
  private session?: XopcVoiceSession;
  private generation: number = 0;
  private ready: boolean = false;
  private closed: boolean = true;
  private eventSeq: number = 0;
  private audioSeq: number = 0;
  private inputSeq: number = 0;
  private inputStarted: boolean = false;
  private utteranceId: string = '';
  private remainder: Uint8Array = new Uint8Array(0);
  private pendingBytes: number = 0;
  private heartbeatTimer: number = -1;
  private lastPong: number = 0;
  private lastPing: number = 0;

  constructor(callbacks: XopcVoiceTransportCallbacks) { this.callbacks = callbacks; }

  async connect(origin: string, session: XopcVoiceSession): Promise<void> {
    if (!origin.startsWith('https://') || session.protocolVersion !== XOPC_VOICE_PROTOCOL_VERSION
      || session.inputFormat.sampleRate !== 16000 || session.websocketPath !== '/api/voice/realtime/v3/ws') throw new Error('SECURE_ROUTE_REQUIRED');
    await this.close();
    const generation = ++this.generation;
    this.closed = false; this.ready = false; this.session = session; this.eventSeq = 0; this.audioSeq = 0;
    this.rotateUtterance(); this.lastPong = Date.now();
    const direct = origin.replace(/^https:/, 'wss:') + session.websocketPath;
    const proxy = origin.replace(/^https:/, 'wss:') + XOPC_VOICE_PROXY_WS_PATH;
    try { await this.open(direct, generation); }
    catch (_) {
      if (generation !== this.generation || this.closed) throw new Error('CANCELLED');
      await this.releaseSocket(); await this.open(proxy, generation);
    }
  }

  private open(url: string, generation: number): Promise<void> {
    return new Promise<void>((resolve, reject): void => {
      const socket = webSocket.createWebSocket(); this.socket = socket;
      let settled = false;
      const timeout = setTimeout((): void => { if (!settled) { settled = true; reject(new Error('CONNECT_TIMEOUT')); } }, 15000);
      socket.on('open', (_error: BusinessError, _value: Object): void => {
        if (generation !== this.generation || !this.session) return;
        this.send('session.start', { sessionId: this.session.sessionId, ticket: this.session.ticket });
      });
      socket.on('message', (_error: BusinessError, value: string | ArrayBuffer): void => {
        if (generation !== this.generation) return;
        try {
          if (typeof value === 'string') {
            const event = xopcParseVoiceEvent(value); this.receiveEvent(event);
            if (event.type === 'session.ready' && !settled) {
              settled = true; clearTimeout(timeout); this.ready = true; this.startHeartbeat(generation, event.payload.heartbeatIntervalMs ?? 15000); resolve();
            }
          } else {
            if (!this.ready) throw new Error('PROTOCOL_ERROR');
            const frame = xopcDecodeVoiceAudio(value); this.receiveAudio(frame);
          }
        } catch (_) {
          if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('PROTOCOL_ERROR')); }
          else this.fail('PROTOCOL_ERROR', generation);
        }
      });
      socket.on('close', (_error: BusinessError, _value: webSocket.CloseResult): void => {
        if (generation !== this.generation) return;
        if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('NETWORK')); }
        else if (!this.closed) this.fail('NETWORK', generation);
      });
      socket.on('error', (_error: BusinessError): void => {
        if (generation !== this.generation) return;
        if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('NETWORK')); }
        else this.fail('NETWORK', generation);
      });
      socket.connect(url).catch((_error: Error): void => {
        if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('NETWORK')); }
      });
    });
  }

  private receiveEvent(event: XopcVoiceServerEvent): void {
    const session = this.session;
    if (!session || event.sessionId !== session.sessionId || event.seq !== this.eventSeq + 1) throw new Error('PROTOCOL_ERROR');
    this.eventSeq = event.seq;
    if (event.type === 'session.ready') {
      if (this.ready || event.payload.connectionEpoch !== session.connectionEpoch || event.payload.route?.engine !== session.route.engine) throw new Error('PROTOCOL_ERROR');
    } else if (event.type === 'session.pong') {
      this.lastPong = Date.now(); if (this.lastPing) this.callbacks.onRtt(this.lastPong - this.lastPing);
    }
    this.callbacks.onEvent(event);
    if (event.type === 'session.error' && !event.payload.recoverable) this.fail(event.payload.code ?? 'SERVICE_UNAVAILABLE', this.generation);
    else if (event.type === 'session.closed') this.fail(event.payload.reason ?? 'ended', this.generation);
  }

  private receiveAudio(frame: XopcVoiceAudioFrame): void {
    const session = this.session;
    if (!session || frame.connectionEpoch !== session.connectionEpoch || frame.seq !== this.audioSeq + 1) throw new Error('PROTOCOL_ERROR');
    this.audioSeq = frame.seq; this.callbacks.onAudio(frame);
  }

  send(type: string, payload: XopcVoiceClientPayload): void {
    if (!this.socket || this.closed) return;
    this.socket.send(xopcVoiceClientMessage(type, payload)).catch((_error: Error): void => { this.fail('NETWORK', this.generation); });
    if (type === 'input.mute' && payload.muted === false) this.rotateUtterance();
  }

  audio(bytes: Uint8Array): XopcVoiceSendResult {
    const session = this.session;
    if (!this.socket || !this.ready || this.closed || !session) return { accepted: false, quality: 'critical', queueAgeMs: Number.POSITIVE_INFINITY };
    const before = this.pendingBytes / 32;
    if (before >= 300) return { accepted: false, quality: 'critical', queueAgeMs: before };
    const pending = new Uint8Array(this.remainder.byteLength + bytes.byteLength);
    pending.set(this.remainder); pending.set(bytes, this.remainder.byteLength);
    let offset = 0;
    while (offset + 640 <= pending.byteLength) {
      const audio = pending.slice(offset, offset + 640); offset += 640;
      const data = xopcEncodeVoiceUplink({ connectionEpoch: session.connectionEpoch, utteranceId: this.utteranceId,
        audioSeq: ++this.inputSeq, capturedAtMonotonicMs: systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false),
        start: !this.inputStarted, end: false, audio });
      this.inputStarted = true; this.pendingBytes += data.byteLength;
      this.socket.send(data).then((_sent: boolean): void => { this.pendingBytes = Math.max(0, this.pendingBytes - data.byteLength); })
        .catch((_error: Error): void => { this.pendingBytes = Math.max(0, this.pendingBytes - data.byteLength); this.fail('NETWORK', this.generation); });
    }
    this.remainder = pending.slice(offset);
    const queueAgeMs = this.pendingBytes / 32;
    return { accepted: true, quality: queueAgeMs >= 300 ? 'critical' : queueAgeMs >= 120 ? 'degraded' : 'good', queueAgeMs };
  }

  inputQueueAgeMs(): number { return this.pendingBytes / 32; }

  private rotateUtterance(): void {
    this.utteranceId = xopcVoiceUuid(); this.inputSeq = 0; this.inputStarted = false; this.remainder = new Uint8Array(0);
  }

  private startHeartbeat(generation: number, interval: number): void {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval((): void => {
      if (generation !== this.generation || this.closed) return;
      if (Date.now() - this.lastPong > 35000) this.fail('NETWORK', generation);
      else { this.lastPing = Date.now(); this.send('session.ping', {}); }
    }, interval);
  }

  private fail(reason: string, generation: number): void {
    if (generation !== this.generation || this.closed) return;
    this.closed = true; this.ready = false; clearInterval(this.heartbeatTimer); this.heartbeatTimer = -1;
    this.releaseSocket(); this.callbacks.onClose(reason);
  }

  private async releaseSocket(): Promise<void> {
    const socket = this.socket; this.socket = undefined;
    if (!socket) return;
    socket.off('open'); socket.off('message'); socket.off('close'); socket.off('error');
    try { await socket.close(); } catch (_) {}
  }

  async close(): Promise<void> {
    ++this.generation; this.closed = true; this.ready = false; this.session = undefined;
    clearInterval(this.heartbeatTimer); this.heartbeatTimer = -1; this.pendingBytes = 0; await this.releaseSocket();
  }
}
