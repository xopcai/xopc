import { describe, expect, it } from 'vitest';

import {
  calculateRmsLevel,
  encodePcm16Wav,
  resamplePcm,
} from '../pcm-wav-recorder';

describe('PCM WAV recorder helpers', () => {
  it('encodes mono samples as a valid 16 kHz PCM16 WAV file', () => {
    const encoded = encodePcm16Wav(new Float32Array([-1, 0, 1]));
    const view = new DataView(encoded);
    const text = (offset: number, length: number) =>
      String.fromCharCode(...new Uint8Array(encoded, offset, length));

    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(32767);
  });

  it('resamples PCM without requiring MediaRecorder or a codec binary', () => {
    const output = resamplePcm(new Float32Array([0, 0.5, 1, 0.5]), 8_000, 16_000);

    expect(output).toHaveLength(8);
    expect(output[0]).toBe(0);
    expect(output[2]).toBeCloseTo(0.5);
    expect(output[4]).toBeCloseTo(1);
  });

  it('calculates a stable normalized RMS level for local VAD', () => {
    expect(calculateRmsLevel(new Float32Array([]))).toBe(0);
    expect(calculateRmsLevel(new Float32Array([0, 0, 0]))).toBe(0);
    expect(calculateRmsLevel(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(calculateRmsLevel(new Float32Array([2, -2]))).toBe(1);
  });

});
