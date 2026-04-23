// src/infra/update-runner.ts

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

const AUTO_UPDATE_TIMEOUT_MS = 45 * 60 * 1000; // 45 minutes

export type AutoUpdateResult = {
  ok: boolean;
  exitCode: number | null;
  reason?: string;
  stdout?: string;
  stderr?: string;
};

/**
 * Spawn a child process to execute `xopc update --yes --channel <channel> --json`.
 * Uses the current runtime (process.execPath) and entry point (process.argv[1]) to
 * ensure the correct Node.js version and binary path are used.
 */
export async function runAutoUpdateCommand(params: {
  channel: 'stable' | 'beta';
  root?: string | null;
  timeoutMs?: number;
}): Promise<AutoUpdateResult> {
  const timeoutMs = params.timeoutMs ?? AUTO_UPDATE_TIMEOUT_MS;
  const baseArgs = ['update', '--yes', '--channel', params.channel, '--json'];

  const argv = await resolveUpdateCommandArgv(baseArgs, params.root ?? null);

  return new Promise<AutoUpdateResult>((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      env: {
        ...process.env,
        XOPC_AUTO_UPDATE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    let stdout = '';
    let stderr = '';

    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);

    const finish = (result: AutoUpdateResult) => {
      clearTimeout(timeoutId);
      resolve(result);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 64_000) stdout = stdout.slice(-32_000);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });

    child.on('error', (err) => {
      finish({ ok: false, exitCode: null, reason: String(err), stdout, stderr });
    });

    child.on('exit', (code, signal) => {
      if (signal === 'SIGTERM' || code === 143) {
        finish({ ok: false, exitCode: code, reason: 'timeout', stdout, stderr });
        return;
      }
      finish({
        ok: code === 0,
        exitCode: code,
        reason: code === 0 ? undefined : 'non-zero-exit',
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Resolve the argv array for spawning the update command.
 *
 * Priority:
 * 1. process.execPath + process.argv[1] (current runtime + entry point)
 * 2. process.execPath + known dist entry points in root
 * 3. Fallback to bare `xopc` (assumes global install)
 */
async function resolveUpdateCommandArgv(
  baseArgs: string[],
  root: string | null,
): Promise<string[]> {
  const execPath = process.execPath?.trim();
  const argv1 = process.argv[1]?.trim();

  // Best case: we know both the runtime and the entry point
  if (execPath && argv1) {
    return [execPath, argv1, ...baseArgs];
  }

  // Try known entry points in the package root
  if (execPath && root) {
    const candidates = [join(root, 'dist/src/cli/index.js'), join(root, 'dist/index.js')];
    for (const candidate of candidates) {
      try {
        await access(candidate);
        return [execPath, candidate, ...baseArgs];
      } catch {
        // try next
      }
    }
  }

  // Fallback: rely on global PATH
  return ['xopc', ...baseArgs];
}
