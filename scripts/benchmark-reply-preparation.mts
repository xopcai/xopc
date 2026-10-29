/** Offline workspace-verification comparison; never reads user state or calls a model. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { AfterToolCallContext } from '@earendil-works/pi-agent-core';

import { RunVerification } from '../src/agent/coding/run-verification.js';

const exec = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'xopc-reply-preparation-'));
const iterations = 20;
const distribution = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, p50Ms: sorted[Math.ceil(sorted.length * .5) - 1]!,
    p95Ms: sorted[Math.ceil(sorted.length * .95) - 1]! };
};

async function exercise(trackWorkspace: boolean, withTool: boolean): Promise<{ totalMs: number; preparationMs: number }> {
  const started = performance.now();
  const run = await RunVerification.open(directory, {
    required: false, trackWorkspace, toolNames: ['personal_task', 'read_file'],
  });
  const initial = await run.summary();
  assert.equal(typeof initial.revision, trackWorkspace ? 'string' : 'undefined');
  const preparationMs = performance.now() - started;
  if (withTool) {
    await run.beforeTool('submit', 'personal_task');
    await run.afterTool({ toolCall: { id: 'submit', name: 'personal_task' }, args: {}, isError: false,
      result: { content: [], details: {} } } as unknown as AfterToolCallContext);
  }
  assert.equal(await run.pendingContext(), '');
  assert.equal((await run.summary()).changed, false);
  return { totalMs: performance.now() - started, preparationMs };
}

try {
  await exec('git', ['init', '--quiet', directory]);
  for (let index = 0; index < 32; index++) {
    await writeFile(join(directory, `fixture-${index}.txt`), 'Synthetic reply preparation fixture.\n'.repeat(32));
  }
  const scenarios = [];
  for (const withTool of [false, true]) {
    await exercise(true, withTool);
    await exercise(false, withTool);
    const before: Awaited<ReturnType<typeof exercise>>[] = [], after: typeof before = [];
    for (let index = 0; index < iterations; index++) {
      if (index % 2) {
        after.push(await exercise(false, withTool));
        before.push(await exercise(true, withTool));
      } else {
        before.push(await exercise(true, withTool));
        after.push(await exercise(false, withTool));
      }
    }
    const baseline = distribution(before.map(row => row.totalMs)), optimized = distribution(after.map(row => row.totalMs));
    scenarios.push({ name: withTool ? 'personal_task' : 'text_only',
      baseline, optimized, savedP50Ms: baseline.p50Ms - optimized.p50Ms,
      preparation: { baseline: distribution(before.map(row => row.preparationMs)),
        optimized: distribution(after.map(row => row.preparationMs)) }, before, after });
  }
  const report = { generatedAt: new Date().toISOString(),
    scope: 'Real Git/filesystem work in an isolated synthetic repository; verification stage only, not end-to-end response latency.',
    fixture: { untrackedFiles: 32, iterations, order: 'alternating' }, scenarios };
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex !== -1) {
    assert.ok(process.argv[outputIndex + 1], '--output requires a path');
    const output = resolve(process.argv[outputIndex + 1]!);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ ...report, scenarios: scenarios.map(({ before: _before, after: _after, ...row }) => row) }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
