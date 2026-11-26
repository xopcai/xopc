import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { resolveUserPath } from '../../../agent-scope.js';
import { createLogger } from '../../../../utils/logger.js';

const log = createLogger('CodexAppServer');

export type CodexRecord = Record<string, unknown>;

export type CodexAppServerOptions = {
  binaryPath?: string;
  homePath?: string;
};

export function record(value: unknown): CodexRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as CodexRecord : undefined;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_FRAME_LENGTH = 32 * 1024 * 1024;
const MAX_STDERR_BYTES = 2_048;

/** One stdio connection for a single xopc run. Codex persists the thread on disk. */
export class CodexAppServer {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, ReturnType<typeof deferred<unknown>>>();
  private readonly closed = deferred<void>();
  private failure: Error | undefined;
  private closing = false;
  private exited = false;
  private buffer = '';
  private stderrTail = '';
  private nextId = 0;

  constructor(
    cwd: string,
    onNotification: (method: string, params: CodexRecord) => void,
    onFailure: (error: Error) => void,
    options: CodexAppServerOptions = {},
  ) {
    const command = options.binaryPath?.trim()
      ? resolveUserPath(options.binaryPath.trim())
      : process.env.XOPC_CODEX_BIN?.trim() || 'codex';
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (options.homePath?.trim()) {
      env.CODEX_HOME = resolveUserPath(options.homePath.trim());
    }
    this.child = spawn(command, ['app-server', '--listen', 'stdio://'], {
      cwd,
      env,
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    this.child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-MAX_STDERR_BYTES);
    });
    const fail = (error: Error) => {
      if (this.failure) return;
      this.failure = error;
      for (const request of this.pending.values()) request.reject(error);
      if (!this.closing) {
        log.warn(
          { err: error, cwd, ...(this.stderrTail.trim() ? { stderrPreview: this.stderrTail.trim().slice(-400) } : {}) },
          `Codex App Server failed: ${error.message}`,
        );
        onFailure(error);
      }
    };
    this.child.on('error', (error: NodeJS.ErrnoException) => fail(new Error(error.code === 'ENOENT'
      ? 'Codex CLI was not found on the Gateway host. Install Codex and run codex login there.'
      : 'Could not start Codex App Server.', { cause: error })));
    this.child.on('exit', () => { this.exited = true; });
    this.child.on('close', () => {
      this.exited = true;
      this.closed.resolve();
      if (this.closing) {
        for (const request of this.pending.values()) request.reject(new Error('Codex App Server closed.'));
        return;
      }
      const stderrHint = this.stderrTail.trim().split('\n').pop()?.trim().slice(0, 200);
      fail(new Error(stderrHint
        ? `Codex App Server disconnected (${stderrHint}). Check the Codex installation and login on the Gateway host.`
        : 'Codex App Server disconnected. Check the Codex installation and login on the Gateway host.'));
    });
    this.child.stdin.on('error', () => fail(new Error('Could not send a message to Codex App Server.')));
    this.child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (this.failure) return;
      try {
        this.buffer += chunk;
        let newline = this.buffer.indexOf('\n');
        while (newline >= 0) {
          if (newline > MAX_FRAME_LENGTH) throw new Error('Codex App Server sent an oversized message.');
          const line = this.buffer.slice(0, newline).trim();
          this.buffer = this.buffer.slice(newline + 1);
          if (line) this.receive(line, onNotification);
          newline = this.buffer.indexOf('\n');
        }
        if (this.buffer.length > MAX_FRAME_LENGTH) throw new Error('Codex App Server sent an oversized message.');
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Could not read Codex App Server output.'));
      }
    });
  }

  async request(method: string, params: CodexRecord, signal?: AbortSignal): Promise<CodexRecord> {
    signal?.throwIfAborted();
    const id = ++this.nextId;
    const response = deferred<unknown>();
    this.pending.set(id, response);
    const timer = setTimeout(() => response.reject(new Error(`Codex did not answer ${method}.`)), REQUEST_TIMEOUT_MS);
    const abort = () => response.reject(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      this.send({ id, method, params });
      return record(await response.promise) ?? {};
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      this.pending.delete(id);
    }
  }

  notify(method: string): void {
    this.send({ method });
  }

  private send(frame: CodexRecord): void {
    if (this.failure) throw this.failure;
    this.child.stdin.write(`${JSON.stringify(frame)}\n`);
  }

  private receive(line: string, onNotification: (method: string, params: CodexRecord) => void): void {
    const frame = record(JSON.parse(line));
    if (!frame) return;
    const { id, method } = frame;
    if (typeof method === 'string') {
      if (typeof id === 'number' || typeof id === 'string') {
        this.send({ id, error: { code: -32601, message: 'xopc does not handle interactive Codex requests.' } });
      } else {
        onNotification(method, record(frame.params) ?? {});
      }
    } else if (typeof id === 'number') {
      const request = this.pending.get(id);
      if (!request) return;
      const error = record(frame.error);
      if (error) {
        request.reject(new Error(String(error.message ?? 'Codex request failed.').slice(0, 1_000)));
      } else {
        request.resolve(frame.result);
      }
    }
  }

  async close(force = false): Promise<void> {
    this.closing = true;
    if (this.exited) return;
    this.child.stdin.end();
    if (!force) await Promise.race([this.closed.promise, delay(1_000, undefined, { ref: false })]);
    if (!this.exited) this.kill('SIGTERM');
    await Promise.race([this.closed.promise, delay(1_000, undefined, { ref: false })]);
    if (!this.exited) {
      this.kill('SIGKILL');
      await Promise.race([this.closed.promise, delay(1_000, undefined, { ref: false })]);
    }
  }

  private kill(signal: NodeJS.Signals): void {
    const pid = this.child.pid;
    if (pid === undefined) return;
    try {
      process.kill(process.platform === 'win32' ? pid : -pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
}
