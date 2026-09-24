import { expect, it } from 'vitest';
import { decodeWavToMonoFloat32 } from '../../voice/audio/wav.js';
import { missingAudioRanges, slicePcmWav } from '../audio-repair.js';

it('preserves corrected spans even when they cross recovery chunk boundaries', () => {
  const confirmed = [{ startedAtMs: 20_000, endedAtMs: 40_000 }, { startedAtMs: 45_000, endedAtMs: 50_000 }];
  expect(missingAudioRanges(0, 30_000, confirmed)).toEqual([{ startedAtMs: 0, endedAtMs: 20_000 }]);
  expect(missingAudioRanges(30_000, 60_000, confirmed)).toEqual([{ startedAtMs: 40_000, endedAtMs: 45_000 }, { startedAtMs: 50_000, endedAtMs: 60_000 }]);
});
it('cuts PCM at the original media coordinates', () => {
  const samples = new Float32Array(16_000); samples.fill(0.5, 8_000);
  const decoded = decodeWavToMonoFloat32(slicePcmWav({ samples, sampleRate: 16_000, durationSeconds: 1 }, 500, 1000));
  expect(decoded.durationSeconds).toBe(0.5);
  expect(decoded.samples[0]).toBeCloseTo(0.5, 3);
});
