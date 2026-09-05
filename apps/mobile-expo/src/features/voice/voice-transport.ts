import { randomUUID } from 'expo-crypto';
import {
  decodeVoiceAudioFrame, parseVoiceServerEvent, VOICE_REALTIME_PROTOCOL_VERSION,
  type CreateVoiceSessionResponse, type VoiceClientMessage, type VoiceServerEvent,
} from '@xopcai/realtime-protocol/voice';

export type VoiceTransportCallbacks = {
  event: (event: VoiceServerEvent) => void;
  audio: (id: string, pcm: Uint8Array) => void;
  close: (reason: string) => void;
};

export class VoiceTransport {
  private socket: WebSocket | null = null;
  private heartbeat?: ReturnType<typeof setInterval>;
  private closed = false;
  private fail?: (reason: string) => void;
  constructor(private callbacks: VoiceTransportCallbacks) {}

  async connect(origin: string, session: CreateVoiceSessionResponse, signal: AbortSignal): Promise<void> {
    const url = new URL(session.websocketPath, origin);
    if (url.protocol !== 'https:' || url.origin !== new URL(origin).origin) throw new Error('SECURE_ROUTE_REQUIRED');
    url.protocol = 'wss:';
    const socket = new WebSocket(url.toString());
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    let jsonSeq = 0;
    let audioSeq = 0;
    let lastPong = Date.now();
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      let settled = false;
      const timeout = setTimeout(() => fail('CONNECT_TIMEOUT'), 15_000);
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
      socket.onopen = () => this.send('session.start', { sessionId: session.sessionId, ticket: session.ticket });
      socket.onmessage = ({ data }) => {
        if (this.closed) return;
        try {
          if (typeof data !== 'string') {
            if (!ready) throw new Error('PROTOCOL_ERROR');
            const frame = decodeVoiceAudioFrame(new Uint8Array(data));
            if (frame.seq !== ++audioSeq) throw new Error('PROTOCOL_ERROR');
            this.callbacks.audio(frame.responseId, frame.audio);
            return;
          }
          const event = parseVoiceServerEvent(JSON.parse(data));
          if (event.sessionId !== session.sessionId || event.seq !== ++jsonSeq) throw new Error('PROTOCOL_ERROR');
          if (event.type === 'session.ready') {
            if (ready || event.payload.route.engine !== session.route.engine) throw new Error('PROTOCOL_ERROR');
            ready = true;
            settled = true;
            clearTimeout(timeout);
            this.heartbeat = setInterval(() => {
              if (Date.now() - lastPong > 35_000) fail('NETWORK');
              else this.send('session.ping', {});
            }, event.payload.heartbeatIntervalMs);
            resolve();
          }
          if (event.type === 'session.pong') lastPong = Date.now();
          this.callbacks.event(event);
          if (event.type === 'session.error' && !event.payload.recoverable) fail(event.payload.code);
          if (event.type === 'session.closed') fail(event.payload.reason);
        } catch { fail('PROTOCOL_ERROR'); }
      };
      socket.onerror = () => fail('NETWORK');
      socket.onclose = () => {
        signal.removeEventListener('abort', abort);
        if (!this.closed) fail('NETWORK');
        else if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('CANCELLED')); }
      };
    });
  }

  send(type: VoiceClientMessage['type'], payload: VoiceClientMessage['payload']): void {
    if (this.socket?.readyState !== WebSocket.OPEN || this.closed) return;
    try { this.socket.send(JSON.stringify({ protocolVersion: VOICE_REALTIME_PROTOCOL_VERSION, messageId: randomUUID(), sentAt: Date.now(), type, payload })); }
    catch { this.fail?.('NETWORK'); }
  }
  audio(bytes: Uint8Array): void {
    if (!this.socket || this.closed || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount > 64_000) throw new Error('INPUT_DROPPED');
    this.socket.send(bytes);
  }
  close(): void {
    this.closed = true;
    clearInterval(this.heartbeat);
    this.socket?.close();
    this.socket = null;
  }
}
