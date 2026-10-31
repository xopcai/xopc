import { join } from 'node:path';

import { utilityProcess, type UtilityProcess } from 'electron';

/** Network and parsing are isolated from both local main and the independent recovery window. */
export class ShellController {
  private child: UtilityProcess;
  private sequence = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private exited = false;
  private stopping = false;
  private exit: Promise<void>;
  constructor(mainDirectory: string, onCrash: () => void) {
    this.child = utilityProcess.fork(join(mainDirectory, 'remote-shell-worker.js'), [], { stdio: 'ignore', serviceName: 'xopc Desktop Shell' });
    this.exit = new Promise(resolve => this.child.once('exit', () => {
      this.exited = true;
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('SHELL_PROCESS_EXITED')); }
      this.pending.clear(); resolve(); if (!this.stopping) onCrash();
    }));
    this.child.on('message', message => {
      const request = this.pending.get(message?.id);
      if (!request) return;
      clearTimeout(request.timer); this.pending.delete(message.id);
      if (message.ok) request.resolve(message.value);
      else request.reject(new Error(/^[A-Z_]+$/.test(message.error) ? message.error : 'SHELL_FAILED'));
    });
  }
  request<T>(command: string, data: Record<string, unknown> = {}): Promise<T> {
    if (this.exited) return Promise.reject(new Error('SHELL_PROCESS_EXITED'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('SHELL_PROCESS_TIMEOUT')); }, 15_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { this.child.postMessage({ id, command, ...data }); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error('SHELL_PROCESS_EXITED')); }
    });
  }
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.exited) return;
    void this.request('stop').catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.exit, new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => {
          this.child.kill();
          this.exit.then(resolve);
          timer = setTimeout(() => reject(new Error('SHELL_STOP_UNCONFIRMED')), 5000);
        }, 5000);
      })]);
    } finally { clearTimeout(timer); }
  }
}
