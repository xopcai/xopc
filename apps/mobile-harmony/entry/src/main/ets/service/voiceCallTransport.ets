import { webSocket } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { systemDateTime } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
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

interface XopcVoiceQueuedInput {
  queuedAtMs: number;
  audioBytes: number;
  wireBytes: number;
  inFlight: boolean;
}

export interface XopcVoiceInputDiagnostics {
  queuedAudioMs: number;
  queuedWireBytes: number;
  oldestWaitMs: number;
  peakWaitMs: number;
  droppedAudioMs: number;
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
  private inputMuted: boolean = true;
  private utteranceId: string = '';
  private remainder: Uint8Array = new Uint8Array(0);
  private pendingBytes: number = 0;
  private pendingWireBytes: number = 0;
  private pendingFrames: XopcVoiceQueuedInput[] = [];
  private inputGeneration: number = 0;
  private remainderCapturedAtMs: number = 0;
  private peakWaitMs: number = 0;
  private droppedBytes: number = 0;
  private audioSendQueue: Promise<void> = Promise.resolve();
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
    this.inputMuted = true; this.rotateUtterance(); this.lastPong = Date.now();
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
        } catch (error) {
          hilog.warn(0x0000, 'XopcVoice', 'Voice frame rejected: %{public}s', (error as Error).message || 'PROTOCOL_ERROR');
          if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('PROTOCOL_ERROR')); }
          else this.fail('PROTOCOL_ERROR', generation);
        }
      });
      socket.on('close', (_error: BusinessError, value: webSocket.CloseResult): void => {
        if (generation !== this.generation) return;
        hilog.info(0x0000, 'XopcVoice', 'Voice socket closed: %{public}d', value.code);
        if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('NETWORK')); }
        else if (!this.closed) this.fail('NETWORK', generation);
      });
      socket.on('error', (error: BusinessError): void => {
        if (generation !== this.generation) return;
        hilog.warn(0x0000, 'XopcVoice', 'Voice socket failed: %{public}d', error.code);
        if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('NETWORK')); }
        else this.fail('NETWORK', generation);
      });
      socket.connect(url).catch((error: Error): void => {
        hilog.warn(0x0000, 'XopcVoice', 'Voice connection failed: %{public}s', error.message || 'NETWORK');
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
    if (event.type === 'session.error' && !event.payload.recoverable) {
      const code = event.payload.code ?? 'SERVICE_UNAVAILABLE';
      hilog.warn(0x0000, 'XopcVoice', 'Voice session failed: %{public}s', code);
      this.fail(code, this.generation);
    } else if (event.type === 'session.closed') {
      const reason = event.payload.reason ?? 'ended';
      hilog.info(0x0000, 'XopcVoice', 'Voice session ended: %{public}s', reason);
      this.fail(reason, this.generation);
    }
  }

  private receiveAudio(frame: XopcVoiceAudioFrame): void {
    const session = this.session;
    if (!session || frame.connectionEpoch !== session.connectionEpoch || frame.seq !== this.audioSeq + 1) throw new Error('PROTOCOL_ERROR');
    this.audioSeq = frame.seq; this.callbacks.onAudio(frame);
  }

  send(type: string, payload: XopcVoiceClientPayload): void {
    if (!this.socket || this.closed) return;
    const generation = this.generation;
    this.socket.send(xopcVoiceClientMessage(type, payload)).catch((_error: Error): void => { this.fail('NETWORK', generation); });
    if (type === 'input.mute' && typeof payload.muted === 'boolean') {
      if (!this.inputMuted && payload.muted) this.discardQueuedInput();
      if (this.inputMuted && !payload.muted) this.rotateUtterance();
      this.inputMuted = payload.muted;
    }
  }

  audio(bytes: Uint8Array, capturedAtMs?: number): XopcVoiceSendResult {
    const session = this.session;
    if (!this.socket || !this.ready || this.closed || !session) return { accepted: false, quality: 'critical', queueAgeMs: Number.POSITIVE_INFINITY };
    if (this.inputMuted) return { accepted: false, quality: 'good', queueAgeMs: this.inputQueueAgeMs() };
    const now = systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false);
    const before = this.inputQueueAgeMs();
    if (before >= 300 || this.pendingBytes + this.remainder.byteLength + bytes.byteLength > 9600) {
      this.droppedBytes += bytes.byteLength;
      return { accepted: false, quality: 'critical', queueAgeMs: before };
    }
    const firstSampleAt = this.remainder.byteLength ? this.remainderCapturedAtMs
      : capturedAtMs ?? Math.max(0, now - bytes.byteLength / 32);
    const pending = new Uint8Array(this.remainder.byteLength + bytes.byteLength);
    pending.set(this.remainder); pending.set(bytes, this.remainder.byteLength);
    let offset = 0;
    while (offset + 640 <= pending.byteLength) {
      const audio = pending.slice(offset, offset + 640); offset += 640;
      const data = xopcEncodeVoiceUplink({ connectionEpoch: session.connectionEpoch, utteranceId: this.utteranceId,
        audioSeq: ++this.inputSeq, capturedAtMonotonicMs: firstSampleAt + (offset - 640) / 32,
        start: !this.inputStarted, end: false, audio });
      this.inputStarted = true; this.pendingBytes += audio.byteLength; this.pendingWireBytes += data.byteLength;
      const queued: XopcVoiceQueuedInput = { queuedAtMs: now, audioBytes: audio.byteLength,
        wireBytes: data.byteLength, inFlight: false };
      this.pendingFrames.push(queued);
      const socket = this.socket; const generation = this.generation;
      const inputGeneration = this.inputGeneration;
      this.audioSendQueue = this.audioSendQueue.then(async (): Promise<void> => {
        if (generation !== this.generation || inputGeneration !== this.inputGeneration || this.closed || this.socket !== socket) {
          return;
        }
        if (this.inputQueueAgeMs() >= 300) { this.discardQueuedInput(); this.fail('INPUT_DROPPED', generation); return; }
        queued.inFlight = true;
        try { await socket.send(data); }
        catch (_error) { this.fail('NETWORK', generation); }
        finally {
          if (generation === this.generation) {
            const index = this.pendingFrames.indexOf(queued);
            if (index >= 0) {
              this.pendingFrames.splice(index, 1);
              this.pendingBytes -= queued.audioBytes; this.pendingWireBytes -= queued.wireBytes;
            }
          }
        }
      });
    }
    this.remainder = pending.slice(offset);
    this.remainderCapturedAtMs = firstSampleAt + offset / 32;
    const queueAgeMs = this.inputQueueAgeMs();
    return { accepted: true, quality: queueAgeMs >= 300 ? 'critical' : queueAgeMs >= 120 ? 'degraded' : 'good', queueAgeMs };
  }

  inputQueueAgeMs(): number {
    const first = this.pendingFrames[0];
    const age = first ? Math.max(0, systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false) - first.queuedAtMs) : 0;
    this.peakWaitMs = Math.max(this.peakWaitMs, age);
    return age;
  }

  inputDiagnostics(): XopcVoiceInputDiagnostics {
    const oldestWaitMs = this.inputQueueAgeMs();
    return { queuedAudioMs: this.pendingBytes / 32, queuedWireBytes: this.pendingWireBytes,
      oldestWaitMs, peakWaitMs: this.peakWaitMs, droppedAudioMs: this.droppedBytes / 32 };
  }

  private discardQueuedInput(): void {
    ++this.inputGeneration;
    this.droppedBytes += this.remainder.byteLength;
    this.remainder = new Uint8Array(0);
    const remaining: XopcVoiceQueuedInput[] = [];
    for (const frame of this.pendingFrames) {
      if (frame.inFlight) remaining.push(frame);
      else {
        this.droppedBytes += frame.audioBytes;
        this.pendingBytes -= frame.audioBytes; this.pendingWireBytes -= frame.wireBytes;
      }
    }
    this.pendingFrames = remaining;
    this.rotateUtterance();
  }

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
    hilog.warn(0x0000, 'XopcVoice', 'Voice transport stopped: %{public}s', reason);
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
    this.inputMuted = true; clearInterval(this.heartbeatTimer); this.heartbeatTimer = -1;
    ++this.inputGeneration; this.pendingBytes = 0; this.pendingWireBytes = 0; this.pendingFrames = [];
    this.peakWaitMs = 0; this.droppedBytes = 0;
    this.audioSendQueue = Promise.resolve(); await this.releaseSocket();
  }
}
