import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import { spawnStdioProcess } from '../../../process/run-process.js';
import { createLogger } from '../../../utils/logger.js';

import { closeRuntimeProcess } from '../runtime-process.js';

const log = createLogger('AcpJsonRpcClient');

export type AcpRecord = Record<string, unknown>;

export function asRecord(value: unknown): AcpRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as AcpRecord)
    : undefined;
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

export class AcpRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'AcpRpcError';
  }
}

export interface AcpClientOptions {
  command: string;
  args: ReadonlyArray<string>;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  label: string;
  notFoundMessage: string;
  onNotification: (method: string, params: AcpRecord) => void;
  onRequest?: (method: string, params: AcpRecord) => Promise<AcpRecord> | AcpRecord;
  onNonJsonLine?: (line: string) => Error | undefined;
  onStderrLine?: (line: string) => Error | undefined;
  onFailure?: (error: Error) => void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;
const MAX_FRAME_LENGTH = 32 * 1024 * 1024;
const MAX_STDERR_BYTES = 2_048;

/** Bidirectional JSON-RPC 2.0 NDJSON transport over stdio for ACP-compatible agents. */
export class AcpJsonRpcClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, ReturnType<typeof deferred<unknown>>>();
  private readonly closed = deferred<void>();
  private readonly label: string;
  private onNotification?: (method: string, params: AcpRecord) => void;
  private onRequest?: (method: string, params: AcpRecord) => Promise<AcpRecord> | AcpRecord;
  private readonly onNonJsonLine?: (line: string) => Error | undefined;
  private onFailure?: (error: Error) => void;
  private failure: Error | undefined;
  private closing = false;
  private exitTimer?: NodeJS.Timeout;
  private closingProcess?: Promise<void>;
  private stdoutBuffer = '';
  private stderrLineBuffer = '';
  private stderrTail = '';
  private nextId = 0;

  constructor(options: AcpClientOptions) {
    this.label = options.label;
    this.onNotification = options.onNotification;
    this.onRequest = options.onRequest;
    this.onNonJsonLine = options.onNonJsonLine;
    this.onFailure = options.onFailure;

    this.child = spawnStdioProcess({
      program: options.command,
      args: options.args,
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== 'win32',
      windowsHide: true,
    });

    this.child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-MAX_STDERR_BYTES);
      if (!options.onStderrLine || this.failure) return;
      this.stderrLineBuffer += chunk;
      let newline = this.stderrLineBuffer.indexOf('\n');
      while (newline >= 0) {
        const line = this.stderrLineBuffer.slice(0, newline).replace(/\r$/, '');
        this.stderrLineBuffer = this.stderrLineBuffer.slice(newline + 1);
        const error = options.onStderrLine(line);
        if (error) {
          this.fail(error);
          return;
        }
        newline = this.stderrLineBuffer.indexOf('\n');
      }
      if (this.stderrLineBuffer.length > 32_768) {
        this.stderrLineBuffer = this.stderrLineBuffer.slice(-8_192);
      }
    });

    this.child.on('error', (error: NodeJS.ErrnoException) => {
      this.fail(
        new Error(
          error.code === 'ENOENT' ? options.notFoundMessage : `Could not start ${this.label} ACP server.`,
          { cause: error },
        ),
      );
    });
    const disconnected = () => {
      const stderrHint = this.stderrTail.trim().split('\n').pop()?.trim().slice(0, 200);
      return new Error(stderrHint
        ? `${this.label} ACP server disconnected (${stderrHint}).`
        : `${this.label} ACP server disconnected.`);
    };
    this.child.on('exit', () => {
      if (!this.closing) this.exitTimer = setTimeout(() => this.fail(disconnected()), 250).unref();
    });
    this.child.on('close', () => {
      clearTimeout(this.exitTimer);
      this.closed.resolve();
      if (this.closing) {
        for (const request of this.pending.values()) request.reject(new Error(`${this.label} ACP server closed.`));
      } else {
        this.fail(disconnected());
      }
    });
    this.child.stdin.on('error', () => {
      if (!this.closing) {
        this.fail(new Error(`Could not send a message to ${this.label} ACP server.`));
      }
    });
    this.child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (this.failure) return;
      try {
        this.stdoutBuffer += chunk;
        let newline = this.stdoutBuffer.indexOf('\n');
        while (newline >= 0) {
          if (newline > MAX_FRAME_LENGTH) {
            throw new Error(`${this.label} ACP server sent an oversized message.`);
          }
          const line = this.stdoutBuffer.slice(0, newline).trim();
          this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
          if (line) this.receive(line);
          newline = this.stdoutBuffer.indexOf('\n');
        }
        if (this.stdoutBuffer.length > MAX_FRAME_LENGTH) {
          throw new Error(`${this.label} ACP server sent an oversized message.`);
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(`Could not read ${this.label} ACP output.`));
      }
    });
  }

  async request(
    method: string,
    params: AcpRecord,
    signal?: AbortSignal,
    timeoutMs: number | null = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<AcpRecord> {
    signal?.throwIfAborted();
    if (this.failure) throw this.failure;
    const id = ++this.nextId;
    const response = deferred<unknown>();
    this.pending.set(id, response);
    const timer = timeoutMs === null
      ? undefined
      : setTimeout(() => response.reject(new Error(`${this.label} did not answer ${method}.`)), timeoutMs);
    const abort = () => response.reject(signal?.reason ?? new Error(`${this.label} request ${method} aborted.`));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      this.send({ jsonrpc: '2.0', id, method, params });
      return asRecord(await response.promise) ?? {};
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      this.pending.delete(id);
    }
  }

  isAlive(): boolean {
    return !this.closing && !this.failure;
  }

  setHandlers(handlers: {
    onNotification?: (method: string, params: AcpRecord) => void;
    onRequest?: (method: string, params: AcpRecord) => Promise<AcpRecord> | AcpRecord;
    onFailure?: (error: Error) => void;
  }): void {
    this.onNotification = handlers.onNotification;
    this.onRequest = handlers.onRequest;
    this.onFailure = handlers.onFailure;
  }

  notify(method: string, params?: AcpRecord): void {
    this.send({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) });
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const request of this.pending.values()) request.reject(error);
    if (!this.closing) {
      log.warn(
        {
          err: error,
          label: this.label,
          ...(this.stderrTail.trim() ? { stderrPreview: this.stderrTail.trim().slice(-400) } : {}),
        },
        `${this.label} ACP client failed: ${error.message}`,
      );
      this.onFailure?.(error);
    }
  }

  private send(frame: AcpRecord): void {
    if (this.failure) throw this.failure;
    if (this.closing) throw new Error(`${this.label} ACP server closed.`);
    this.child.stdin.write(`${JSON.stringify(frame)}\n`);
  }

  private receive(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (parseError) {
      const handled = this.onNonJsonLine?.(line);
      if (handled) throw handled;
      throw parseError;
    }
    const frame = asRecord(parsed);
    if (!frame) return;
    const { id, method } = frame;
    if (typeof method === 'string') {
      const params = asRecord(frame.params) ?? {};
      if (typeof id === 'number' || typeof id === 'string') {
        void this.handleIncomingRequest(id, method, params);
      } else {
        this.onNotification?.(method, params);
      }
      return;
    }
    if (typeof id === 'number') {
      const request = this.pending.get(id);
      if (!request) return;
      const error = asRecord(frame.error);
      if (error) {
        const code = typeof error.code === 'number' ? error.code : -32000;
        const message = String(error.message ?? `${this.label} request failed.`).slice(0, 1_000);
        request.reject(new AcpRpcError(code, message, error.data));
      } else {
        request.resolve(frame.result);
      }
    }
  }

  private async handleIncomingRequest(
    id: number | string,
    method: string,
    params: AcpRecord,
  ): Promise<void> {
    if (!this.onRequest) {
      this.send({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `xopc does not implement ACP client method ${method}.` },
      });
      return;
    }
    try {
      const result = await this.onRequest(method, params);
      if (!this.closing && !this.failure) {
        this.send({ jsonrpc: '2.0', id, result });
      }
    } catch (error) {
      if (this.closing || this.failure) return;
      const code = error instanceof AcpRpcError ? error.code : -32603;
      const message = error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000);
      this.send({ jsonrpc: '2.0', id, error: { code, message } });
    }
  }

  close(force = false): Promise<void> {
    this.closing = true;
    clearTimeout(this.exitTimer);
    return this.closingProcess ??= closeRuntimeProcess(this.child, this.closed.promise, this.label, force);
  }
}
