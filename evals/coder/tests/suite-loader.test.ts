import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadExperiment, loadSuite } from '@agent-evals/runner';
import { afterEach, describe, expect, it } from 'vitest';

describe('suite loaders', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    delete process.env.AGENT_EVALS_TEST_REPO;
  });

  it('resolves an environment-backed relative repository path from cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-evals-env-suite-'));
    roots.push(root);
    const path = join(root, 'suite.yaml');
    process.env.AGENT_EVALS_TEST_REPO = './relative-eval-repo';
    writeFileSync(path, `
id: env-local
version: "1"
cases:
  - id: case
    repo: { source: local, path: "\${AGENT_EVALS_TEST_REPO}", commit: HEAD }
    task: Fix it
    budget: { timeoutMs: 1000 }
    graders: [{ type: command, command: "true" }]
    tags: [smoke]
`);

    const suite = await loadSuite(path);

    expect(suite.cases[0]?.repo.path).toBe(join(process.cwd(), 'relative-eval-repo'));
  });

  it('loads a versioned suite and resolves repository paths relative to the suite', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-evals-suite-'));
    roots.push(root);
    const path = join(root, 'suite.yaml');
    writeFileSync(join(root, 'hidden.test.ts'), 'export {};\n');
    writeFileSync(path, `
id: local
version: "1"
cases:
  - id: case
    repo: { source: local, path: ./repo, commit: HEAD }
    task: Fix it
    budget: { timeoutMs: 1000 }
    graders:
      - type: command
        command: "true"
        hiddenFiles:
          - { source: ./hidden.test.ts, target: .xopc-eval-hidden/check.test.ts }
    tags: [smoke]
`);

    const suite = await loadSuite(path);

    expect(suite.cases[0]?.repo.path).toBe(join(root, 'repo'));
    expect(suite.cases[0]?.graders[0]).toMatchObject({
      type: 'command',
      hiddenFiles: [{
        source: realpathSync(join(root, 'hidden.test.ts')),
        target: '.xopc-eval-hidden/check.test.ts',
      }],
    });
    expect(suite.contentHash).toHaveLength(64);
  });

  it('rejects duplicate variant ids', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-evals-experiment-'));
    roots.push(root);
    const path = join(root, 'experiment.yaml');
    writeFileSync(path, `name: duplicate\nvariants:\n  - { id: same, adapter: mock }\n  - { id: same, adapter: xopc }\n`);

    await expect(loadExperiment(path)).rejects.toThrow('Duplicate variant id');
  });
});
