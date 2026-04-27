// src/infra/update-runner.ts

import { spawn } from 'node:child_process';
import { access, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { createLogger } from '../utils/logger.js';

import type { UpdateChannel } from './update-channels.js';

const log = createLogger('UpdateRunner');

const AUTO_UPDATE_TIMEOUT_MS = 45 * 60 * 1000; // 45 minutes

export type AutoUpdateResult = {
  ok: boolean;
  exitCode: number | null;
  reason?: string;
  stdout?: string;
  stderr?: string;
};

type SpawnUpdateParams = {
  channel: UpdateChannel;
  root?: string | null;
  timeoutMs?: number;
  onProgress?: (line: string, source: 'stdout' | 'stderr') => void | Promise<void>;
};

function createLineEmitter(
  onProgress?: (line: string, source: 'stdout' | 'stderr') => void | Promise<void>,
) {
  let bufOut = '';
  let bufErr = '';
  const flush = (buf: string, source: 'stdout' | 'stderr'): string => {
    const parts = buf.split('\n');
    const rest = parts.pop() ?? '';
    for (const line of parts) {
      if (line.length) void onProgress?.(line, source);
    }
    return rest;
  };
  return {
    pushStdout(chunk: string) {
      bufOut += chunk;
      bufOut = flush(bufOut, 'stdout');
    },
    pushStderr(chunk: string) {
      bufErr += chunk;
      bufErr = flush(bufErr, 'stderr');
    },
    flushEnd() {
      if (bufOut.length) void onProgress?.(bufOut, 'stdout');
      if (bufErr.length) void onProgress?.(bufErr, 'stderr');
    },
  };
}

async function spawnUpdateCommand(params: SpawnUpdateParams): Promise<AutoUpdateResult> {
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
    let stdoutTruncated = false;
    let stderrTruncated = false;

    const lineEmitter = createLineEmitter(params.onProgress);

    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);

    const finish = (result: AutoUpdateResult) => {
      clearTimeout(timeoutId);
      lineEmitter.flushEnd();
      resolve(result);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      lineEmitter.pushStdout(text);
      if (stdout.length > 64_000) {
        if (!stdoutTruncated) {
          log.warn('Update command stdout exceeded 64KB; truncating');
          stdoutTruncated = true;
        }
        stdout = stdout.slice(-32_000);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      lineEmitter.pushStderr(text);
      if (stderr.length > 64_000) {
        if (!stderrTruncated) {
          log.warn('Update command stderr exceeded 64KB; truncating');
          stderrTruncated = true;
        }
        stderr = stderr.slice(-32_000);
      }
    });

    child.on('error', (err) => {
      log.error({ err }, `Update subprocess spawn error: ${err.message}`);
      finish({ ok: false, exitCode: null, reason: err.message, stdout, stderr });
    });

    child.on('exit', (code, signal) => {
      if (signal === 'SIGTERM' || code === 143) {
        log.warn({ code, signal }, 'Update subprocess timed out; attempting lock file cleanup');
        void cleanupNpmLockFiles(params.root).catch((cleanupErr) => {
          log.warn({ err: cleanupErr }, 'Failed to clean npm lock files after timeout');
        });
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

export async function runAutoUpdateCommand(params: {
  channel: UpdateChannel;
  root?: string | null;
  timeoutMs?: number;
}): Promise<AutoUpdateResult> {
  return spawnUpdateCommand(params);
}

export async function runAutoUpdateCommandWithProgress(params: {
  channel: UpdateChannel;
  root?: string | null;
  timeoutMs?: number;
  onProgress?: (line: string, source: 'stdout' | 'stderr') => void | Promise<void>;
}): Promise<AutoUpdateResult> {
  return spawnUpdateCommand(params);
}

async function cleanupNpmLockFiles(root: string | null | undefined): Promise<void> {
  if (!root) return;
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith('.package-lock')) {
      try {
        await unlink(join(root, entry));
      } catch {
        // best-effort
      }
    }
  }
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

  if (execPath && argv1) {
    return [execPath, argv1, ...baseArgs];
  }

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

  log.warn('Falling back to bare `xopc` command — version mismatch possible');
  try {
    const { execSync } = await import('node:child_process');
    const cmd = process.platform === 'win32' ? 'where xopc' : 'which xopc';
    const whichResult = execSync(cmd, { encoding: 'utf-8', timeout: 3000 }).trim();
    if (whichResult) {
      log.info({ resolvedPath: whichResult.split(/\r?\n/)[0]?.trim() }, 'Resolved xopc via PATH');
    }
  } catch {
    log.warn('Could not resolve `xopc` in PATH; update command may fail');
  }

  return ['xopc', ...baseArgs];
}
