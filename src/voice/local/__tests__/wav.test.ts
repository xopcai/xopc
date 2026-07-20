import { describe, expect, it } from 'vitest';

import { decodeWavToMonoFloat32 } from '../wav.js';

function pcm16Wav(samples: number[], sampleRate: number, channels = 1): Buffer {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, 44 + index * 2));
  return buffer;
}

describe('decodeWavToMonoFloat32', () => {
  it('mixes stereo PCM16 to mono', () => {
    const decoded = decodeWavToMonoFloat32(
      pcm16Wav([32767, -32768, 16384, 16384], 16_000, 2),
    );

    expect(decoded.sampleRate).toBe(16_000);
    expect(decoded.samples).toHaveLength(2);
    expect(decoded.samples[0]).toBeCloseTo(0, 3);
    expect(decoded.samples[1]).toBeCloseTo(0.5, 3);
    expect(decoded.durationSeconds).toBeCloseTo(2 / 16_000);
  });

  it('resamples audio to the runtime sample rate', () => {
    const decoded = decodeWavToMonoFloat32(pcm16Wav(new Array(80).fill(8192), 8_000));

    expect(decoded.samples).toHaveLength(160);
    expect(decoded.samples[40]).toBeCloseTo(0.25, 3);
    expect(decoded.durationSeconds).toBeCloseTo(0.01);
  });

  it('rejects container formats that would require an external decoder', () => {
    expect(() => decodeWavToMonoFloat32(Buffer.from('not a wave file'))).toThrow(
      'requires PCM WAV audio',
    );
  });
});
