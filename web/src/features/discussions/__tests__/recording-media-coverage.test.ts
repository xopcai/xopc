import { describe, expect, it } from 'vitest';

import { RecordingMediaCoverageReader } from '../recording-media-coverage';
import { element, mediaHeader, mediaCluster } from './recording-media-fixture';

describe('committed media time proof', () => {
  it('proves actual packet duration independently of callback time and arbitrary byte boundaries', () => {
    const source = Uint8Array.from([...mediaHeader, ...mediaCluster(0), ...mediaCluster(20), ...mediaCluster(40)]);
    for (const size of [1, 7, source.length]) {
      const reader = new RecordingMediaCoverageReader('audio/webm;codecs=opus');
      for (let index = 0; index < source.length; index += size) reader.append(source.subarray(index, index + size));
      expect(reader.snapshot()).toEqual({ version: 1, status: 'verified', verifiedThroughMs: 60, observedThroughMs: 60 });
    }
  });
  it('keeps a separate packet clock through pause timestamp overlap without overstating the continuous saved prefix', () => {
    const reader = new RecordingMediaCoverageReader('audio/webm');
    reader.append(Uint8Array.from([...mediaHeader,...mediaCluster(0),...mediaCluster(13)]));
    expect(reader.snapshot()).toMatchObject({ status: 'gap',verifiedThroughMs: 20,observedThroughMs: 33 });
    expect(reader.packetClock()).toEqual({ durationMs: 40,verified: true });
  });

  it('does not count an incomplete encoded packet until its remaining bytes arrive', () => {
    const reader = new RecordingMediaCoverageReader('audio/webm');
    const bytes = Uint8Array.from([...mediaHeader, ...mediaCluster(0)]);
    expect(reader.append(bytes.subarray(0, -1)).verifiedThroughMs).toBe(0);
    expect(reader.append(bytes.subarray(-1)).verifiedThroughMs).toBe(20);
  });
  it('freezes the continuous prefix at a missing range instead of advancing to the latest packet', () => {
    const reader = new RecordingMediaCoverageReader('audio/webm');
    reader.append(Uint8Array.from([...mediaHeader, ...mediaCluster(0), ...mediaCluster(80), ...mediaCluster(100)]));
    expect(reader.snapshot()).toMatchObject({ status: 'gap', verifiedThroughMs: 20, observedThroughMs: 120 });
  });
  it('does not silently bridge even a one-millisecond gap', () => {
    const reader = new RecordingMediaCoverageReader('audio/webm');
    expect(reader.append(Uint8Array.from([...mediaHeader, ...mediaCluster(0), ...mediaCluster(21)])))
      .toMatchObject({ status: 'gap', verifiedThroughMs: 20, observedThroughMs: 41 });
  });
  it('accepts bounded early timestamp quantization and its return to the cumulative sample clock', () => {
    // Captured device pattern: 2939 after 2880 + 60; 20040 after 19979 + 60.
    const packets = [...mediaHeader];
    for (let time = 0; time < 55_320; time += 60) {
      const timestamp = time >= 2940 && time < 20_040 ? time - 1 : time;
      packets.push(...mediaCluster(timestamp, 0, [0x18, 0]));
    }
    const source = Uint8Array.from(packets);
    for (const size of [1, 7, 5003, source.length]) {
      const reader = new RecordingMediaCoverageReader('audio/webm');
      for (let offset = 0; offset < source.length; offset += size) reader.append(source.subarray(offset, offset + size));
      expect(reader.snapshot()).toMatchObject({ status: 'verified', verifiedThroughMs: 55_320, observedThroughMs: 55_320 });
    }
  });
  it.each([1, 20, 1000])('never bridges a forward gap of %i ms after timestamp quantization', gap => {
    const reader = new RecordingMediaCoverageReader('audio/webm');
    reader.append(Uint8Array.from([...mediaHeader, ...mediaCluster(0), ...mediaCluster(19)]));
    expect(reader.snapshot()).toMatchObject({ status: 'verified', verifiedThroughMs: 39 });
    reader.append(Uint8Array.from([...mediaCluster(40 + gap), ...mediaCluster(60), ...mediaCluster(80)]));
    expect(reader.snapshot()).toMatchObject({ status: 'gap', verifiedThroughMs: 39 });
  });
  it('does not accumulate a fresh millisecond of tolerance per packet', () => {
    const reader = new RecordingMediaCoverageReader('audio/webm');
    reader.append(Uint8Array.from([...mediaHeader, ...mediaCluster(0), ...mediaCluster(19), ...mediaCluster(38)]));
    expect(reader.snapshot()).toMatchObject({ status: 'gap', verifiedThroughMs: 39 });
  });
  it('does not round a coarse WebM clock into permission to bridge large overlaps', () => {
    const reader = new RecordingMediaCoverageReader('audio/webm');
    // 2 ms ticks: these starts represent 0 ms and 18 ms.
    const scale = element([0x2a, 0xd7, 0xb1], [0x1e, 0x84, 0x80]);
    reader.append(Uint8Array.from([...mediaHeader, ...scale, ...mediaCluster(0), ...mediaCluster(9)]));
    expect(reader.snapshot()).toMatchObject({ status: 'gap', verifiedThroughMs: 20 });
  });
  it('keeps sub-millisecond Opus packet timing exact across quantized timestamps', () => {
    const reader = new RecordingMediaCoverageReader('audio/webm');
    reader.append(Uint8Array.from(mediaHeader));
    // Opus config 16 contains one 2.5 ms frame.
    for (let index = 0; index < 20; index++) reader.append(Uint8Array.from(mediaCluster(Math.floor(index * 2.5), 0, [0x80, 0])));
    expect(reader.snapshot()).toMatchObject({ status: 'verified', verifiedThroughMs: 49 });
    const before = reader.snapshot().verifiedThroughMs;
    // Drop the next 2.5 ms frame, even though the preceding timestamp was rounded down.
    reader.append(Uint8Array.from(mediaCluster(52, 0, [0x80, 0])));
    expect(reader.snapshot()).toMatchObject({ status: 'gap', verifiedThroughMs: before });
  });
  it('does not lose or accumulate saved time over two hours of quantized timestamps', () => {
    const reader = new RecordingMediaCoverageReader('audio/webm');
    reader.append(Uint8Array.from(mediaHeader));
    for (let time = 0; time < 7_200_000; time += 20) reader.append(Uint8Array.from(mediaCluster(time - (time % 60 === 20 ? 1 : 0))));
    expect(reader.snapshot()).toMatchObject({ status: 'verified', verifiedThroughMs: 7_200_000 });
  });

  it('keeps the proven prefix but stops making timing claims for unsupported lacing', () => {
    const reader = new RecordingMediaCoverageReader('audio/webm');
    reader.append(Uint8Array.from([...mediaHeader, ...mediaCluster(0), ...mediaCluster(20, 2)]));
    expect(reader.snapshot()).toMatchObject({ status: 'unknown', verifiedThroughMs: 20 });
    expect(reader.append(Uint8Array.from(mediaCluster(40))).verifiedThroughMs).toBe(20);
  });
  it.each(['audio/mp4', 'audio/ogg', 'audio/wav'])('does not invent coverage for %s', mime => {
    expect(new RecordingMediaCoverageReader(mime).append(Uint8Array.from([...mediaHeader, ...mediaCluster(0)])))
      .toMatchObject({ status: 'unknown', verifiedThroughMs: 0 });
  });
  it('rejects corrupt headers and oversized elements without treating their metadata as saved audio', () => {
    const reader = new RecordingMediaCoverageReader('audio/webm');
    expect(reader.append(Uint8Array.from([0, 0, 0]))).toMatchObject({ status: 'unknown', verifiedThroughMs: 0 });
    const oversized = new RecordingMediaCoverageReader('audio/webm');
    expect(oversized.append(Uint8Array.from([0xec, 0x14, 0, 0, 1]))).toMatchObject({ status: 'unknown', verifiedThroughMs: 0 });
  });
  it('does not count an unverified BlockGroup with discard padding as a fully saved packet', () => {
    const reader = new RecordingMediaCoverageReader('audio/webm');
    reader.append(Uint8Array.from([...mediaHeader, ...mediaCluster(0), ...element([0xa0], element([0xa1], [0x81, 0, 20, 0, 0xf8, 0]))]));
    expect(reader.snapshot()).toMatchObject({ status: 'unknown', verifiedThroughMs: 20 });
  });
  it('tracks two hours across cluster timestamp boundaries without retaining the recording', () => {
    const reader = new RecordingMediaCoverageReader('audio/webm');
    reader.append(Uint8Array.from(mediaHeader));
    for (let time = 0; time < 7_200_000; time += 20) reader.append(Uint8Array.from(mediaCluster(time)));
    expect(reader.snapshot()).toMatchObject({ status: 'verified', verifiedThroughMs: 7_200_000 });
  });
  it('does not claim duration for a zero time scale or unsupported codec delay', () => {
    for (const extra of [element([0x15, 0x49, 0xa9, 0x66], element([0x2a, 0xd7, 0xb1], [0])), element([0x56, 0xaa], [1])]) {
      const reader = new RecordingMediaCoverageReader('audio/webm');
      expect(reader.append(Uint8Array.from([...mediaHeader, ...extra, ...mediaCluster(0)]))).toMatchObject({ status: 'unknown', verifiedThroughMs: 0 });
    }
  });
});
