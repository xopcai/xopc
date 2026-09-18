// src/infra/run-command.ts

import { runProcess } from '../process/run-process.js';

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

  return runProcess({
    program: command,
    args,
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs,
    maxOutputBytes: MAX_CAPTURE_BYTES,
    terminationPolicy: 'tree',
    ...(process.platform === 'win32'
      ? { shell: (process.env.ComSpec && process.env.ComSpec.trim()) || 'cmd.exe' }
      : {}),
  }).then(result => ({ code: result.exitCode, stdout: result.stdout, stderr: result.stderr }));
}
