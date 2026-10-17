import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentAdapter } from '@agent-evals/protocol';
import { EvalRunner, loadSuite } from '@agent-evals/runner';
import { ArtifactStore, EvalStore } from '@agent-evals/storage';
import { expect, it } from 'vitest';

import { calibrationAdapter } from '../apps/cli/src/benchmark-calibration.js';

it('calibrates all ten tasks and rejects false claims, wrong facts, fabricated prices and hardcoded reproduction', async () => {
  const root = mkdtempSync(join(tmpdir(), 'xopc-core-calibration-'));
  const suiteDir = fileURLToPath(new URL('../suites/xopc-core/', import.meta.url));
  const saved = { repo: process.env.EVAL_FIXTURE_REPO, commit: process.env.EVAL_FIXTURE_COMMIT };
  const fixture = JSON.parse(execFileSync(process.execPath, [join(suiteDir, 'create-fixture.mjs'), root], { encoding: 'utf8' })) as { repo: string; commit: string };
  const store = new EvalStore(join(root, 'evals.db'));
  try {
    process.env.EVAL_FIXTURE_REPO = fixture.repo;
    process.env.EVAL_FIXTURE_COMMIT = fixture.commit;
    const repeatedFixture = JSON.parse(execFileSync(process.execPath, [join(suiteDir, 'create-fixture.mjs'), root], { encoding: 'utf8' })) as { commit: string };
    expect(repeatedFixture.commit).toBe(fixture.commit);
    const suite = await loadSuite(join(suiteDir, 'suite.yaml'));
    expect(suite.cases).toHaveLength(10);
    expect(suite.cases.filter(c => c.tags.includes('research'))).toHaveLength(3);
    expect(suite.cases.filter(c => c.tags.includes('data'))).toHaveLength(3);
    expect(suite.cases.filter(c => c.tags.includes('change'))).toHaveLength(2);
    expect(suite.cases.filter(c => c.tags.includes('recovery'))).toHaveLength(2);
    const reference = calibrationAdapter();
    const adapter: AgentAdapter = {
      id: reference.id,
      async run(request, onEvent, signal) {
        const result = await reference.run(request, onEvent, signal);
        if (request.variant.id !== 'corrupt') return result;
        const path = join(request.environment.workspace, 'result.json');
        const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        const id = request.evalCase.id;
        if (id === 'R01-price-comparison') value.sourceIds = ['fabricated'];
        else if (id === 'R02-conflicting-source') value.acceptedCentsPerHour = 1200;
        else if (id === 'R03-missing-evidence') { value.ttsCents = 0; value.totalCents = 120; }
        else if (id.startsWith('D')) writeFileSync(join(request.environment.workspace, 'reproduce.mjs'), `import {writeFileSync} from 'node:fs';writeFileSync('result.json', ${JSON.stringify(JSON.stringify(value))});`);
        else if (id === 'C01-add-deliverable') rmSync(join(request.environment.workspace, 'change_notes.md'));
        else if (id === 'C02-replace-scope') value.region = 'all';
        else if (id === 'F01-lost-artifact') rmSync(join(request.environment.workspace, 'report.md'));
        else writeFileSync(join(request.environment.workspace, '.retry-attempts'), '1');
        writeFileSync(path, JSON.stringify(value));
        return result;
      },
    };
    const runner = new EvalRunner({ store, artifactStore: new ArtifactStore(join(root, 'artifacts')), adapters: [adapter] });
    const result = await runner.runExperiment(suite, {
      name: 'v1 oracle calibration', randomizeVariantOrder: false,
      variants: ['broken', 'reference', 'corrupt'].map(id => ({ id, adapter: adapter.id })),
    });
    expect(result.runs).toHaveLength(30);
    for (let i = 0; i < result.runs.length; i += 3) {
      expect(result.runs[i]?.status, suite.cases[i / 3]?.id).toBe('failed');
      expect(result.runs[i + 1]?.status, JSON.stringify(result.runs[i + 1]?.grades)).toBe('passed');
      expect(result.runs[i + 2]?.grades[0]?.passed, suite.cases[i / 3]?.id).toBe(false);
      expect(result.runs[i + 2]?.grades[1]?.passed).toBe(true);
    }
    const same = await loadSuite(join(suiteDir, 'suite.yaml'));
    expect(same.contentHash).toBe(suite.contentHash);
    const citations: AgentAdapter = {
      id: 'citation-calibration',
      async run(request, onEvent, signal) {
        const result = await reference.run(request, onEvent, signal);
        const path = join(request.environment.workspace, 'result.json');
        const value = JSON.parse(readFileSync(path, 'utf8'));
        value.sourceIds = request.variant.id === 'known' ? ['secondary-note', 'primary-b', 'primary-a']
          : request.variant.id === 'unknown' ? ['primary-a', 'invented'] : ['primary-b'];
        writeFileSync(path, JSON.stringify(value));
        return result;
      },
    };
    const citationResults = await new EvalRunner({ store, artifactStore: new ArtifactStore(join(root, 'artifacts')), adapters: [citations] })
      .runExperiment({ ...suite, cases: suite.cases.filter(c => c.id === 'R03-missing-evidence') }, {
        name: 'consulted citation calibration', randomizeVariantOrder: false,
        variants: ['known', 'unknown', 'missing'].map(id => ({ id, adapter: citations.id })),
      });
    expect(citationResults.runs.map(run => run.status)).toEqual(['passed', 'failed', 'failed']);

  } finally {
    if (saved.repo === undefined) delete process.env.EVAL_FIXTURE_REPO; else process.env.EVAL_FIXTURE_REPO = saved.repo;
    if (saved.commit === undefined) delete process.env.EVAL_FIXTURE_COMMIT; else process.env.EVAL_FIXTURE_COMMIT = saved.commit;
    store.close(); rmSync(root, { recursive: true, force: true });
  }
}, 120_000);
