import { describe, expect, it } from 'vitest';

import { applyVoiceOutputGain } from '../pcm-output-gain.js';

function pcm(...samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return bytes;
}

function samples(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.byteLength / 2 }, (_, index) => view.getInt16(index * 2, true));
}

describe('realtime voice output gain', () => {
  it('raises quiet conversational audio without mutating provider bytes', () => {
    const input = pcm(0, 10_000, -10_000);
    expect(samples(applyVoiceOutputGain(input))).toEqual([0, 15_000, -15_000]);
    expect(samples(input)).toEqual([0, 10_000, -10_000]);
  });

  it('limits amplified peaks to valid signed PCM', () => {
    expect(samples(applyVoiceOutputGain(pcm(25_000, -25_000)))).toEqual([32_767, -32_768]);
  });

  it('rejects incomplete samples', () => {
    expect(() => applyVoiceOutputGain(new Uint8Array(1))).toThrow('aligned PCM samples');
  });
});
