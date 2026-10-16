// Replay local microphone audio without uploading or copying the source into the repository.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { RecordingMediaCoverageReader } from '../web/src/features/discussions/recording-media-coverage.ts';

const inputs = process.argv.slice(2);
assert.ok(inputs.length, 'Pass at least one retained single-epoch WebM file');
const checks = [];
for (const input of inputs) {
  const bytes = await readFile(input);
  const runs = [];
  for (const size of [1, 7, 4093, bytes.length]) {
    const reader = new RecordingMediaCoverageReader('audio/webm;codecs=opus');
    for (let offset = 0; offset < bytes.length; offset += size) reader.append(bytes.subarray(offset, offset + size));
    runs.push({ size, ...reader.snapshot(), packetClock: reader.packetClock() });
  }
  for (const run of runs) assert.deepEqual({ ...run, size: 0 }, { ...runs[0], size: 0 });
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', input, '-ar', '48000', '-ac', '1', '-f', 's16le', 'pipe:1'], { maxBuffer: 128 * 1024 * 1024 });
  const decodedMs = pcm.length / 2 / 48;
  assert.equal(runs[0].status, 'verified', 'This regression corpus must contain known timestamp quantization, not source gaps');
  assert.ok(Math.abs(runs[0].verifiedThroughMs - decodedMs) < 2, 'Saved range must agree with actual decoded audio');
  checks.push({ source: resolve(input), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), decodedMs, runs });
}
const report = { date: new Date().toISOString(), physicalMicrophoneCorpus: true, uploaded: false, passed: true, checks };
const output = process.env.XOPC_NOTE_TIMING_REPORT;
if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
