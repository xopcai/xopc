import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mathRanges } from '../packages/markdown-math/src/remark.js';

import { createMathBudget } from '../web/src/features/chat/rendering/markdown/math-budget.js';
import { SessionLoadQueue } from '../web/src/features/chat/session/session-load-queue.js';

const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]!;
const blocks = Array.from({ length: 500 }, (_, index) => `第 ${index} 段：这是已经完成的内容。公式 $a^2+b^2=c^2$。\n\n`);
const baseline: number[] = [], optimized: number[] = [];
let baselineScans = 0, optimizedScans = 0;
for (let run = 0; run < 21; run++) {
  const cached = createMathBudget(source => { optimizedScans++; return mathRanges(source).length; });
  const source = [...blocks];
  cached(source);
  for (let delta = 0; delta < 100; delta++) {
    source[499] += '字';
    const before = () => {
      const start = performance.now();
      let used = 0;
      const result = source.map(block => { const left = Math.max(0, 256 - used); baselineScans++; used += mathRanges(block).length; return left; });
      if (run) baseline.push(performance.now() - start);
      return result;
    };
    const after = () => {
      const start = performance.now();
      const result = cached(source);
      if (run) optimized.push(performance.now() - start);
      return result;
    };
    const [a, b] = delta % 2 ? [after(), before()] : [before(), after()];
    assert.deepEqual(a, b);
  }
}
assert.equal(baselineScans, 21 * 100 * 500);
assert.equal(optimizedScans, 21 * (500 + 100));

async function switchTime(sharedQueue: boolean) {
  const queue = new SessionLoadQueue();
  const started = performance.now();
  const slow = queue.run('A', () => new Promise<void>(resolve => setTimeout(resolve, 100)));
  await queue.run(sharedQueue ? 'A' : 'B', async () => {});
  const selectedReadyMs = performance.now() - started;
  await slow;
  return selectedReadyMs;
}
const report = {
  scope: 'Synthetic local CPU and request scheduling only; not end-to-end model or production latency.',
  math: { blocks: 500, deltas: 100, runs: 20, baselineScans, optimizedScans,
    baselineP50Ms: percentile(baseline, .5), optimizedP50Ms: percentile(optimized, .5),
    baselineP95Ms: percentile(baseline, .95), optimizedP95Ms: percentile(optimized, .95) },
  switching: { unrelatedRequestDelayMs: 100, baselineSelectedReadyMs: await switchTime(true), optimizedSelectedReadyMs: await switchTime(false) },
};
console.log(JSON.stringify(report, null, 2));
