import { performance } from 'node:perf_hooks';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createReadFileTool } from '../src/agent/tools/read.js';
import { createDataBatchTool } from '../src/agent/tools/dataBatch.js';

const root = await mkdtemp(join(tmpdir(), 'xopc-data-bench-'));
try {
  const paths = Array.from({ length: 8 }, (_, i) => `meeting-${i}.md`);
  await Promise.all(paths.map((path, i) => writeFile(join(root, path),
    `# Meeting ${i}\nOwner: team-${i}\nDecision: ship-${i}\n${'Reference material.\n'.repeat(1000)}`)));
  const read = createReadFileTool(root);
  const batch = createDataBatchTool(root, () => new Set(['read_file']));
  for (const mode of ['sequential', 'parallel', 'batch'] as const) {
    const durations: number[] = [];
    let outputChars = 0;
    for (let repeat = 0; repeat < 6; repeat++) {
      const start = performance.now();
      const results = [];
      if (mode === 'sequential') {
        for (const path of paths) results.push(await read.execute(path, { path, limit: 4 }));
      } else if (mode === 'parallel') {
        results.push(...await Promise.all(paths.map(path => read.execute(path, { path, limit: 4 }))));
      } else {
        results.push(await batch.execute('batch', { operations: paths.map((path, i) => ({ id: `r${i}`, kind: 'file_read', path, maxLines: 4 })) }));
      }
      const text = results.flatMap(result => result.content).map(block => block.type === 'text' ? block.text : '').join('\n');
      for (let i = 0; i < paths.length; i++) {
        if (!text.includes(`ship-${i}`)) throw new Error(`Missing evidence: ${i}`);
      }
      outputChars = text.length;
      if (repeat > 0) durations.push(performance.now() - start);
    }
    durations.sort((a, b) => a - b);
    console.log(JSON.stringify({ mode, medianMs: durations[2], outputChars, toolCalls: mode === 'batch' ? 1 : paths.length, modelRequests: null }));
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
