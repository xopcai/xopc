import { util } from '@kit.ArkTS';
import { XopcVoiceAudioFrame, XopcVoiceClientPayload, XopcVoiceServerEvent, XopcVoiceUplinkFrame } from '../model/voice';

export const XOPC_VOICE_PROTOCOL_VERSION: number = 3;
export const XOPC_VOICE_WS_PATH: string = '/api/voice/realtime/v3/ws';
export const XOPC_VOICE_PROXY_WS_PATH: string = '/api/realtime/v1/ws?transport=voice-v3';
const XOPC_VOICE_HEADER_BYTES: number = 32;
const XOPC_VOICE_MAGIC: number = 0x584f5033;
const XOPC_VOICE_UPLINK: number = 1;
const XOPC_VOICE_DOWNLINK: number = 2;
const XOPC_VOICE_PCM_S16LE: number = 1;
const XOPC_VOICE_MAX_FRAME_BYTES: number = 64 * 1024;

function xopcVoiceText(value: string): Uint8Array { return new util.TextEncoder().encodeInto(value); }
function xopcVoiceString(value: Uint8Array): string { return new util.TextDecoder('utf-8', { fatal: true }).decodeToString(value); }

export function xopcVoiceUuid(): string { return util.generateRandomUUID(); }

export function xopcVoiceClientMessage(type: string, payload: XopcVoiceClientPayload): string {
  return JSON.stringify({ protocolVersion: XOPC_VOICE_PROTOCOL_VERSION, messageId: xopcVoiceUuid(), type, sentAt: Date.now(), payload });
}

export function xopcParseVoiceEvent(raw: string): XopcVoiceServerEvent {
  if (xopcVoiceText(raw).byteLength > 16 * 1024) throw new Error('PROTOCOL_ERROR');
  const event = JSON.parse(raw) as XopcVoiceServerEvent;
  if (event.protocolVersion !== XOPC_VOICE_PROTOCOL_VERSION || !event.sessionId || !event.eventId
    || !Number.isSafeInteger(event.seq) || event.seq < 1 || !event.type || !event.payload) throw new Error('PROTOCOL_ERROR');
  return event;
}

export function xopcEncodeVoiceUplink(frame: XopcVoiceUplinkFrame): ArrayBuffer {
  const id = xopcVoiceText(frame.utteranceId);
  if (!id.byteLength || id.byteLength > 160 || frame.connectionEpoch < 1 || frame.audioSeq < 1
    || !frame.audio.byteLength || frame.audio.byteLength % 2 !== 0
    || XOPC_VOICE_HEADER_BYTES + id.byteLength + frame.audio.byteLength > XOPC_VOICE_MAX_FRAME_BYTES) throw new Error('INVALID_VOICE_FRAME');
  const bytes = new Uint8Array(XOPC_VOICE_HEADER_BYTES + id.byteLength + frame.audio.byteLength);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, XOPC_VOICE_MAGIC); header.setUint8(4, XOPC_VOICE_PROTOCOL_VERSION);
  header.setUint8(5, XOPC_VOICE_UPLINK); header.setUint8(6, XOPC_VOICE_PCM_S16LE);
  header.setUint8(7, (frame.start ? 1 : 0) | (frame.end ? 2 : 0));
  header.setUint32(8, frame.connectionEpoch); header.setUint32(12, frame.audioSeq);
  header.setFloat64(16, frame.capturedAtMonotonicMs); header.setUint16(24, 20);
  header.setUint16(26, id.byteLength); header.setUint32(28, frame.audio.byteLength);
  bytes.set(id, XOPC_VOICE_HEADER_BYTES); bytes.set(frame.audio, XOPC_VOICE_HEADER_BYTES + id.byteLength);
  return bytes.buffer;
}

export function xopcDecodeVoiceAudio(value: ArrayBuffer): XopcVoiceAudioFrame {
  const bytes = new Uint8Array(value);
  if (bytes.byteLength <= XOPC_VOICE_HEADER_BYTES || bytes.byteLength > XOPC_VOICE_MAX_FRAME_BYTES) throw new Error('INVALID_VOICE_FRAME');
  const header = new DataView(value);
  const idLength = header.getUint16(26); const payloadLength = header.getUint32(28);
  const payloadStart = XOPC_VOICE_HEADER_BYTES + idLength;
  if (header.getUint32(0) !== XOPC_VOICE_MAGIC || header.getUint8(4) !== XOPC_VOICE_PROTOCOL_VERSION
    || header.getUint8(5) !== XOPC_VOICE_DOWNLINK || header.getUint8(6) !== XOPC_VOICE_PCM_S16LE
    || header.getUint8(7) !== 0 || !header.getUint32(8) || !header.getUint32(12)
    || header.getUint16(24) !== 20 || !idLength || idLength > 160 || !payloadLength || payloadLength % 2 !== 0
    || payloadStart + payloadLength !== bytes.byteLength) throw new Error('INVALID_VOICE_FRAME');
  return { connectionEpoch: header.getUint32(8), responseId: xopcVoiceString(bytes.slice(XOPC_VOICE_HEADER_BYTES, payloadStart)),
    seq: header.getUint32(12), mediaTimestampMs: header.getFloat64(16), durationMs: 20, audio: bytes.slice(payloadStart) };
}
