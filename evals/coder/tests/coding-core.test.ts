import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentAdapter } from '@agent-evals/protocol';
import { EvalRunner, loadSuite } from '@agent-evals/runner';
import { ArtifactStore, EvalStore } from '@agent-evals/storage';
import { expect, it } from 'vitest';

it('calibrates every coding task against broken code and a reference repair', async () => {
  const root = mkdtempSync(join(tmpdir(), 'coding-core-calibration-'));
  const suiteDir = fileURLToPath(new URL('../suites/coding-core/', import.meta.url));
  const saved = { repo: process.env.EVAL_FIXTURE_REPO, commit: process.env.EVAL_FIXTURE_COMMIT };
  const fixture = JSON.parse(execFileSync(process.execPath, [join(suiteDir, 'create-fixture.mjs'), root], { encoding: 'utf8' })) as { repo: string; commit: string };
  const store = new EvalStore(join(root, 'evals.db'));
  try {
    process.env.EVAL_FIXTURE_REPO = fixture.repo;
    process.env.EVAL_FIXTURE_COMMIT = fixture.commit;
    const suite = await loadSuite(join(suiteDir, 'suite.yaml'));
    const adapter: AgentAdapter = {
      id: 'reference-calibration',
      async run(request) {
        if (request.variant.id === 'reference') {
          const files = request.evalCase.id === 'invoice' ? ['invoice', 'money'] : [request.evalCase.id];
          for (const name of files) {
            writeFileSync(join(request.environment.workspace, 'src', `${name}.mjs`), readFileSync(join(suiteDir, 'reference', `${name}.mjs`)));
          }
        }
        return { status: 'completed', finalText: 'Calibration only; no model was used.' };
      },
    };
    const runner = new EvalRunner({ store, artifactStore: new ArtifactStore(join(root, 'artifacts')), adapters: [adapter] });
    const result = await runner.runExperiment(suite, {
      name: 'fixture calibration', randomizeVariantOrder: false,
      variants: [{ id: 'broken', adapter: adapter.id }, { id: 'reference', adapter: adapter.id }],
    });
    expect(result.runs).toHaveLength(16);
    for (let i = 0; i < result.runs.length; i += 2) {
      expect(result.runs[i]?.grades[0]?.passed, suite.cases[i / 2]?.id).toBe(false);
      expect(result.runs[i]?.grades.slice(1).every(grade => grade.passed)).toBe(true);
      expect(result.runs[i + 1]?.status, JSON.stringify(result.runs[i + 1]?.grades)).toBe('passed');
    }
  } finally {
    if (saved.repo === undefined) delete process.env.EVAL_FIXTURE_REPO; else process.env.EVAL_FIXTURE_REPO = saved.repo;
    if (saved.commit === undefined) delete process.env.EVAL_FIXTURE_COMMIT; else process.env.EVAL_FIXTURE_COMMIT = saved.commit;
    store.close(); rmSync(root, { recursive: true, force: true });
  }
}, 120_000);
