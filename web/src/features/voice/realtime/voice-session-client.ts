import {
  VOICE_REALTIME_PROTOCOL_VERSION,
  createVoiceSessionResponseSchema,
  parseVoiceServerEvent,
  decodeVoiceAudioFrame,
  encodeVoiceUplinkAudioFrame,
  type CreateVoiceSessionResponse,
  type VoiceMode,
  type VoiceClientMessage,
  type VoiceServerEvent,
} from '@xopcai/realtime-protocol/voice';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

interface VoiceSessionClientOptions {
  signal?: AbortSignal;
  purpose: 'dictation' | 'conversation';
  mode?: VoiceMode;
  sessionKey?: string;
  onEvent: (event: VoiceServerEvent) => void;
  onAudio?: (audio: ArrayBuffer, responseId: string) => void;
  onClose?: (reason: string) => void;
}

function controlMessage(
  type: VoiceClientMessage['type'],
  payload: VoiceClientMessage['payload'],
): VoiceClientMessage {
  return {
    protocolVersion: VOICE_REALTIME_PROTOCOL_VERSION,
    messageId: crypto.randomUUID(),
    type,
    sentAt: Date.now(),
    payload,
  } as VoiceClientMessage;
}

function websocketUrl(path: string): string {
  const url = new URL(apiUrl(path));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export class VoiceSessionClient {
  private heartbeatId: number | undefined;
  private inputRemainder = new Uint8Array();
  private utteranceId = crypto.randomUUID();
  private inputSeq = 0;

  private constructor(
    private readonly socket: WebSocket,
    readonly session: CreateVoiceSessionResponse,
  ) {}

  static async preflight(options: Pick<VoiceSessionClientOptions, 'purpose' | 'mode' | 'sessionKey' | 'signal'>): Promise<void> {
    await fetchJson(apiUrl('/api/voice/realtime/preflight'), {
      method: 'POST', signal: options.signal,
      body: JSON.stringify({ purpose: options.purpose, mode: options.mode, sessionKey: options.sessionKey,
        supportedProtocolVersions: [VOICE_REALTIME_PROTOCOL_VERSION], mediaPreferences: ['websocket-pcm'] }),
    });
  }

  static async connect(options: VoiceSessionClientOptions): Promise<VoiceSessionClient> {
    options.signal?.throwIfAborted();
    const response = await fetchJson<{ ok: true; payload: CreateVoiceSessionResponse }>(
      apiUrl('/api/voice/realtime/sessions'),
      {
        method: 'POST',
        signal: options.signal,
        body: JSON.stringify({
          purpose: options.purpose,
          ...(options.mode ? { mode: options.mode } : {}),
          ...(options.sessionKey ? { sessionKey: options.sessionKey } : {}),
          supportedProtocolVersions: [VOICE_REALTIME_PROTOCOL_VERSION],
          mediaPreferences: ['websocket-pcm'],
        }),
      },
    );
    const session = createVoiceSessionResponseSchema.parse(response.payload);
    options.signal?.throwIfAborted();
    const socket = new WebSocket(websocketUrl(session.websocketPath));
    socket.binaryType = 'arraybuffer';
    const client = new VoiceSessionClient(socket, session);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeout: number | undefined;
      let audioSeq = 0;
      let eventSeq = 0;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) window.clearTimeout(timeout);
        socket.close();
        reject(error);
      };
      timeout = window.setTimeout(() => fail(new Error('Realtime voice connection timed out')), 15_000);
      const abort = () => {
        if (!settled) fail(new Error('Realtime voice connection cancelled'));
        else socket.close();
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      socket.addEventListener('close', () => options.signal?.removeEventListener('abort', abort), { once: true });
      if (options.signal?.aborted) { abort(); return; }
      socket.onerror = () => fail(new Error('Realtime voice connection failed'));
      socket.onclose = (event) => {
        if (!settled) fail(new Error(event.reason || 'Realtime voice connection closed'));
        else options.onClose?.(event.reason);
      };
      socket.onopen = () => {
        socket.send(JSON.stringify(controlMessage('session.start', {
          sessionId: session.sessionId,
          ticket: session.ticket,
        })));
      };
      socket.onmessage = (message) => {
        if (typeof message.data !== 'string') {
          try {
            const frame = decodeVoiceAudioFrame(new Uint8Array(message.data));
            if (frame.connectionEpoch !== session.connectionEpoch || frame.seq !== audioSeq + 1) throw new Error('Invalid audio sequence');
            audioSeq = frame.seq;
            options.onAudio?.(frame.audio.buffer as ArrayBuffer, frame.responseId);
          } catch { socket.close(4400, 'Invalid voice audio frame'); }
          return;
        }
        try {
          const event = parseVoiceServerEvent(JSON.parse(message.data) as unknown);
          if (event.sessionId !== session.sessionId || event.seq !== ++eventSeq) throw new Error('Invalid voice event sequence');
          options.onEvent(event);
          if (event.type === 'session.ready' && !settled) {
            if (event.payload.connectionEpoch !== session.connectionEpoch || event.payload.mode !== session.mode) throw new Error('Voice session mismatch');
            settled = true;
            window.clearTimeout(timeout);
            client.startHeartbeat(event.payload.heartbeatIntervalMs);
            resolve();
          } else if (event.type === 'session.error' && !event.payload.recoverable) {
            fail(new Error(event.payload.message));
          }
        } catch (error) {
          if (!settled) fail(error instanceof Error ? error : new Error(String(error)));
          else socket.close(4400, 'Invalid voice protocol frame');
        }
      };
    });
    return client;
  }

  sendAudio(audio: ArrayBuffer): void {
    if (!audio.byteLength || this.socket.readyState !== WebSocket.OPEN) return;
    const bytes = new Uint8Array(audio);
    const pending = new Uint8Array(this.inputRemainder.byteLength + bytes.byteLength);
    pending.set(this.inputRemainder); pending.set(bytes, this.inputRemainder.byteLength);
    let offset = 0;
    while (offset + 640 <= pending.byteLength) {
      const frame = encodeVoiceUplinkAudioFrame({ connectionEpoch: this.session.connectionEpoch,
        utteranceId: this.utteranceId, audioSeq: ++this.inputSeq, capturedAtMonotonicMs: performance.now(),
        durationMs: 20, ...(this.inputSeq === 1 ? { start: true } : {}), audio: pending.slice(offset, offset + 640) });
      this.socket.send(frame.buffer as ArrayBuffer);
      offset += 640;
    }
    this.inputRemainder = pending.slice(offset);
  }

  reportMetric(responseId: string, metric: 'speech_end_to_audio_received' | 'local_stop', durationMs: number): void {
    this.sendControl('session.metric', { responseId, metric, durationMs: Math.min(600_000, Math.max(0, durationMs)) });
  }

  setInputMuted(muted: boolean): void {
    this.sendControl('input.mute', { muted });
    this.inputRemainder = new Uint8Array();
    if (!muted) { this.utteranceId = crypto.randomUUID(); this.inputSeq = 0; }
  }

  commit(): void {
    this.sendControl('input.commit', {});
  }

  cancelResponse(responseId: string): void {
    this.sendControl('response.stop_playback', { responseId });
  }

  acknowledgeAudio(responseId: string, playedBytes: number): void {
    this.sendControl('response.audio.played', { responseId, playedDurationMs: Math.floor(playedBytes / 48) });
  }

  stop(reason: 'user_finished' | 'surface_closed' | 'replaced' = 'user_finished'): void {
    this.stopHeartbeat();
    if (this.socket.readyState === WebSocket.OPEN) {
      this.sendControl('session.stop', { reason });
    } else {
      this.socket.close();
    }
  }

  private sendControl(type: VoiceClientMessage['type'], payload: VoiceClientMessage['payload']): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(controlMessage(type, payload)));
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatId = window.setInterval(() => this.sendControl('session.ping', {}), intervalMs);
    this.socket.addEventListener('close', () => this.stopHeartbeat(), { once: true });
  }

  private stopHeartbeat(): void {
    if (this.heartbeatId === undefined) return;
    window.clearInterval(this.heartbeatId);
    this.heartbeatId = undefined;
  }
}
