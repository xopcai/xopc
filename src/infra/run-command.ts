// src/infra/run-command.ts

import { spawn } from 'node:child_process';

export type CommandRunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  argv: string[],
  options: { timeoutMs: number; cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<CommandRunResult>;

const MAX_CAPTURE_BYTES = 512 * 1024;

function appendCaptured(current: string, chunk: Buffer): string {
  const next = current + chunk.toString();
  if (next.length <= MAX_CAPTURE_BYTES) {
    return next;
  }
  return next.slice(-MAX_CAPTURE_BYTES);
}

export function createDefaultCommandRunner(): CommandRunner {
  return (argv, options) => runCommandWithTimeout(argv, options);
}

export function runCommandWithTimeout(
  argv: string[],
  options: { timeoutMs: number; cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<CommandRunResult> {
  const [command, ...args] = argv;
  if (!command) {
    return Promise.resolve({ code: 1, stdout: '', stderr: 'empty argv' });
  }

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(process.platform === 'win32'
        ? { shell: (process.env.ComSpec && process.env.ComSpec.trim()) || 'cmd.exe' }
        : {}),
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result: CommandRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
    }, options.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendCaptured(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendCaptured(stderr, chunk);
    });

    child.on('error', (err) => {
      finish({ code: null, stdout, stderr: stderr || err.message });
    });

    child.on('close', (code) => {
      finish({ code, stdout, stderr });
    });
  });
}
