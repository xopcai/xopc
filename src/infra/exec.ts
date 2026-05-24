import { execFile, spawn } from 'node:child_process';

export type ExecResult = {
  stdout: string;
  stderr: string;
};

export type ExecOptions = {
  timeoutMs?: number;
  maxBuffer?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

function execFileAsync(
  file: string,
  args: string[],
  opts: ExecOptions,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: 'utf8',
        maxBuffer: opts.maxBuffer ?? 1_024 * 1024,
        cwd: opts.cwd,
        env: opts.env,
        timeout: opts.timeoutMs,
      },
      (err, stdout, stderr) => {
        if (err) {
          const enriched = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
          enriched.stdout = typeof stdout === 'string' ? stdout : String(stdout ?? '');
          enriched.stderr = typeof stderr === 'string' ? stderr : String(stderr ?? '');
          reject(enriched);
          return;
        }
        resolve({
          stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
          stderr: typeof stderr === 'string' ? stderr : String(stderr ?? ''),
        });
      },
    );
  });
}

/** Run a subprocess and capture stdout/stderr (OpenClaw-aligned). */
export async function runExec(
  file: string,
  args: string[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  return execFileAsync(file, args, opts);
}

export function spawnDetached(
  file: string,
  args: string[],
  opts: { stdio?: 'ignore' | 'pipe' },
): ReturnType<typeof spawn> {
  return spawn(file, args, {
    stdio: opts.stdio ?? 'ignore',
    detached: false,
  });
}
