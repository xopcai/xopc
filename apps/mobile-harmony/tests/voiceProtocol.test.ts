import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  vi.doMock('@kit.ArkTS', () => ({ util: {
    generateRandomUUID: () => '00000000-0000-4000-8000-000000000000',
    TextEncoder: class { encodeInto(value: string): Uint8Array { return new TextEncoder().encode(value); } },
    TextDecoder: class { decodeToString(value: Uint8Array): string { return new TextDecoder('utf-8', { fatal: true }).decode(value); } }
  } }));
});

describe('Harmony voice protocol v3', () => {
  it('encodes 20 ms PCM uplink frames compatible with the shared protocol', async () => {
    const protocol = await import('../entry/src/main/ets/common/voiceProtocol.ets');
    const bytes = new Uint8Array(protocol.xopcEncodeVoiceUplink({ connectionEpoch: 2, utteranceId: 'utterance', audioSeq: 3,
      capturedAtMonotonicMs: 40, start: true, end: false, audio: new Uint8Array(640) }));
    const header = new DataView(bytes.buffer);
    expect(header.getUint32(0)).toBe(0x584f5033); expect(header.getUint8(4)).toBe(3); expect(header.getUint8(5)).toBe(1);
    expect(header.getUint32(8)).toBe(2); expect(header.getUint32(12)).toBe(3); expect(header.getUint16(24)).toBe(20);
    expect(header.getUint32(28)).toBe(640); expect(header.getUint8(7)).toBe(1);
  });
  it('rejects malformed downlink frames', async () => {
    const protocol = await import('../entry/src/main/ets/common/voiceProtocol.ets');
    expect(() => protocol.xopcDecodeVoiceAudio(new ArrayBuffer(32))).toThrow('INVALID_VOICE_FRAME');
  });
});
