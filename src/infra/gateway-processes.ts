import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import { listPortListeners } from '../gateway/ports.js';
import { isGatewayArgv, parseProcCmdline } from './gateway-process-argv.js';

export function readGatewayProcessArgsSync(pid: number): string[] | null {
  if (process.platform === 'linux') {
    try {
      return parseProcCmdline(fsSync.readFileSync(`/proc/${pid}/cmdline`, 'utf8'));
    } catch {
      return null;
    }
  }
  if (process.platform === 'darwin') {
    const ps = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 1000,
    });
    if (ps.error || ps.status !== 0) {
      return null;
    }
    const command = ps.stdout.trim();
    return command ? command.split(/\s+/) : null;
  }
  if (process.platform === 'win32') {
    const ps = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ],
      { encoding: 'utf8', timeout: 3000 },
    );
    if (ps.error || ps.status !== 0) {
      return null;
    }
    const command = ps.stdout.trim();
    return command ? command.split(/\s+/) : null;
  }
  return null;
}

export function signalVerifiedGatewayPidSync(pid: number, signal: 'SIGTERM' | 'SIGUSR1'): void {
  const args = readGatewayProcessArgsSync(pid);
  if (!args || !isGatewayArgv(args, { allowGatewayBinary: true })) {
    throw new Error(`refusing to signal non-gateway process pid ${pid}`);
  }
  process.kill(pid, signal);
}

export function findGatewayPidsOnPortSync(port: number): number[] {
  try {
    return listPortListeners(port)
      .map((entry) => entry.pid)
      .filter((pid): pid is number => Number.isFinite(pid) && pid > 0);
  } catch {
    return [];
  }
}

export function findVerifiedGatewayListenerPidsOnPortSync(port: number): number[] {
  return Array.from(new Set(findGatewayPidsOnPortSync(port)))
    .filter((pid) => pid !== process.pid)
    .filter((pid) => {
      const args = readGatewayProcessArgsSync(pid);
      return args != null && isGatewayArgv(args, { allowGatewayBinary: true });
    });
}

export function formatGatewayPidList(pids: number[]): string {
  return pids.join(', ');
}
