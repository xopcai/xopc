import { randomUUID } from 'expo-crypto';
import {
  decodeVoiceAudioFrame, encodeVoiceUplinkAudioFrame, parseVoiceServerEvent, VOICE_REALTIME_PROTOCOL_VERSION,
  VOICE_REALTIME_PROXY_WS_PATH,
  type CreateVoiceSessionResponse, type VoiceClientMessage, type VoiceServerEvent,
} from '@xopcai/realtime-protocol/voice';

export type VoiceTransportCallbacks = {
  event: (event: VoiceServerEvent) => void;
  audio: (id: string, pcm: Uint8Array) => void;
  close: (reason: string) => void;
  networkRtt?: (rttMs: number) => void;
};

export type VoiceInputQuality = 'good' | 'degraded' | 'critical';
export type VoiceAudioSendResult = { accepted: boolean; quality: VoiceInputQuality; queueAgeMs: number };

const PCM_BYTES_PER_MS = 32;
const INPUT_FRAME_BYTES = 640;
const DEGRADED_QUEUE_AGE_MS = 120;
const CRITICAL_QUEUE_AGE_MS = 300;

function inputQuality(queueAgeMs: number): VoiceInputQuality {
  if (queueAgeMs >= CRITICAL_QUEUE_AGE_MS) return 'critical';
  if (queueAgeMs >= DEGRADED_QUEUE_AGE_MS) return 'degraded';
  return 'good';
}

export class VoiceTransport {
  private socket: WebSocket | null = null;
  private heartbeat?: ReturnType<typeof setInterval>;
  private closed = false;
  private fail?: (reason: string) => void;
  private connectionEpoch = 0;
  private utteranceId = '';
  private inputSeq = 0;
  private inputStarted = false;
  private inputRemainder = new Uint8Array();
  constructor(private callbacks: VoiceTransportCallbacks) {}

  async connect(origin: string, session: CreateVoiceSessionResponse, signal: AbortSignal): Promise<void> {
    const socketUrl = (path: string) => {
      const url = new URL(path, origin);
      if (url.protocol !== 'https:' || url.origin !== new URL(origin).origin) throw new Error('SECURE_ROUTE_REQUIRED');
      url.protocol = 'wss:';
      return url.toString();
    };
    const candidates = Array.from(new Set([
      socketUrl(session.websocketPath),
      socketUrl(VOICE_REALTIME_PROXY_WS_PATH),
    ]));
    let jsonSeq = 0;
    let audioSeq = 0;
    let lastPong = Date.now();
    let lastPing = 0;
    this.connectionEpoch = session.connectionEpoch;
    this.rotateUtterance();
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      let settled = false;
      let candidateIndex = 0;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const abort = () => { fail('CANCELLED'); this.close(); };
      const fail = (reason: string) => {
        clearTimeout(timeout);
        const notify = settled && ready && !this.closed;
        if (!settled) { settled = true; reject(new Error(reason)); }
        this.close();
        if (notify) this.callbacks.close(reason);
      };
      this.fail = fail;
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      const openCandidate = () => {
        const socket = new WebSocket(candidates[candidateIndex]!);
        let opened = false;
        socket.binaryType = 'arraybuffer';
        this.socket = socket;
        const retryProxyRoute = () => {
          if (opened || ready || candidateIndex + 1 >= candidates.length || signal.aborted || this.closed) return false;
          clearTimeout(timeout);
          socket.onopen = null;
          socket.onmessage = null;
          socket.onerror = null;
          socket.onclose = null;
          if (this.socket === socket) this.socket = null;
          socket.close();
          candidateIndex += 1;
          openCandidate();
          return true;
        };
        timeout = setTimeout(() => {
          if (!retryProxyRoute()) fail('CONNECT_TIMEOUT');
        }, 15_000);
        socket.onopen = () => {
          opened = true;
          this.send('session.start', { sessionId: session.sessionId, ticket: session.ticket });
        };
        socket.onmessage = ({ data }) => {
          if (this.closed || this.socket !== socket) return;
          try {
            if (typeof data !== 'string') {
              if (!ready) throw new Error('PROTOCOL_ERROR');
              const frame = decodeVoiceAudioFrame(new Uint8Array(data));
              if (frame.connectionEpoch !== this.connectionEpoch || frame.seq !== ++audioSeq) throw new Error('PROTOCOL_ERROR');
              this.callbacks.audio(frame.responseId, frame.audio);
              return;
            }
            const event = parseVoiceServerEvent(JSON.parse(data));
            if (event.sessionId !== session.sessionId || event.seq !== ++jsonSeq) throw new Error('PROTOCOL_ERROR');
            if (event.type === 'session.ready') {
              if (ready || event.payload.connectionEpoch !== session.connectionEpoch || event.payload.route.engine !== session.route.engine) throw new Error('PROTOCOL_ERROR');
              ready = true;
              settled = true;
              clearTimeout(timeout);
              this.heartbeat = setInterval(() => {
                if (Date.now() - lastPong > 35_000) fail('NETWORK');
                else { lastPing = Date.now(); this.send('session.ping', {}); }
              }, event.payload.heartbeatIntervalMs);
              resolve();
            }
            if (event.type === 'session.pong') {
              lastPong = Date.now();
              if (lastPing) this.callbacks.networkRtt?.(lastPong - lastPing);
            }
            this.callbacks.event(event);
            if (event.type === 'session.error' && !event.payload.recoverable) fail(event.payload.code);
            if (event.type === 'session.closed') fail(event.payload.reason);
          } catch { fail('PROTOCOL_ERROR'); }
        };
        socket.onerror = () => {
          if (!retryProxyRoute()) fail('NETWORK');
        };
        socket.onclose = () => {
          if (this.socket !== socket) return;
          if (!this.closed && retryProxyRoute()) return;
          signal.removeEventListener('abort', abort);
          if (!this.closed) fail('NETWORK');
          else if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('CANCELLED')); }
        };
      };
      openCandidate();
    });
  }

  send(type: VoiceClientMessage['type'], payload: VoiceClientMessage['payload']): void {
    if (this.socket?.readyState !== WebSocket.OPEN || this.closed) return;
    try {
      this.socket.send(JSON.stringify({ protocolVersion: VOICE_REALTIME_PROTOCOL_VERSION, messageId: randomUUID(), sentAt: Date.now(), type, payload }));
      if (type === 'input.mute' && 'muted' in payload && !payload.muted) this.rotateUtterance();
    }
    catch { this.fail?.('NETWORK'); }
  }
  inputQueueAgeMs(): number {
    if (!this.socket || this.closed || this.socket.readyState !== WebSocket.OPEN) return Number.POSITIVE_INFINITY;
    const bufferedAmount = this.socket.bufferedAmount;
    // React Native declares bufferedAmount but does not populate it on its native WebSocket.
    // Treat an unavailable measurement as an empty JS-side queue so microphone input keeps flowing.
    if (typeof bufferedAmount !== 'number' || !Number.isFinite(bufferedAmount) || bufferedAmount < 0) return 0;
    return bufferedAmount / PCM_BYTES_PER_MS;
  }
  audio(bytes: Uint8Array): VoiceAudioSendResult {
    const before = this.inputQueueAgeMs();
    if (!Number.isFinite(before) || before >= CRITICAL_QUEUE_AGE_MS) return { accepted: false, quality: 'critical', queueAgeMs: before };
    try {
      const pending = new Uint8Array(this.inputRemainder.byteLength + bytes.byteLength);
      pending.set(this.inputRemainder);
      pending.set(bytes, this.inputRemainder.byteLength);
      let offset = 0;
      for (; offset + INPUT_FRAME_BYTES <= pending.byteLength; offset += INPUT_FRAME_BYTES) {
        const audio = pending.subarray(offset, offset + INPUT_FRAME_BYTES);
        this.socket!.send(encodeVoiceUplinkAudioFrame({ connectionEpoch: this.connectionEpoch, utteranceId: this.utteranceId,
          audioSeq: ++this.inputSeq, capturedAtMonotonicMs: performance.now(), durationMs: 20,
          ...(this.inputStarted ? {} : { start: true }), audio }));
        this.inputStarted = true;
      }
      this.inputRemainder = pending.slice(offset);
    } catch {
      this.fail?.('NETWORK');
      return { accepted: false, quality: 'critical', queueAgeMs: Number.POSITIVE_INFINITY };
    }
    const queueAgeMs = this.inputQueueAgeMs();
    return { accepted: true, quality: inputQuality(queueAgeMs), queueAgeMs };
  }
  private rotateUtterance(): void {
    this.utteranceId = randomUUID();
    this.inputSeq = 0;
    this.inputStarted = false;
    this.inputRemainder = new Uint8Array();
  }
  close(): void {
    this.closed = true;
    clearInterval(this.heartbeat);
    this.socket?.close();
    this.socket = null;
  }
}
