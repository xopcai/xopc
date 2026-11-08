import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DurableState } from '../../storage/sqlite/durable-state.js';
import { resolveStateDir } from '../../config/paths.js';
import { resolveGlobalSingleton } from '../../utils/global-singleton.js';
import { redactSensitiveOutput } from '../../utils/logger.js';
import { startCommandTransport, type CommandTransport } from './command-transport.js';
import { sandboxCommand } from '../sandbox/native-command.js';
import { getSessionInteractionPolicy } from '../session/interaction-policy.js';
import { isolatedCommand, removeCommandContainer, type CommandIsolation } from './command-isolation.js';
import { readWorkspaceRevision } from '../coding/workspace-revision.js';

export const DEFAULT_COMMAND_TIMEOUT_MS = 30 * 60_000;
export const MAX_COMMAND_TIMEOUT_MS = 4 * 60 * 60_000;
const MAX_LOG_BYTES = 8 * 1024 * 1024;

export type CommandStatus = 'running' | 'success' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted';
export interface CommandResult {
  id: string;
  command: string;
  cwd: string;
  status: CommandStatus;
  exitCode: number | null;
  createdAtMs: number;
  durationMs: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  aggregatedOutput: string;
  totalOutputBytes: number;
  outputLength?: number;
  captureTruncated: boolean;
  logPath: string;
  logTruncated: boolean;
  startRevision?: string;
  endRevision?: string;
  isolation?: 'host' | 'docker';
  containerName?: string;
  sandbox?: 'read-only' | 'workspace-write';
  network?: boolean;
  tty?: boolean;
  cols?: number;
  rows?: number;
}
interface RunningCommand {
  owner: string;
  result: CommandResult;
  transport: CommandTransport;
  done: Promise<CommandResult>;
  stop: (status: 'cancelled' | 'timed_out') => void;
}

export function commandTimeout(raw: unknown, ceiling = MAX_COMMAND_TIMEOUT_MS): number {
  return Math.min(ceiling, Math.max(1, typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_COMMAND_TIMEOUT_MS));
}

/** Foreground and background tools share ownership, cancellation, output and durable receipts. */
export class CommandRegistry {
  private readonly prunedAt = new Map<string, number>();
  private readonly running = new Map<string, RunningCommand>();
  constructor(private readonly root = join(resolveStateDir(), 'command-runs')) {}

  private directory(owner: string): string {
    return join(this.root, createHash('sha256').update(owner).digest('hex'));
  }
  private persist(owner: string, result: CommandResult): void {
    this.receipts(owner).set(result.id, result);
  }
  private receipts(owner: string): DurableState<CommandResult> { return new DurableState('command-receipts', owner); }

  async start(input: {
    owner: string; command: string; cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number;
    workspace?: string; isolation?: CommandIsolation; tty?: boolean; cols?: number; rows?: number;
    maxOutputChars?: number; signal?: AbortSignal; snapshot?: boolean;
    onOutput?: (stream: 'stdout' | 'stderr', delta: string) => void;
  }): Promise<CommandResult> {
    input.signal?.throwIfAborted();
    if (this.running.size >= 64) throw new Error('Command capacity reached; wait for or cancel an existing job.');
    const directory = this.directory(input.owner);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.prune(input.owner);
    const id = randomUUID();
    const startRevision = input.snapshot ? await readWorkspaceRevision(input.cwd) : undefined;
    input.signal?.throwIfAborted();
    let launch = await isolatedCommand({ id, command: input.command, cwd: input.cwd, workspace: input.workspace ?? input.cwd, isolation: input.isolation });
    const policy = getSessionInteractionPolicy(input.owner);
    const readOnly = policy.mode === 'plan' || policy.access === 'read-only';
    if (readOnly || policy.sandbox === 'workspace-write') {
      if (launch.containerName) throw new Error('Select one execution isolation boundary; native sandbox and Docker cannot be combined.');
      launch = await sandboxCommand(launch, { workspace: input.workspace ?? input.cwd, access: readOnly ? 'read-only' : 'workspace-write', network: policy.network === true });
    }
    const result: CommandResult = {
      sandbox: readOnly ? 'read-only' : policy.sandbox === 'workspace-write' ? 'workspace-write' : undefined, network: policy.network === true, isolation: input.isolation?.mode ?? 'host', tty: input.tty === true, cols: input.cols ?? 100, rows: input.rows ?? 30,
      ...(launch.containerName ? { containerName: launch.containerName } : {}),
      id, command: redactSensitiveOutput(input.command), cwd: input.cwd, status: 'running', exitCode: null,
      createdAtMs: Date.now(), durationMs: 0, timedOut: false, stdout: '', stderr: '', aggregatedOutput: '',
      totalOutputBytes: 0, captureTruncated: false, logPath: join(directory, `${id}.log`), logTruncated: false,
      ...(startRevision ? { startRevision } : {}),
    };
    writeFileSync(result.logPath, '', { mode: 0o600, flag: 'wx' });
    this.persist(input.owner, result);
    const limit = input.maxOutputChars ?? 50_000;
    let logBytes = 0;
    let closed = false;
    let containerCleanup: Promise<void> | undefined;
    const append = (stream: 'stdout' | 'stderr', chunk: Buffer | string) => {
      const raw = String(chunk);
      const value = redactSensitiveOutput(raw);
      result.totalOutputBytes += Buffer.byteLength(raw);
      result.outputLength = (result.outputLength ?? 0) + value.length;
      result.captureTruncated ||= result[stream].length + value.length > limit || result.aggregatedOutput.length + value.length > limit;
      result[stream] = (result[stream] + value).slice(-limit);
      result.aggregatedOutput = (result.aggregatedOutput + value).slice(-limit);
      const bytes = Buffer.from(value), remaining = Math.max(0, MAX_LOG_BYTES - logBytes);
      if (remaining > 0) {
        try { appendFileSync(result.logPath, bytes.subarray(0, remaining)); }
        catch { result.logTruncated = true; }
      }
      logBytes += Math.min(bytes.length, remaining);
      result.logTruncated ||= bytes.length > remaining;
      input.onOutput?.(stream, value.length > 16_000 ? `${value.slice(0, 16_000)}\n[stream delta truncated]` : value);
    };
    const transport = await startCommandTransport({ program: launch.executable, args: launch.args, shell: launch.shell, cwd: input.cwd, env: input.env, tty: input.tty, cols: input.cols, rows: input.rows, onOutput: append });
    const stop = (status: 'cancelled' | 'timed_out') => {
      if (result.status !== 'running' || closed) return;
      result.status = status; result.timedOut = status === 'timed_out';
      if (launch.containerName) containerCleanup = removeCommandContainer(launch.containerName).catch(error => {
        result.status = 'interrupted'; append('stderr', `Container cleanup failed: ${String(error)}`);
      });
      transport.stop(status === 'timed_out' ? 'timed_out' : 'cancelled');
    };
    const timer = setTimeout(() => stop('timed_out'), commandTimeout(input.timeoutMs));
    timer.unref();
    const abort = () => stop('cancelled');
    input.signal?.addEventListener('abort', abort, { once: true });
    const done = new Promise<CommandResult>(resolve => {
      void transport.completion.then(async processResult => {
        closed = true;
        clearTimeout(timer); input.signal?.removeEventListener('abort', abort);
        if (containerCleanup) await containerCleanup;
        // Wait for the completion snapshot before publishing terminal evidence.
        if (input.snapshot) result.endRevision = await readWorkspaceRevision(input.cwd);
        if (result.status === 'running') result.status = processResult.exitCode === 0 ? 'success' : 'failed';
        result.exitCode = processResult.exitCode; result.durationMs = Date.now() - result.createdAtMs;
        try { this.persist(input.owner, result); } catch { result.logTruncated = true; }
        this.running.delete(id);
        resolve({ ...result });
      });
    });
    this.running.set(id, { owner: input.owner, result, transport, done, stop });
    if (input.signal?.aborted) abort();
    return { ...result };
  }

  get(owner: string, id: string): CommandResult | undefined {
    if (!/^[\da-f-]{36}$/.test(id)) return undefined;
    const current = this.running.get(id);
    if (current) return current.owner === owner ? { ...current.result, durationMs: Date.now() - current.result.createdAtMs } : undefined;
    {
      const result = this.receipts(owner).get(id);
      if (!result) return undefined;
      if (result.status === 'running') {
        result.status = 'interrupted';
        result.stderr += '\nRuntime ownership was lost. Process/container state is unknown; inspect before restarting.';
        this.persist(owner, result);
      }
      return result;
    }
  }

  async wait(owner: string, id: string, waitMs = 30_000, signal?: AbortSignal): Promise<CommandResult | undefined> {
    const current = this.running.get(id);
    if (!current || current.owner !== owner) return this.get(owner, id);
    signal?.throwIfAborted();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let aborted: (() => void) | undefined;
    try {
      return await Promise.race([current.done, new Promise<CommandResult | undefined>((resolve, reject) => {
        timer = setTimeout(() => resolve(this.get(owner, id)), Math.min(60_000, Math.max(0, waitMs)));
        aborted = () => reject(signal?.reason ?? new Error('Aborted'));
        signal?.addEventListener('abort', aborted, { once: true });
      })]);
    } finally {
      clearTimeout(timer);
      if (aborted) signal?.removeEventListener('abort', aborted);
    }
  }
  async cancel(owner: string, id: string): Promise<CommandResult | undefined> {
    const current = this.running.get(id);
    if (current?.owner === owner) { current.stop('cancelled'); return current.done; }
    return this.get(owner, id);
  }
  write(owner: string, id: string, chars: string, end = false): boolean {
    const current = this.running.get(id);
    if (!current || current.owner !== owner || current.result.status !== 'running') return false;
    return current.transport.write(chars, end);
  }
  resize(owner: string, id: string, cols: number, rows: number): boolean {
    if (![cols, rows].every(value => Number.isSafeInteger(value) && value >= 2 && value <= 1000)) throw new Error('Terminal size must be between 2 and 1000.');
    const current = this.running.get(id);
    if (!current || current.owner !== owner || !current.transport.resize || current.result.status !== 'running') return false;
    current.transport.resize(cols, rows); current.result.cols = cols; current.result.rows = rows;
    return true;
  }
  shutdown(): void {
    for (const command of this.running.values()) command.stop('cancelled');
  }
  private prune(owner: string): void {
    if (Date.now() - (this.prunedAt.get(owner) ?? 0) < 60_000) return;
    this.prunedAt.set(owner, Date.now());
    const directory = this.directory(owner);
    const completed = this.receipts(owner).values().filter(job => !this.running.has(job.id) && job.status !== 'running')
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
    for (const [index, job] of completed.entries()) {
      if (index < 500 && Date.now() - job.createdAtMs < 7 * 24 * 60 * 60_000) continue;
      if (!/^[\da-f-]{36}$/.test(job.id)) continue;
      this.receipts(owner).delete(job.id);
      rmSync(join(directory, `${job.id}.log`), { force: true });
    }
  }
  list(owner: string): CommandResult[] {
    {
      return this.receipts(owner).entries()
        .map(([id]) => this.get(owner, id)).filter((job): job is CommandResult => !!job)
        .sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 50);
    }
  }
}

export function commandRegistry(): CommandRegistry {
  return resolveGlobalSingleton(Symbol.for('xopc.commandRegistry'), () => {
    const registry = new CommandRegistry();
    process.once('exit', () => registry.shutdown());
    return registry;
  });
}
