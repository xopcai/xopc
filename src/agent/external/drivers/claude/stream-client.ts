import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface, type Interface } from 'node:readline';

import { spawnStdioProcess } from '../../../../process/run-process.js';
import { createLogger } from '../../../../utils/logger.js';
import { closeRuntimeProcess } from '../../runtime-process.js';
import { buildClaudeEnv, findClaudeExecutable } from './executable.js';

const log = createLogger('ClaudeStreamClient');

export type ClaudeRecord = Record<string, unknown>;

export function claudeRecord(value: unknown): ClaudeRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ClaudeRecord)
    : undefined;
}

export type ClaudeControlRequestHandler = (
  subtype: string,
  request: ClaudeRecord,
) => Promise<ClaudeRecord>;

export interface ClaudeStreamClientOptions {
  binaryPath?: string;
  configDir?: string;
  args?: string[];
  onEvent: (frame: ClaudeRecord) => void;
  onFailure?: (error: Error) => void;
  onControlRequest?: ClaudeControlRequestHandler;
}

/**
 * Bidirectional NDJSON client for `claude --print --output-format stream-json --input-format stream-json`.
 * Supports warm multi-turn reuse via `setHandlers()` and `isAlive()`.
 */
export class ClaudeStreamClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stdout: Interface;
  private readonly closedPromise: Promise<void>;
  private readonly pending = new Map<string, {
    resolve: (value: ClaudeRecord) => void;
    reject: (error: Error) => void;
    cleanup?: () => void;
  }>();
  private readonly stderrLines: string[] = [];
  private closed = false;
  private failure?: Error;
  private onEvent: (frame: ClaudeRecord) => void;
  private onFailure?: (error: Error) => void;
  private onControlRequest?: ClaudeControlRequestHandler;

  constructor(cwd: string, options: ClaudeStreamClientOptions) {
    this.onEvent = options.onEvent;
    this.onFailure = options.onFailure;
    this.onControlRequest = options.onControlRequest;

    const executable = findClaudeExecutable(options.binaryPath);
    if (!executable) {
      throw new Error(
        options.binaryPath
          ? `Claude Code binary was not found at "${options.binaryPath}".`
          : 'Claude Code CLI (`claude`) was not found in PATH on the Gateway host.',
      );
    }

    const args = [
      '--print',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      ...(options.args ?? []),
    ];

    this.child = spawnStdioProcess({
      program: executable,
      args,
      cwd,
      env: buildClaudeEnv(options.configDir),
    });
    this.closedPromise = new Promise<void>((resolve) => {
      this.child.once('close', () => resolve());
    });

    this.stdout = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.stdout.on('line', (line) => this.handleLine(line));

    this.child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (!text) return;
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        this.stderrLines.push(trimmed);
        if (this.stderrLines.length > 20) this.stderrLines.shift();
      }
    });

    this.child.on('error', (error) => {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    });

    this.child.on('exit', (code, signal) => {
      if (this.closed) return;
      const tail = this.stderrLines.slice(-4).join(' | ');
      const detail = tail
        ? `Claude Code exited (${signal ?? code ?? 'unknown'}): ${tail}`
        : `Claude Code exited unexpectedly (${signal ?? code ?? 'unknown'}).`;
      this.fail(new Error(detail));
    });
  }

  isAlive(): boolean {
    return !this.closed && !this.failure && this.child.exitCode === null && !this.child.killed;
  }

  setHandlers(handlers: {
    onEvent?: (frame: ClaudeRecord) => void;
    onFailure?: (error: Error) => void;
    onControlRequest?: ClaudeControlRequestHandler;
  }): void {
    this.onEvent = handlers.onEvent ?? (() => {});
    this.onFailure = handlers.onFailure;
    this.onControlRequest = handlers.onControlRequest;
  }

  private writeFrame(frame: ClaudeRecord): void {
    if (this.closed || this.failure) {
      throw this.failure ?? new Error('Claude Code process is closed.');
    }
    this.child.stdin.write(`${JSON.stringify(frame)}\n`);
  }

  requestControl(
    subtype: string,
    payload: ClaudeRecord = {},
    signal?: AbortSignal,
  ): Promise<ClaudeRecord> {
    if (this.closed || this.failure) {
      return Promise.reject(this.failure ?? new Error('Claude Code process is closed.'));
    }
    if (signal?.aborted) {
      return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
    }
    const requestId = randomUUID();
    return new Promise<ClaudeRecord>((resolve, reject) => {
      let onAbort: (() => void) | undefined;
      const cleanup = () => {
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      };
      if (signal) {
        onAbort = () => {
          this.pending.delete(requestId);
          cleanup();
          reject(signal.reason instanceof Error ? signal.reason : new Error('Claude control request aborted.'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
      this.pending.set(requestId, { resolve, reject, cleanup });
      try {
        this.writeFrame({
          type: 'control_request',
          request_id: requestId,
          request: { subtype, ...payload },
        });
      } catch (error) {
        this.pending.delete(requestId);
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  sendUserMessage(
    content: string | Array<ClaudeRecord>,
    sessionId?: string,
  ): void {
    this.writeFrame({
      type: 'user',
      message: {
        role: 'user',
        content,
      },
      ...(sessionId ? { session_id: sessionId } : {}),
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: ClaudeRecord | undefined;
    try {
      parsed = claudeRecord(JSON.parse(trimmed));
    } catch {
      return;
    }
    if (!parsed) return;

    const type = typeof parsed.type === 'string' ? parsed.type : '';
    if (type === 'control_response') {
      const response = claudeRecord(parsed.response);
      const requestId = typeof response?.request_id === 'string' ? response.request_id : '';
      const entry = requestId ? this.pending.get(requestId) : undefined;
      if (!entry) return;
      this.pending.delete(requestId);
      entry.cleanup?.();
      if (response?.subtype === 'error') {
        const errMsg = typeof response.error === 'string' ? response.error : 'Claude control request failed.';
        entry.reject(new Error(errMsg));
      } else {
        entry.resolve(claudeRecord(response?.response) ?? {});
      }
      return;
    }

    if (type === 'control_request') {
      const requestId = typeof parsed.request_id === 'string' ? parsed.request_id : '';
      const req = claudeRecord(parsed.request);
      const subtype = typeof req?.subtype === 'string' ? req.subtype : '';
      if (!requestId || !req) return;
      void this.handleIncomingControlRequest(requestId, subtype, req);
      return;
    }

    this.onEvent(parsed);
  }

  private async handleIncomingControlRequest(
    requestId: string,
    subtype: string,
    request: ClaudeRecord,
  ): Promise<void> {
    try {
      const handler = this.onControlRequest;
      const result = handler
        ? await handler(subtype, request)
        : { behavior: 'deny', message: `Unsupported control request: ${subtype}` };
      if (this.closed) return;
      this.writeFrame({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: result,
        },
      });
    } catch (error) {
      log.warn({ err: error, subtype }, 'Failed to answer Claude control request');
      if (this.closed) return;
      try {
        this.writeFrame({
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: requestId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      } catch {
        // Process already exited.
      }
    }
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const entry of this.pending.values()) {
      entry.cleanup?.();
      entry.reject(error);
    }
    this.pending.clear();
    this.onFailure?.(error);
  }

  async close(force = false): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) {
      entry.cleanup?.();
      entry.reject(new Error('Claude Code process closed.'));
    }
    this.pending.clear();
    this.stdout.close();
    await closeRuntimeProcess(this.child, this.closedPromise, 'ClaudeCode', force);
  }
}
