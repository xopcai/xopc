import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { MockAdapter } from '../coder/packages/adapters/mock/src/index.js';
import { EvalRunner } from '../coder/packages/runner/src/index.js';
import { ArtifactStore, EvalStore } from '../coder/packages/storage/src/index.js';
import type { EvalSuite } from '../coder/packages/protocol/src/index.js';

const output = resolve(process.argv[2] ?? '.xopc-evals/control/concurrency-acceptance.json');
if (existsSync(output)) throw new Error('Refusing to overwrite acceptance evidence');
const root = mkdtempSync(join(tmpdir(), 'xopc-concurrency-'));
const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
try {
  git(['init', '-q']); git(['config', 'user.email', 'eval@example.com']); git(['config', 'user.name', 'Eval']);
  writeFileSync(join(root, 'protected.txt'), 'keep'); git(['add', '.']); git(['commit', '-qm', 'fixture']);
  const suite: EvalSuite = { id: 'control-concurrency', version: '1', contentHash: 'synthetic-8-v1', sourcePath: '',
    cases: Array.from({ length: 8 }, (_, i) => ({ id: `task-${i}`, repo: { source: 'local', path: root, commit: 'HEAD' }, task: 'write result',
      budget: { timeoutMs: 15000 }, tags: ['synthetic'], graders: [{ type: 'file_contains', path: 'result.txt', text: 'done' }, { type: 'unchanged', paths: ['protected.txt'] }] })) };
  const execute = async (concurrency: number) => {
    const directory = join(root, String(concurrency)); mkdirSync(directory);
    const store = new EvalStore(join(directory, 'evals.db'));
    let peak = 0; const start = performance.now();
    try {
      const result = await new EvalRunner({ store, adapters: [new MockAdapter()], artifactStore: new ArtifactStore(join(directory, 'artifacts')),
        onSchedule: state => { peak = Math.max(peak, state.active); } }).runExperiment(suite, { name: 'controlled-delay', concurrency,
        variants: [{ id: 'control', adapter: 'mock', config: { delayMs: 400, writes: [{ path: 'result.txt', content: 'done' }] } }] });
      return { concurrency, durationMs: performance.now() - start, peak, total: result.runs.length, passed: result.runs.filter(r => r.status === 'passed').length };
    } finally { store.close(); }
  };
  const serial = await execute(1); const parallel = await execute(4);
  const ratio = parallel.durationMs / serial.durationMs;
  const report = { evidenceClass: 'harness_calibration', modelCalls: 0, createdAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform },
    scope: '8 isolated Git workspaces, controlled 400ms mock adapter, actual runner preparation/diff/grading/cleanup included; not model speed', serial, parallel, ratio,
    passed: serial.passed === 8 && parallel.passed === 8 && parallel.peak <= 4 && ratio <= .6 };
  mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1;
} finally { rmSync(root, { recursive: true, force: true }); }
