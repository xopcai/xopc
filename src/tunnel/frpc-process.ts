import { type ChildProcess, spawn } from 'node:child_process';

import { createLogger } from '../utils/logger.js';

const log = createLogger('TunnelFrpc');

export type FrpcProcessHandle = {
  pid: number;
  waitForLoginSuccess: Promise<void>;
  onExit: (handler: (code: number | null, signal: NodeJS.Signals | null) => void) => void;
  kill: (signal?: NodeJS.Signals) => Promise<void>;
};

const LOGIN_SUCCESS_RE = /login to server success/i;
const RECONNECT_SUCCESS_RE = /reconnect success/i;

export function spawnFrpcProcess(frpcBin: string, configPath: string): FrpcProcessHandle {
  const child: ChildProcess = spawn(frpcBin, ['-c', configPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let loginResolve: (() => void) | undefined;
  let loginReject: ((err: Error) => void) | undefined;
  const waitForLoginSuccess = new Promise<void>((resolve, reject) => {
    loginResolve = resolve;
    loginReject = reject;
    setTimeout(() => reject(new Error('frpc login timeout')), 60_000);
  });

  const exitHandlers: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];

  const onLine = (line: string) => {
    if (LOGIN_SUCCESS_RE.test(line) || RECONNECT_SUCCESS_RE.test(line)) {
      loginResolve?.();
      loginResolve = undefined;
      loginReject = undefined;
    }
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim()) log.debug({ line: line.trim() }, 'frpc stdout');
      onLine(line);
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim()) log.debug({ line: line.trim() }, 'frpc stderr');
      onLine(line);
    }
  });

  child.on('error', (err) => {
    loginReject?.(err);
    loginResolve = undefined;
    loginReject = undefined;
  });

  child.on('exit', (code, signal) => {
    loginReject?.(new Error(`frpc exited before login (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
    loginResolve = undefined;
    loginReject = undefined;
    for (const h of exitHandlers) h(code, signal);
  });

  if (!child.pid) {
    throw new Error('Failed to spawn frpc process');
  }

  return {
    pid: child.pid,
    waitForLoginSuccess,
    onExit: (handler) => {
      exitHandlers.push(handler);
    },
    kill: async (signal = 'SIGTERM') => {
      if (!child.pid || child.killed) return;
      child.kill(signal);
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
          resolve();
        }, 3000);
        child.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
    },
  };
}
