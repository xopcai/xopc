import { type ChildProcess, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

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
  // frpc defaults to http_proxy and ignores NO_PROXY. Keep the managed control
  // connection direct without changing proxy settings in the Gateway process.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'http_proxy'));
  const child: ChildProcess = spawn(frpcBin, ['-c', configPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });

  let loginResolve: (() => void) | undefined;
  let loginReject: ((err: Error) => void) | undefined;
  let loginTimer: ReturnType<typeof setTimeout> | undefined;
  let lastFailure = '';
  const waitForLoginSuccess = new Promise<void>((resolve, reject) => {
    loginResolve = resolve;
    loginReject = reject;
  });
  const settleLogin = (error?: Error) => {
    if (loginTimer) clearTimeout(loginTimer);
    loginTimer = undefined;
    if (error) loginReject?.(error);
    else loginResolve?.();
    loginResolve = undefined;
    loginReject = undefined;
  };
  loginTimer = setTimeout(() => settleLogin(new Error(
    `frpc login timeout${lastFailure ? `: ${lastFailure}` : ''}`,
  )), 60_000);

  const exitHandlers: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];

  const onLine = (line: string) => {
    if (LOGIN_SUCCESS_RE.test(line) || RECONNECT_SUCCESS_RE.test(line)) {
      settleLogin();
      return;
    }
    // Expose useful diagnostics without copying credentials from child output.
    const failure = /proxyconnect|DialTcpByHttpProxy|fail to parse proxy url|proxy.*(?:error|failed|refused)/i.test(line) ? 'Connection through configured proxy failed'
      : /certificate|x509|tls handshake/i.test(line) ? 'TLS certificate or handshake failed'
      : /connection refused|actively refused/i.test(line) ? 'Connection refused by FRP server'
      : /i\/o timeout|connectex.*timed out|connection.*timed out/i.test(line) ? 'Connection to FRP server timed out'
      : /no such host|name resolution|lookup.*failed/i.test(line) ? 'FRP server DNS lookup failed'
      : /login to (?:the )?server failed|connect to server error|authorization failed|authentication failed/i.test(line) ? 'FRP server login failed'
      : '';
    if (failure && failure !== lastFailure) {
      lastFailure = failure;
      log.warn({ reason: failure }, 'frpc connection attempt failed');
    }
  };

  const streams = [child.stdout, child.stderr].map(stream => {
    const decoder = new StringDecoder('utf8');
    let pending = '';
    const consume = (text: string) => {
      pending += text;
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (line) { log.debug({ line }, 'frpc output'); onLine(line); }
      }
      // A readiness message may arrive without a newline or across pipe chunks.
      onLine(pending);
      if (pending.length > 16_384) pending = pending.slice(-16_384);
    };
    stream?.on('data', (chunk: Buffer) => consume(decoder.write(chunk)));
    return () => consume(decoder.end() + '\n');
  });

  child.on('error', (err) => settleLogin(err));

  child.on('exit', (code, signal) => {
    for (const flush of streams) flush();
    settleLogin(new Error(`frpc exited before login (code=${code ?? 'null'}, signal=${signal ?? 'null'})${lastFailure ? `: ${lastFailure}` : ''}`));
    for (const h of exitHandlers) h(code, signal);
  });

  return {
    pid: child.pid ?? 0,
    waitForLoginSuccess,
    onExit: (handler) => {
      exitHandlers.push(handler);
    },
    kill: async (signal = 'SIGTERM') => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          resolve();
        }, 3000);
        child.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
        child.kill(signal);
      });
    },
  };
}
