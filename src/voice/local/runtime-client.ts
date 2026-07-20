import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { createLogger } from '../../utils/logger.js';
import { resolveLocalVoiceRootDir } from './models.js';

const log = createLogger('LocalVoice:Runtime');
const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60_000;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort?: () => void;
  onProgress?: (progress: LocalVoiceRuntimeProgress) => void;
};

export interface LocalVoiceRuntimeProgress {
  status?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

function resolveWorkerCommand(): { entry: string; args: string[] } {
  const configured = process.env.XOPC_VOICE_RUNTIME_ENTRY?.trim();
  if (configured) return { entry: configured, args: [configured] };

  const jsEntry = fileURLToPath(new URL('./runtime-worker.js', import.meta.url));
  if (existsSync(jsEntry)) return { entry: jsEntry, args: [jsEntry] };

  const tsEntry = fileURLToPath(new URL('./runtime-worker.ts', import.meta.url));
  if (existsSync(tsEntry)) return { entry: tsEntry, args: ['--import', 'tsx', tsEntry] };
  throw new Error('Bundled local voice runtime entry is missing');
}

export class LocalVoiceRuntimeClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  async request<T>(
    method: string,
    params: Record<string, unknown> = {},
    options: {
      signal?: AbortSignal;
      timeoutMs?: number;
      /** Health/status probes must never terminate an active model download on timeout. */
      stopOnTimeout?: boolean;
      onProgress?: (progress: LocalVoiceRuntimeProgress) => void;
    } = {},
  ): Promise<T> {
    options.signal?.throwIfAborted();
    const child = this.ensureStarted();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.deletePending(id);
        reject(new Error(`Local voice runtime request timed out: ${method}`));
        if (options.stopOnTimeout !== false) this.stop();
      }, options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
        signal: options.signal,
        onProgress: options.onProgress,
      });
      const abort = () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.deletePending(id);
        pending.reject(new Error('Local voice transcription aborted'));
        this.stop();
      };
      const pending = this.pending.get(id);
      if (pending) pending.abort = abort;
      options.signal?.addEventListener('abort', abort, { once: true });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (!error) return;
        this.deletePending(id);
        reject(error);
      });
    });
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill('SIGTERM');
    this.rejectAll(new Error('Local voice runtime stopped'));
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child;
    const command = resolveWorkerCommand();
    const child = spawn(process.execPath, command.args, {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        XOPC_VOICE_MODEL_DIR: resolveLocalVoiceRootDir(),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(line));
    child.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString().trim();
      if (message) log.debug({ message }, 'Local voice runtime stderr');
    });
    child.once('error', (error) => {
      if (this.child === child) this.child = null;
      this.rejectAll(error);
    });
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      if (this.pending.size > 0) {
        this.rejectAll(new Error(`Local voice runtime exited (${code ?? signal ?? 'unknown'})`));
      }
    });
    return child;
  }

  private handleLine(line: string): void {
    let message: {
      id?: number;
      result?: unknown;
      error?: string | { message?: string; code?: string; cause?: string };
      event?: string;
      data?: unknown;
    };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      log.warn({ linePreview: line.slice(0, 200) }, 'Ignored invalid local voice runtime output');
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    if (message.event === 'progress') {
      pending.onProgress?.((message.data ?? {}) as LocalVoiceRuntimeProgress);
      return;
    }
    this.deletePending(message.id);
    if (message.error) {
      const detail = typeof message.error === 'string' ? { message: message.error } : message.error;
      const suffix = [detail.code, detail.cause].filter(Boolean).join(': ');
      const error = new Error(`${detail.message || 'Local voice runtime failed'}${suffix ? ` (${suffix})` : ''}`);
      if (detail.code) Object.assign(error, { code: detail.code });
      pending.reject(error);
    } else pending.resolve(message.result);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      if (pending.signal && pending.abort) {
        pending.signal.removeEventListener('abort', pending.abort);
      }
      pending.reject(error);
    }
    this.pending.clear();
  }

  private deletePending(id: number): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    if (pending.signal && pending.abort) {
      pending.signal.removeEventListener('abort', pending.abort);
    }
    this.pending.delete(id);
  }
}

let sharedRuntime: LocalVoiceRuntimeClient | undefined;

export function getLocalVoiceRuntimeClient(): LocalVoiceRuntimeClient {
  sharedRuntime ??= new LocalVoiceRuntimeClient();
  return sharedRuntime;
}

export function resetLocalVoiceRuntimeForTests(): void {
  sharedRuntime?.stop();
  sharedRuntime = undefined;
}
