import { expect, it } from 'vitest';
import { playbackRanges, pointToPcm, pcmEpoch } from '../media-timeline.js';
const epoch = { baseMs: 0,durationMs: 6000,verified: true,spans: [{ sourceMs: 0,pcmMs: 0,durationMs: 3000 },{ sourceMs: 5000,pcmMs: 3000,durationMs: 3000 }] };
it('maps normalized transcript time back to original playback and keeps pause gaps separate', () => {
  expect(playbackRanges({ primary: 'encoded',epochs: [epoch] },2000,4000)).toEqual([{ startedAtMs: 2000,endedAtMs: 3000 },{ startedAtMs: 5000,endedAtMs: 6000 }]);
  expect(pointToPcm(epoch,5500)).toBe(3500);
  expect(pointToPcm(epoch,4000)).toBeUndefined();
});
it('maps independent epoch highlights into the derived source without inventing missing audio', () => {
  expect(pointToPcm({ ...epoch,baseMs: 8000 },5500)).toBe(11500);
  expect(playbackRanges({ primary: 'pcm',epochs: [pcmEpoch(8000),{ ...epoch,baseMs: 8000 }] },10000,12000)).toEqual([{ startedAtMs: 10000,endedAtMs: 12000 }]);
  expect(playbackRanges({ primary: 'pcm',epochs: [pcmEpoch(8000)] },7000,10000)).toEqual([]);
  expect(playbackRanges({ primary: 'encoded',epochs: [{ ...epoch,verified: false }] },0,2000)).toEqual([]);
});

it('does not guess an encoded point inside overlapping packets while retaining exact PCM range mapping', () => {
  const overlap = { baseMs: 0,durationMs: 40,verified: true,spans: [{ sourceMs: 0,pcmMs: 0,durationMs: 20 },{ sourceMs: 13,pcmMs: 20,durationMs: 20 }] };
  expect(pointToPcm(overlap,15)).toBeUndefined();
  expect(playbackRanges({ primary: 'encoded',epochs: [overlap] },25,35)).toEqual([{ startedAtMs: 18,endedAtMs: 28 }]);
});
