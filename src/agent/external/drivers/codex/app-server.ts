import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import { resolveUserPath } from '../../../agent-scope.js';
import { spawnStdioProcess } from '../../../../process/run-process.js';
import { createLogger } from '../../../../utils/logger.js';

import { findCodexExecutable } from './executable.js';

import { closeRuntimeProcess } from '../../runtime-process.js';

const log = createLogger('CodexAppServer');

export type CodexRecord = Record<string, unknown>;

export type CodexAppServerOptions = {
  binaryPath?: string;
  homePath?: string;
  onRequest?: (method: string, params: CodexRecord) => Promise<CodexRecord> | CodexRecord;
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
  private exitTimer?: NodeJS.Timeout;
  private closingProcess?: Promise<void>;
  private buffer = '';
  private stderrTail = '';
  private nextId = 0;
  private readonly onRequest?: (method: string, params: CodexRecord) => Promise<CodexRecord> | CodexRecord;

  constructor(
    cwd: string,
    onNotification: (method: string, params: CodexRecord) => void,
    onFailure: (error: Error) => void,
    options: CodexAppServerOptions = {},
  ) {
    this.onRequest = options.onRequest;
    const command = findCodexExecutable(options.binaryPath);
    if (!command) throw new Error('Codex CLI was not found on the Gateway host. Install Codex and run codex login there.');
    const env: NodeJS.ProcessEnv = {
      CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'xopc',
      ...process.env,
    };
    if (options.homePath?.trim()) {
      env.CODEX_HOME = resolveUserPath(options.homePath.trim());
    }
    this.child = spawnStdioProcess({
      program: command,
      args: ['app-server', '--listen', 'stdio://'],
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
    const disconnected = () => {
      const stderrHint = this.stderrTail.trim().split('\n').pop()?.trim().slice(0, 200);
      return new Error(stderrHint
        ? `Codex App Server disconnected (${stderrHint}). Check the Codex installation and login on the Gateway host.`
        : 'Codex App Server disconnected. Check the Codex installation and login on the Gateway host.');
    };
    this.child.on('exit', () => {
      if (!this.closing) this.exitTimer = setTimeout(() => fail(disconnected()), 250).unref();
    });
    this.child.on('close', () => {
      clearTimeout(this.exitTimer);
      this.closed.resolve();
      if (this.closing) {
        for (const request of this.pending.values()) request.reject(new Error('Codex App Server closed.'));
      } else {
        fail(disconnected());
      }
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
        if (this.onRequest) {
          void Promise.resolve(this.onRequest(method, record(frame.params) ?? {}))
            .then((result) => {
              if (!this.closing && !this.failure) this.send({ id, result });
            })
            .catch((error: unknown) => {
              if (!this.closing && !this.failure) {
                this.send({
                  id,
                  error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : String(error),
                  },
                });
              }
            });
        } else {
          this.send({ id, error: { code: -32601, message: 'xopc does not handle interactive Codex requests.' } });
        }
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

  close(force = false): Promise<void> {
    this.closing = true;
    clearTimeout(this.exitTimer);
    return this.closingProcess ??= closeRuntimeProcess(this.child, this.closed.promise, 'Codex App Server', force);
  }
}
