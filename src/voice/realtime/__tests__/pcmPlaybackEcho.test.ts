import { describe, expect, it } from 'vitest';

import { PcmPlaybackEcho } from '../pcmPlaybackEcho.js';

const spoken = (time: number) => 6_000 * Math.sin(time * 2 * Math.PI * 255) + 2_000 * Math.sin(time * 2 * Math.PI * 590);
const interruption = (time: number) => 2_000 * Math.sin(time * 2 * Math.PI * 379);

function pcm(rate: number, signal: (time: number) => number): Uint8Array {
  const frame = new Uint8Array(rate / 50 * 2);
  const view = new DataView(frame.buffer);
  for (let i = 0; i < frame.length / 2; i++) view.setInt16(i * 2, signal(i / rate), true);
  return frame;
}

describe('PCM playback echo', () => {
  it('matches an attenuated playback copy and expires the reference', () => {
    const echo = new PcmPlaybackEcho();
    echo.remember(pcm(24_000, spoken), 1_000);
    const copy = pcm(16_000, time => spoken(time) * 0.4);
    expect(echo.matches(copy, 1_200)).toBe(true);
    expect(echo.matches(copy, 4_001)).toBe(false);
  });

  it('preserves new speech mixed with playback and ignores silence', () => {
    const echo = new PcmPlaybackEcho();
    echo.remember(pcm(24_000, spoken), 1_000);
    expect(echo.matches(pcm(16_000, time => spoken(time) * 0.4 + interruption(time)), 1_200)).toBe(false);
    expect(echo.matches(pcm(16_000, interruption), 1_200)).toBe(false);
    expect(echo.matches(new Uint8Array(640), 1_200)).toBe(false);
  });
});
