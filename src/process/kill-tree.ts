import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_GRACE_MS = 3000;
const POST_KILL_WAIT_MS = 1000;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

async function waitForExit(target: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processAlive(target)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await delay(Math.min(remaining, 50));
  }
  return true;
}

/** Terminates a child and optionally its process tree, escalating after a grace period. */
export async function terminateProcess(
  child: ChildProcess,
  options: { tree?: boolean; detached?: boolean; graceMs?: number } = {},
): Promise<boolean> {
  const pid = child.pid;
  if (!pid) return true;
  const graceMs = Math.max(0, Math.min(60_000, Math.floor(options.graceMs ?? DEFAULT_GRACE_MS)));

  if (process.platform === 'win32' && options.tree) {
    if (!processAlive(pid)) return true;
    await taskkill(pid, false);
    if (!await waitForExit(pid, graceMs)) await taskkill(pid, true);
    return waitForExit(pid, POST_KILL_WAIT_MS);
  }

  const ownsGroup = options.tree && options.detached && process.platform !== 'win32';
  if (!ownsGroup && (child.exitCode !== null || child.signalCode !== null)) return true;
  const target = ownsGroup ? -pid : pid;
  try {
    process.kill(target, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
    return false;
  }
  if (await waitForExit(target, graceMs)) return true;
  try {
    process.kill(target, 'SIGKILL');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
  return waitForExit(target, POST_KILL_WAIT_MS);
}
