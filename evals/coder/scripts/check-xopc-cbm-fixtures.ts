import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { CommandGraderSpec } from '@agent-evals/protocol';
import { loadSuite } from '@agent-evals/runner';
import { GitCloneSandbox, runShellCommand } from '@agent-evals/sandbox';

const { values } = parseArgs({
  options: {
    case: { type: 'string' },
  },
});

const repositoryRoot = resolve(import.meta.dirname, '../../..');
process.env.XOPC_EVAL_REPO ??= repositoryRoot;
const suite = await loadSuite(join(
  repositoryRoot,
  'evals/coder/suites/xopc-cbm-pilot/suite.yaml',
));
const selected = values.case
  ? suite.cases.filter((evalCase) => evalCase.id === values.case)
  : suite.cases;
if (selected.length === 0) throw new Error(`Unknown pilot case: ${values.case}`);

const sandbox = new GitCloneSandbox();
try {
  for (const evalCase of selected) {
    const environment = await sandbox.prepare(evalCase);
    try {
      const grader = evalCase.graders.find(
        (candidate): candidate is CommandGraderSpec => candidate.type === 'command',
      );
      if (!grader?.hiddenFiles?.length) {
        throw new Error(`Case ${evalCase.id} has no hidden behavior grader`);
      }
      for (const hiddenFile of grader.hiddenFiles) {
        const target = join(environment.workspace, hiddenFile.target);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(hiddenFile.source, target);
      }
      const result = await runShellCommand(grader.command, {
        cwd: environment.workspace,
        timeoutMs: grader.timeoutMs ?? 5 * 60_000,
      });
      if (result.exitCode === 0) {
        throw new Error(`Seeded fixture unexpectedly passes: ${evalCase.id}`);
      }
      console.log(`verified failing fixture ${evalCase.id}`);
    } finally {
      await rm(join(environment.workspace, '.xopc-eval-hidden'), {
        recursive: true,
        force: true,
      });
      sandbox.cleanup(environment);
    }
  }
} finally {
  await sandbox.cleanupAll();
}
