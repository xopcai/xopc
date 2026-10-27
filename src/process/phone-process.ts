import { execFile, spawn, type ChildProcess } from 'node:child_process';

export function runPhoneCommandBuffer(program: string, args: string[], signal?: AbortSignal, timeoutMs = 15_000): Promise<Buffer> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    execFile(program, args, { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs, signal, windowsHide: true },
      (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

export function runPhoneCommandText(program: string, args: string[], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    execFile(program, args, { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 10_000, signal, windowsHide: true },
      (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

export function spawnPhoneCommand(program: string, args: string[]): ChildProcess {
  return spawn(program, args, { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
}

export function spawnPhoneInteractiveCommand(program: string, args: string[]) {
  return spawn(program, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
}
