#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const metrics = [
  'speechStopToResponseMs', 'speechStopToAudioReceivedMs',
  'audioReceivedToBufferedMs', 'audioReceivedToPlaybackProgressMs',
];
const source = process.argv[2];
if (source === '--help' || process.argv.length > 3) {
  console.log('Usage: node scripts/analyze-voice-timing.mjs [hilog.txt]\nReads stdin when no file is supplied. Outputs nearest-rank percentiles by mode/route.');
  process.exit(source === '--help' ? 0 : 1);
}
const input = source ? createReadStream(source) : process.stdin;
input.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
const groups = new Map();
let malformed = 0;
try {
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    const marker = line.indexOf('Voice timing: ');
    if (marker < 0) continue;
    try {
      const report = JSON.parse(line.slice(marker + 'Voice timing: '.length));
      if (report.kind !== 'voice_timing' || typeof report.mode !== 'string' || typeof report.route !== 'string') {
        malformed++; continue;
      }
      const key = JSON.stringify([report.mode, report.route]);
      if (!groups.has(key)) groups.set(key, { mode: report.mode, route: report.route, responses: 0, outcomes: {}, samples: {} });
      const group = groups.get(key); group.responses++;
      const outcome = typeof report.outcome === 'string' ? report.outcome : 'unknown';
      group.outcomes[outcome] = (group.outcomes[outcome] ?? 0) + 1;
      for (const metric of metrics) {
        const value = report[metric];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) (group.samples[metric] ??= []).push(value);
      }
    } catch { malformed++; }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
const percentile = (sorted, fraction) => sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1] : null;
console.log(JSON.stringify({
  measurement: 'Client-observed provider endpoint; playback progress is sampled, not acoustic first sound.',
  malformed,
  groups: [...groups.values()].map(({ samples, ...group }) => ({ ...group, metrics: Object.fromEntries(metrics.map((name) => {
    const values = (samples[name] ?? []).sort((a, b) => a - b);
    return [name, { n: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99) }];
  })) })),
}, null, 2));
