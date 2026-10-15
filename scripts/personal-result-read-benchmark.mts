/** No model calls: verify ready body/artifact reads against retained real-chain data. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const input = resolve(process.argv[2] ?? 'docs/design/technical/personal-performance-live-2026-10-15.json');
const live = JSON.parse(readFileSync(input, 'utf8'));
assert.equal(live.success, true, 'The real chain must complete before read performance acceptance');
const directory = live.isolatedStateDirectory;
process.env.XOPC_STATE_DIR = directory;
process.env.XOPC_CONFIG_PATH = join(directory, 'xopc.json');
process.env.XOPC_CONFIG = join(directory, 'xopc.json');
process.env.XOPC_LOG_DIR = join(directory, 'logs');
process.env.XOPC_LOG_LEVEL = 'fatal';
const { openXopcDatabase, closeXopcDatabase } = await import('../src/storage/sqlite/index.js');
const { readPersonalResult, stopPersonalResultPreparations } = await import('../src/personal-agent/result-reader.js');
const { latencyDistribution } = await import('../src/personal-agent/performance.js');
openXopcDatabase({ path: join(directory, 'xopc.db') });
const deliveries = live.finalDeliveries;
const original = deliveries.find((value: { resultRevision: number }) => value.resultRevision === 1);
const revised = deliveries.find((value: { resultRevision: number }) => value.resultRevision === 2);
assert.ok(original && revised);
const prepareStart = performance.now();
const ready = async (delivery: typeof revised, command: 'read' | 'search', sourceId = 'body') => {
  for (let index = 0; index < 300; index++) {
    const result = await readPersonalResult(delivery.conversationId, { command, resultId: delivery.deliveryId, sourceId,
      ...(command === 'search' ? { query: '核对码' } : {}) });
    if (result.status === 'ready') return result;
    assert.equal(result.status, 'preparing');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Result preparation exceeded the benchmark deadline');
};
try {
  const sourceId = revised.outcome.deliverables.find((item: { title: string }) => item.title === 'report.md').artifactId;
  const oldSourceId = original.outcome.deliverables.find((item: { title: string }) => item.title === 'report.md').artifactId;
  const oldTail = await ready(original, 'search', oldSourceId);
  const newTail = await ready(revised, 'search', sourceId);
  assert.match(JSON.stringify(oldTail), /CEDAR-/);
  assert.match(JSON.stringify(newTail), /MAPLE-/);
  const preparationWaitMs = performance.now() - prepareStart;
  const runs: Record<string, unknown> = {};
  for (const target of ['body', sourceId]) {
    await ready(revised, 'read', target);
    const durations: number[] = [];
    let maxOutputChars = 0;
    for (let index = 0; index < 50; index++) {
      const start = performance.now();
      const result = await readPersonalResult(revised.conversationId, { command: 'read', resultId: revised.deliveryId, sourceId: target });
      durations.push(performance.now() - start);
      assert.equal(result.status, 'ready', 'A preparing receipt is not a hot read');
      maxOutputChars = Math.max(maxOutputChars, Array.from(String(result.text ?? '')).length);
      assert.ok(maxOutputChars <= 8000);
    }
    runs[target === 'body' ? 'body' : 'reportArtifact'] = { ...latencyDistribution(durations), readyCount: 50, maxOutputChars };
  }
  const result = { success: true, runs, preparationWaitMs, sourceId, originalSourceId: oldSourceId,
    originalTailReadable: true, revisedTailReadable: true,
    scope: 'Local permission-checked result API against retained real-chain SQLite and published media. Cold preparation excluded; every measured read returned ready. No model calls or regenerated results.' };
  const output = input.replace(/\.json$/, '-reads.json');
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, ...result }));
} finally { await stopPersonalResultPreparations(); closeXopcDatabase(); }
