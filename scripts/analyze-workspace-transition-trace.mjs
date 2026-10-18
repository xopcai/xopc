// Diagnostic timings, not an FPS guarantee; all samples come from Electron contentTracing.
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.argv[2] ?? '/tmp/xopc-workspace-transition-trace.json';
const { traceEvents } = JSON.parse(readFileSync(path, 'utf8'));
const threads = new Set(traceEvents.filter(event => event.name === 'thread_name' && event.args?.name === 'CrRendererMain').map(event => `${event.pid}:${event.tid}`));
const result = { trace: path, rendererThreads: threads.size, timingsMs: {} };
for (const name of ['ThreadControllerImpl::RunTask', 'FireAnimationFrame', 'Layout', 'Paint', 'UpdateLayoutTree']) {
  const samples = traceEvents.filter(event => event.name === name && event.ph === 'X' && threads.has(`${event.pid}:${event.tid}`)).map(event => (event.dur ?? 0) / 1000).sort((a, b) => a - b);
  result.timingsMs[name] = { samples: samples.length, p95: samples[Math.floor(samples.length * .95)] ?? 0, max: samples.at(-1) ?? 0, over50ms: samples.filter(value => value > 50).length };
}
writeFileSync('/tmp/xopc-workspace-transition-metrics.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
