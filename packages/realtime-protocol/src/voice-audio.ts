const HEADER_BYTES = 32;
const MAGIC = 0x584f5033;
const VERSION = 3;
const UPLINK = 1;
const DOWNLINK = 2;
const PCM_S16LE = 1;
const MAX_FRAME_BYTES = 64 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface VoiceAudioFrame {
  connectionEpoch: number;
  responseId: string;
  seq: number;
  mediaTimestampMs: number;
  durationMs: 20;
  audio: Uint8Array;
}

export interface VoiceUplinkAudioFrame {
  connectionEpoch: number;
  utteranceId: string;
  audioSeq: number;
  capturedAtMonotonicMs: number;
  durationMs: 20;
  start?: boolean;
  end?: boolean;
  audio: Uint8Array;
}

type MediaFrame = {
  kind: typeof UPLINK | typeof DOWNLINK;
  connectionEpoch: number;
  id: string;
  seq: number;
  timestampMs: number;
  durationMs: 20;
  flags: number;
  audio: Uint8Array;
};

function encode(frame: MediaFrame): Uint8Array {
  const id = encoder.encode(frame.id);
  if (!id.length || id.length > 160 || !Number.isInteger(frame.connectionEpoch) || frame.connectionEpoch < 1
    || frame.connectionEpoch > 0xffffffff || !Number.isInteger(frame.seq) || frame.seq < 1 || frame.seq > 0xffffffff
    || !Number.isFinite(frame.timestampMs) || frame.timestampMs < 0 || frame.durationMs !== 20 || frame.flags < 0 || frame.flags > 3
    || !frame.audio.length || frame.audio.length % 2 || HEADER_BYTES + id.length + frame.audio.length > MAX_FRAME_BYTES) {
    throw new Error('Invalid voice media frame');
  }
  const bytes = new Uint8Array(HEADER_BYTES + id.length + frame.audio.length);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, MAGIC);
  header.setUint8(4, VERSION);
  header.setUint8(5, frame.kind);
  header.setUint8(6, PCM_S16LE);
  header.setUint8(7, frame.flags);
  header.setUint32(8, frame.connectionEpoch);
  header.setUint32(12, frame.seq);
  header.setFloat64(16, frame.timestampMs);
  header.setUint16(24, frame.durationMs);
  header.setUint16(26, id.length);
  header.setUint32(28, frame.audio.length);
  bytes.set(id, HEADER_BYTES);
  bytes.set(frame.audio, HEADER_BYTES + id.length);
  return bytes;
}

function decode(bytes: Uint8Array, expectedKind: typeof UPLINK | typeof DOWNLINK): MediaFrame {
  if (bytes.length <= HEADER_BYTES || bytes.length > MAX_FRAME_BYTES) throw new Error('Invalid voice media frame');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = header.getUint8(5);
  const connectionEpoch = header.getUint32(8);
  const seq = header.getUint32(12);
  const timestampMs = header.getFloat64(16);
  const durationMs = header.getUint16(24);
  const idLength = header.getUint16(26);
  const payloadLength = header.getUint32(28);
  const payloadStart = HEADER_BYTES + idLength;
  const flags = header.getUint8(7);
  if (header.getUint32(0) !== MAGIC || header.getUint8(4) !== VERSION || kind !== expectedKind
    || header.getUint8(6) !== PCM_S16LE || flags > 3 || !connectionEpoch || !seq || !Number.isFinite(timestampMs) || timestampMs < 0
    || durationMs !== 20 || !idLength || idLength > 160 || !payloadLength || payloadLength % 2
    || payloadStart + payloadLength !== bytes.length) {
    throw new Error('Invalid voice media header');
  }
  return { kind, connectionEpoch, id: decoder.decode(bytes.subarray(HEADER_BYTES, payloadStart)), seq,
    timestampMs, durationMs, flags, audio: bytes.slice(payloadStart) };
}

export function encodeVoiceAudioFrame(frame: VoiceAudioFrame): Uint8Array {
  return encode({ kind: DOWNLINK, connectionEpoch: frame.connectionEpoch, id: frame.responseId, seq: frame.seq,
    timestampMs: frame.mediaTimestampMs, durationMs: frame.durationMs, flags: 0, audio: frame.audio });
}

export function decodeVoiceAudioFrame(bytes: Uint8Array): VoiceAudioFrame {
  const frame = decode(bytes, DOWNLINK);
  return { connectionEpoch: frame.connectionEpoch, responseId: frame.id, seq: frame.seq,
    mediaTimestampMs: frame.timestampMs, durationMs: frame.durationMs, audio: frame.audio };
}

export function encodeVoiceUplinkAudioFrame(frame: VoiceUplinkAudioFrame): Uint8Array {
  return encode({ kind: UPLINK, connectionEpoch: frame.connectionEpoch, id: frame.utteranceId, seq: frame.audioSeq,
    timestampMs: frame.capturedAtMonotonicMs, durationMs: frame.durationMs,
    flags: (frame.start ? 1 : 0) | (frame.end ? 2 : 0), audio: frame.audio });
}

export function decodeVoiceUplinkAudioFrame(bytes: Uint8Array): VoiceUplinkAudioFrame {
  const frame = decode(bytes, UPLINK);
  return { connectionEpoch: frame.connectionEpoch, utteranceId: frame.id, audioSeq: frame.seq,
    capturedAtMonotonicMs: frame.timestampMs, durationMs: frame.durationMs,
    ...(frame.flags & 1 ? { start: true } : {}), ...(frame.flags & 2 ? { end: true } : {}), audio: frame.audio };
}
