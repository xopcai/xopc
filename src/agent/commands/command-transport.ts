import type { ChildProcess } from 'node:child_process';
import type { IPty } from 'node-pty';

import { spawnProcess } from '../../process/run-process.js';

export interface CommandTransport {
  completion: Promise<{ exitCode: number | null }>;
  write(text: string, end?: boolean): boolean;
  resize?(cols: number, rows: number): void;
  stop(reason: 'timed_out' | 'cancelled'): void;
}

export async function startCommandTransport(input: {
  program: string; args: string[]; shell: boolean; cwd: string; env: NodeJS.ProcessEnv;
  tty?: boolean; cols?: number; rows?: number;
  onOutput: (stream: 'stdout' | 'stderr', text: string) => void;
}): Promise<CommandTransport> {
  if (input.tty) {
    const { spawn } = await import('node-pty');
    const env = Object.fromEntries(Object.entries(input.env).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
    let child: IPty;
    child = spawn(input.shell ? process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' : input.program,
      input.shell ? process.platform === 'win32' ? ['/d', '/s', '/c', input.program] : ['-c', input.program] : input.args,
      { cwd: input.cwd, env: { ...env, TERM: 'xterm-256color' }, cols: input.cols ?? 100, rows: input.rows ?? 30, name: 'xterm-256color' });
    let closed = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const data = child.onData(text => input.onOutput('stdout', text));
    const completion = new Promise<{ exitCode: number | null }>(resolve => {
      const exit = child.onExit(event => { closed = true; clearTimeout(killTimer); data.dispose(); exit.dispose(); resolve({ exitCode: event.exitCode }); });
    });
    return { completion, write(text, end) { if (closed) return false; child.write(text + (end ? '\x04' : '')); return true; },
      resize(cols, rows) { if (!closed) child.resize(cols, rows); },
      stop() {
        if (closed) return;
        const kill = (signal: string) => { try { if (process.platform !== 'win32') process.kill(-child.pid, signal as NodeJS.Signals); else child.kill(signal); } catch { try { child.kill(signal); } catch {} } };
        kill('SIGTERM'); killTimer = setTimeout(() => { if (!closed) kill('SIGKILL'); }, 1500); killTimer.unref();
      } };
  }
  const handle = spawnProcess({ program: input.program, args: input.args, shell: input.shell, cwd: input.cwd, env: input.env,
    detached: process.platform !== 'win32', terminationPolicy: 'tree', keepStdinOpen: true, maxOutputBytes: 0,
    onOutput: (stream, chunk) => input.onOutput(stream, String(chunk)) });
  const child: ChildProcess = handle.child;
  child.on('error', error => input.onOutput('stderr', error.message));
  child.stdin?.on('error', error => input.onOutput('stderr', error.message));
  return { completion: handle.completion,
    write(text, end) { if (!child.stdin?.writable) return false; if (end) child.stdin.end(text); else child.stdin.write(text); return true; },
    stop: reason => handle.terminate(reason) };
}
