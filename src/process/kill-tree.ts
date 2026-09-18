import { spawn, type ChildProcess } from 'node:child_process';

const DEFAULT_GRACE_MS = 3000;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

function taskkill(pid: number, force: boolean): Promise<void> {
  return new Promise(resolve => {
    const child = spawn('taskkill', [...(force ? ['/F'] : []), '/T', '/PID', String(pid)], {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', () => resolve());
    child.once('close', () => resolve());
  });
}

/** Terminates a child and optionally its process tree, escalating after a grace period. */
export async function terminateProcess(
  child: ChildProcess,
  options: { tree?: boolean; detached?: boolean; graceMs?: number } = {},
): Promise<boolean> {
  const pid = child.pid;
  if (!pid || child.exitCode !== null || child.signalCode !== null) return true;
  const graceMs = Math.max(0, Math.min(60_000, Math.floor(options.graceMs ?? DEFAULT_GRACE_MS)));

  if (process.platform === 'win32' && options.tree) {
    await taskkill(pid, false);
    if (graceMs > 0 && processAlive(pid)) await delay(graceMs);
    if (processAlive(pid)) await taskkill(pid, true);
    return !processAlive(pid);
  }

  const target = options.tree && options.detached ? -pid : pid;
  try {
    process.kill(target, 'SIGTERM');
  } catch {
    return true;
  }
  if (graceMs > 0 && processAlive(pid)) await delay(graceMs);
  if (processAlive(pid)) {
    try {
      process.kill(target, 'SIGKILL');
    } catch {
      try { child.kill('SIGKILL'); } catch { /* already exited */ }
    }
  }
  return !processAlive(pid);
}
