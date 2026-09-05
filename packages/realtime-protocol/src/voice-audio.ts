const HEADER_BYTES = 12;
const MAGIC = 0x584f5032;
const MAX_FRAME_BYTES = 64 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface VoiceAudioFrame { responseId: string; seq: number; audio: Uint8Array }

export function encodeVoiceAudioFrame(frame: VoiceAudioFrame): Uint8Array {
  const id = encoder.encode(frame.responseId);
  if (!id.length || id.length > 160 || !Number.isInteger(frame.seq) || frame.seq < 1 || frame.seq > 0xffffffff
    || !frame.audio.length || frame.audio.length % 2 || HEADER_BYTES + id.length + frame.audio.length > MAX_FRAME_BYTES) {
    throw new Error('Invalid voice audio frame');
  }
  const bytes = new Uint8Array(HEADER_BYTES + id.length + frame.audio.length);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, MAGIC);
  header.setUint32(4, frame.seq);
  header.setUint32(8, id.length);
  bytes.set(id, HEADER_BYTES);
  bytes.set(frame.audio, HEADER_BYTES + id.length);
  return bytes;
}

export function decodeVoiceAudioFrame(bytes: Uint8Array): VoiceAudioFrame {
  if (bytes.length <= HEADER_BYTES || bytes.length > MAX_FRAME_BYTES) throw new Error('Invalid voice audio frame');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const seq = header.getUint32(4);
  const length = header.getUint32(8);
  const start = HEADER_BYTES + length;
  if (header.getUint32(0) !== MAGIC || !seq || !length || length > 160 || start >= bytes.length || (bytes.length - start) % 2) {
    throw new Error('Invalid voice audio header');
  }
  return { responseId: decoder.decode(bytes.subarray(HEADER_BYTES, start)), seq, audio: bytes.slice(start) };
}
