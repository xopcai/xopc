import { fork, type ChildProcess, type ForkOptions } from 'node:child_process';

export function forkWorker(modulePath: string, options: ForkOptions): ChildProcess {
  return fork(modulePath, [], options);
}
