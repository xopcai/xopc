import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MockAdapter } from '@agent-evals/adapter-mock';
import type { EvalSuite, ExperimentSpec } from '@agent-evals/protocol';
import { EvalRunner } from '@agent-evals/runner';
import { ArtifactStore, EvalStore } from '@agent-evals/storage';
import { afterEach, describe, expect, it } from 'vitest';

describe('EvalRunner', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('runs paired variants, grades them, and records trajectories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-evals-runner-'));
    roots.push(root);
    const repo = join(root, 'repo');
    mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'eval@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Eval Test'], { cwd: repo });
    writeFileSync(join(repo, 'protected.txt'), 'keep\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repo });

    const suite: EvalSuite = {
      id: 'test-suite',
      version: '1',
      sourcePath: join(root, 'suite.yaml'),
      contentHash: 'suite-hash',
      cases: [{
        id: 'write-result',
        repo: { source: 'local', path: repo, commit: 'HEAD' },
        task: 'Write result.txt',
        budget: { timeoutMs: 10_000 },
        graders: [
          { type: 'file_contains', path: 'result.txt', text: 'done' },
          { type: 'unchanged', paths: ['protected.txt'] },
        ],
        tags: ['test'],
      }],
    };
    const experiment: ExperimentSpec = {
      name: 'paired',
      randomizeVariantOrder: false,
      variants: [
        { id: 'baseline', adapter: 'mock' },
        {
          id: 'candidate',
          adapter: 'mock',
          config: { writes: [{ path: 'result.txt', content: 'done\n' }] },
        },
      ],
    };
    const store = new EvalStore(join(root, 'evals.db'));
    const runner = new EvalRunner({
      store,
      artifactStore: new ArtifactStore(join(root, 'artifacts')),
      adapters: [new MockAdapter()],
    });

    const result = await runner.runExperiment(suite, experiment);

    expect(result.runs.map((run) => run.status)).toEqual(['failed', 'passed']);
    const detail = store.getExperiment(result.experimentId)!;
    expect(detail.runs).toHaveLength(2);
    const candidate = detail.runs.find((run) => run.variant_id === 'candidate')!;
    expect(candidate.source_commit).toMatch(/^[a-f0-9]{40}$/);
    expect(candidate.fixture_commit).toMatch(/^[a-f0-9]{40}$/);
    expect((JSON.parse(String(candidate.case_json)) as { repo: { commit: string } }).repo.commit)
      .toBe(candidate.source_commit);
    const run = store.getRun(String(candidate.id))!;
    expect(run.events.some((event) => event.type === 'tool.finished')).toBe(true);
    expect(run.events.map((event) => event.seq)).toEqual(
      Array.from({ length: run.events.length }, (_, index) => index + 1),
    );
    expect(run.scores).toHaveLength(2);
    expect(readFileSync(store.path).byteLength).toBeGreaterThan(0);

    const budgetResult = await runner.runExperiment({
      ...suite,
      id: 'budget-suite',
      cases: [{
        ...suite.cases[0]!,
        id: 'token-budget',
        budget: { timeoutMs: 10_000, maxTokens: 1 },
        graders: [{ type: 'command', command: 'node -e "process.exit(0)"' }],
      }],
    }, {
      name: 'budget',
      variants: [{ id: 'limited', adapter: 'mock' }],
    });
    expect(budgetResult.runs[0]?.status).toBe('budget_exceeded');
    const trend = store.listTrend({ suiteId: 'test-suite' });
    expect(trend).toHaveLength(2);
    expect(trend.find((row) => row.variant_id === 'candidate')).toMatchObject({
      run_count: 1,
      passed_count: 1,
      execution_failure_count: 0,
    });
    store.close();
  });
});
