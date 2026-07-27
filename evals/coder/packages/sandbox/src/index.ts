import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { EvalCase, PreparedEnvironment } from '@agent-evals/protocol';

const execFileAsync = promisify(execFile);
const DEFAULT_EXCLUDED_PATHS = ['evals', '.agent-evals', '.xopc-evals'];

function safeWorkspacePath(workspace: string, path: string): string {
  if (!path.trim() || isAbsolute(path)) {
    throw new Error(`Sanitized path must be relative: ${path}`);
  }
  const target = resolve(workspace, normalize(path));
  const rel = relative(workspace, target);
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`Sanitized path must resolve inside the workspace: ${path}`);
  }
  return target;
}

async function git(workspace: string, args: string[], timeout = 30_000): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: workspace,
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function commitAll(workspace: string, message: string): Promise<string> {
  await git(workspace, ['add', '-A']);
  await git(workspace, ['commit', '--quiet', '--allow-empty', '-m', message]);
  return (await git(workspace, ['rev-parse', 'HEAD'])).trim();
}

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export async function runShellCommand(
  command: string,
  options: { cwd: string; timeoutMs: number; signal?: AbortSignal },
): Promise<CommandResult> {
  const started = Date.now();
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command];
  try {
    const { stdout, stderr } = await execFileAsync(shell, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      signal: options.signal,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    });
    return { command, exitCode: 0, stdout, stderr, durationMs: Date.now() - started };
  } catch (error) {
    const typed = error as Error & { code?: number | string; stdout?: string; stderr?: string };
    return {
      command,
      exitCode: typeof typed.code === 'number' ? typed.code : 1,
      stdout: typed.stdout ?? '',
      stderr: typed.stderr ?? typed.message,
      durationMs: Date.now() - started,
    };
  }
}

export class GitCloneSandbox {
  private readonly roots = new Set<string>();

  async prepare(evalCase: EvalCase): Promise<PreparedEnvironment> {
    const root = mkdtempSync(join(tmpdir(), `agent-eval-${evalCase.id}-`));
    this.roots.add(root);
    const workspace = join(root, 'workspace');
    const source = evalCase.repo.source === 'local'
      ? evalCase.repo.path ? resolve(evalCase.repo.path) : undefined
      : evalCase.repo.url;
    if (!source) throw new Error(`Eval case ${evalCase.id} is missing a repository source`);

    await execFileAsync('git', ['clone', '--quiet', '--no-hardlinks', source, workspace], {
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    await execFileAsync('git', ['checkout', '--quiet', '--detach', evalCase.repo.commit], {
      cwd: workspace,
      timeout: 30_000,
    });
    const sourceCommit = (await git(workspace, ['rev-parse', 'HEAD'])).trim();
    await git(workspace, ['config', 'user.email', 'coder-evals@xopc.ai']);
    await git(workspace, ['config', 'user.name', 'xopc Coder Evals']);
    const sanitize = evalCase.repo.sanitize?.enabled ?? true;
    const excludedPaths = [
      ...DEFAULT_EXCLUDED_PATHS,
      ...(evalCase.repo.sanitize?.excludePaths ?? []),
    ];

    if (sanitize) {
      for (const path of new Set(excludedPaths)) {
        rmSync(safeWorkspacePath(workspace, path), { recursive: true, force: true });
      }
      rmSync(join(workspace, '.git'), { recursive: true, force: true });
      await git(workspace, ['init', '--quiet']);
      await git(workspace, ['config', 'user.email', 'coder-evals@xopc.ai']);
      await git(workspace, ['config', 'user.name', 'xopc Coder Evals']);
      await commitAll(workspace, `Evaluation source ${sourceCommit}`);
    }

    for (const command of evalCase.prepare ?? []) {
      const result = await runShellCommand(command, {
        cwd: workspace,
        timeoutMs: Math.min(evalCase.budget.timeoutMs, 10 * 60_000),
      });
      if (result.exitCode !== 0) {
        throw new Error(`Prepare command failed: ${command}\n${result.stderr}`);
      }
    }
    const prepareChanges = (await git(
      workspace,
      ['status', '--porcelain', '--untracked-files=all'],
    )).trim();
    if (prepareChanges) {
      throw new Error(
        `Prepare commands must not mutate source-controlled files:\n${prepareChanges}`,
      );
    }

    for (const command of evalCase.setup ?? []) {
      const result = await runShellCommand(command, {
        cwd: workspace,
        timeoutMs: Math.min(evalCase.budget.timeoutMs, 10 * 60_000),
      });
      if (result.exitCode !== 0) {
        throw new Error(`Setup command failed: ${command}\n${result.stderr}`);
      }
    }
    const fixtureCommit = await commitAll(workspace, `Evaluation fixture ${evalCase.id}`);

    return {
      workspace,
      sourceCommit,
      fixtureCommit,
      metadata: {
        sandbox: sanitize ? 'sanitized-git-clone' : 'git-clone',
        root,
        sourceCommit,
        fixtureCommit,
        sanitized: sanitize,
        excludedPaths: sanitize ? [...new Set(excludedPaths)] : [],
        prepareCommandCount: evalCase.prepare?.length ?? 0,
      },
    };
  }

  async diff(workspace: string): Promise<string> {
    const { stdout } = await execFileAsync('git', ['diff', '--binary', 'HEAD'], {
      cwd: workspace,
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const { stdout: untracked } = await execFileAsync(
      'git',
      ['ls-files', '--others', '--exclude-standard'],
      { cwd: workspace, timeout: 30_000 },
    );
    const patches: string[] = [stdout];
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    for (const file of untracked.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
      try {
        await execFileAsync('git', ['diff', '--no-index', '--binary', '--', nullDevice, file], {
          cwd: workspace,
          timeout: 30_000,
          maxBuffer: 4 * 1024 * 1024,
        });
      } catch (error) {
        const diff = error as Error & { stdout?: string };
        if (diff.stdout) patches.push(diff.stdout);
        else patches.push(`\n# Untracked file: ${file}\n`);
      }
    }
    return patches.join('');
  }

  cleanup(environment: PreparedEnvironment): void {
    const root = typeof environment.metadata.root === 'string'
      ? environment.metadata.root
      : undefined;
    if (!root || !this.roots.has(root)) return;
    this.roots.delete(root);
    rmSync(root, { recursive: true, force: true });
  }

  cleanupAll(): void {
    for (const root of this.roots) rmSync(root, { recursive: true, force: true });
    this.roots.clear();
  }
}
