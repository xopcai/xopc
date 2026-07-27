import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EvalCase } from '@agent-evals/protocol';
import { GitCloneSandbox } from '@agent-evals/sandbox';
import { afterEach, describe, expect, it } from 'vitest';

describe('GitCloneSandbox', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('removes evaluator sources and commits setup as the agent diff baseline', async () => {
    const root = mkdtempSync(join(tmpdir(), 'coder-evals-sandbox-'));
    roots.push(root);
    const repo = join(root, 'repo');
    mkdirSync(join(repo, 'evals', 'coder', 'suites'), { recursive: true });
    writeFileSync(join(repo, 'source.ts'), 'export const value = 1;\n');
    writeFileSync(join(repo, '.gitignore'), 'node_modules/\n');
    writeFileSync(join(repo, 'evals', 'coder', 'suites', 'hidden.yaml'), 'answer: secret\n');
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'eval@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Eval Test'], { cwd: repo });
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repo });

    const evalCase: EvalCase = {
      id: 'sanitized',
      repo: { source: 'local', path: repo, commit: 'HEAD' },
      task: 'Fix source.ts',
      prepare: [
        'node -e "require(\'node:fs\').mkdirSync(\'node_modules/cache\', { recursive: true })"',
      ],
      setup: ['node -e "require(\'node:fs\').appendFileSync(\'source.ts\', \'// seeded\\n\')"'],
      budget: { timeoutMs: 30_000 },
      graders: [{ type: 'command', command: 'true' }],
      tags: [],
    };
    const sandbox = new GitCloneSandbox();
    const environment = await sandbox.prepare(evalCase);

    try {
      expect(existsSync(join(environment.workspace, 'evals'))).toBe(false);
      expect(environment.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
      expect(environment.fixtureCommit).toMatch(/^[a-f0-9]{40}$/);
      expect(environment.metadata.prepareCommandCount).toBe(1);
      expect(await sandbox.diff(environment.workspace)).toBe('');
      expect(() => execFileSync(
        'git',
        ['show', 'HEAD:evals/coder/suites/hidden.yaml'],
        { cwd: environment.workspace, stdio: 'pipe' },
      )).toThrow();
    } finally {
      sandbox.cleanup(environment);
    }
  });

  it('rejects prepare commands that mutate the source fixture', async () => {
    const root = mkdtempSync(join(tmpdir(), 'coder-evals-prepare-'));
    roots.push(root);
    const repo = join(root, 'repo');
    mkdirSync(repo);
    writeFileSync(join(repo, 'source.ts'), 'export const value = 1;\n');
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'eval@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Eval Test'], { cwd: repo });
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repo });

    const sandbox = new GitCloneSandbox();
    await expect(sandbox.prepare({
      id: 'mutating-prepare',
      repo: { source: 'local', path: repo, commit: 'HEAD' },
      task: 'Fix source.ts',
      prepare: ['node -e "require(\'node:fs\').appendFileSync(\'source.ts\', \'changed\\n\')"'],
      budget: { timeoutMs: 30_000 },
      graders: [{ type: 'command', command: 'true' }],
      tags: [],
    })).rejects.toThrow('Prepare commands must not mutate source-controlled files');
    await sandbox.cleanupAll();
  });
});
