import { execFile } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { redactText, type GradeResult, type GraderSpec } from '@agent-evals/protocol';
import type { ArtifactStore, EvalStore } from '@agent-evals/storage';
import { runShellCommand } from '@agent-evals/sandbox';

const execFileAsync = promisify(execFile);

export interface GradeContext {
  runId: string;
  workspace: string;
  artifactStore: ArtifactStore;
  store: EvalStore;
}

function finish(
  graderIndex: number,
  spec: GraderSpec,
  passed: boolean,
  summary: string,
  artifactRefs: string[],
  startedAt: number,
): GradeResult {
  return {
    graderIndex,
    graderType: spec.type,
    category: spec.category ?? (spec.type === 'unchanged' ? 'scope' : 'correctness'),
    required: spec.required ?? true,
    weight: Math.max(0, spec.weight ?? 1),
    passed,
    score: passed ? 1 : 0,
    summary,
    artifactRefs,
    durationMs: Date.now() - startedAt,
  };
}

function workspacePath(workspace: string, path: string): string {
  const absolute = resolve(workspace, path);
  const rel = relative(workspace, absolute);
  if (
    !rel ||
    rel === '..' ||
    rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(rel)
  ) {
    throw new Error('Path must resolve inside the evaluation workspace');
  }
  return absolute;
}

export async function runGrader(
  spec: GraderSpec,
  graderIndex: number,
  context: GradeContext,
): Promise<GradeResult> {
  const startedAt = Date.now();

  if (spec.type === 'command') {
    const hiddenRoot = resolve(context.workspace, '.xopc-eval-hidden');
    const hasHiddenFiles = (spec.hiddenFiles?.length ?? 0) > 0;
    let createdHiddenRoot = false;
    let result: Awaited<ReturnType<typeof runShellCommand>>;
    try {
      if (hasHiddenFiles) {
        try {
          await lstat(hiddenRoot);
          throw new Error('Reserved hidden-grader directory already exists in the workspace');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await mkdir(hiddenRoot);
        createdHiddenRoot = true;
      }
      for (const hiddenFile of spec.hiddenFiles ?? []) {
        const target = workspacePath(context.workspace, hiddenFile.target);
        const hiddenRelative = relative(hiddenRoot, target);
        if (
          !hiddenRelative ||
          hiddenRelative === '..' ||
          hiddenRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
          isAbsolute(hiddenRelative)
        ) {
          throw new Error('Hidden grader targets must stay inside .xopc-eval-hidden');
        }
        await mkdir(dirname(target), { recursive: true });
        await copyFile(hiddenFile.source, target);
      }
      result = await runShellCommand(spec.command, {
        cwd: context.workspace,
        timeoutMs: spec.timeoutMs ?? 5 * 60_000,
      });
    } finally {
      if (createdHiddenRoot) {
        await rm(hiddenRoot, { recursive: true, force: true });
      }
    }
    const artifact = context.artifactStore.putText(
      context.runId,
      `grader-${graderIndex}-command`,
      redactText(`$ ${spec.command}\n\nSTDOUT\n${result.stdout}\n\nSTDERR\n${result.stderr}`),
    );
    context.store.recordArtifact(artifact);
    return finish(
      graderIndex,
      spec,
      result.exitCode === 0,
      result.exitCode === 0 ? 'Command passed' : `Command failed with exit code ${result.exitCode}`,
      [artifact.id],
      startedAt,
    );
  }

  if (spec.type === 'unchanged') {
    const [tracked, untracked] = await Promise.all([
      execFileAsync(
        'git',
        ['diff', '--name-only', 'HEAD', '--', ...spec.paths],
        { cwd: context.workspace, timeout: 30_000 },
      ),
      execFileAsync(
        'git',
        ['ls-files', '--others', '--exclude-standard', '--', ...spec.paths],
        { cwd: context.workspace, timeout: 30_000 },
      ),
    ]);
    const changed = [...new Set(`${tracked.stdout}\n${untracked.stdout}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean))];
    return finish(
      graderIndex,
      spec,
      changed.length === 0,
      changed.length === 0 ? 'Protected paths were unchanged' : `Unexpected changes: ${changed.join(', ')}`,
      [],
      startedAt,
    );
  }

  try {
    const path = workspacePath(context.workspace, spec.path);
    const content = await readFile(path, 'utf8');
    const passed = content.includes(spec.text);
    return finish(
      graderIndex,
      spec,
      passed,
      passed ? `File contains expected text: ${spec.path}` : `Expected text not found in ${spec.path}`,
      [],
      startedAt,
    );
  } catch (error) {
    return finish(
      graderIndex,
      spec,
      false,
      `Unable to read ${spec.path}: ${error instanceof Error ? error.message : String(error)}`,
      [],
      startedAt,
    );
  }
}
