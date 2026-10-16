/** Real browser containers: encoded coverage, decoder agreement and unsafe byte concatenation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { RecordingMediaCoverageReader } from '../web/src/features/discussions/recording-media-coverage.js';
import { forEachNormalizedAudioSegment } from '../src/voice/audio/normalize.js';
import { decodeWavToMonoFloat32 } from '../src/voice/audio/wav.js';

const reportPath = process.argv[2] ?? 'docs/design/technical/note-p0-browser-2026-10-15.json';
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.equal(report.passed, true);
const original = readFileSync(join(report.directory, 'recovered.webm'));
const paused = readFileSync(join(report.directory, 'paused.webm'));
let decodedMs = 0;
await forEachNormalizedAudioSegment({ filePath: join(report.directory, 'recovered.webm') }, async bytes => {
  decodedMs += decodeWavToMonoFloat32(bytes).durationSeconds * 1000;
});
const boundaries = [];
for (const bytesPerSlice of [1, 257, 65_536]) {
  const reader = new RecordingMediaCoverageReader('audio/webm;codecs=opus');
  for (let offset = 0; offset < original.length; offset += bytesPerSlice) reader.append(original.subarray(offset, offset + bytesPerSlice));
  const coverage = reader.snapshot();
  assert.equal(coverage.status, 'verified'); assert.ok(Math.abs(coverage.verifiedThroughMs - decodedMs) < 2);
  boundaries.push({ bytesPerSlice, coverage });
}
const joined = new RecordingMediaCoverageReader('audio/webm');
joined.append(original); const joinedCoverage = joined.append(paused);
assert.notEqual(joinedCoverage.status, 'verified', 'Separate MediaRecorder containers must not silently become one continuous source');
report.mediaPreflight = { passed: true, decodedMs, boundaries, append: { supported: false, coverage: joinedCoverage,
  decision: 'Keep independent source assets and map them with a versioned manifest. Do not concatenate container bytes.',
  assetHashes: [original, paused].map(bytes => createHash('sha256').update(bytes).digest('hex')) },
  verifiedSources: Object.fromEntries(['web/src/features/discussions/recording-media-coverage.ts',
    'web/src/features/discussions/recording-status.ts', 'web/src/features/discussions/use-discussion-recorder.ts']
    .map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])) };
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.mediaPreflight));
