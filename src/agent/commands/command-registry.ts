import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveStateDir } from '../../config/paths.js';
import { resolveGlobalSingleton } from '../../utils/global-singleton.js';
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
  captureTruncated: boolean;
  logPath: string;
  logTruncated: boolean;
  startRevision?: string;
  endRevision?: string;
  isolation?: 'host' | 'docker';
  containerName?: string;
}
interface RunningCommand {
  owner: string;
  result: CommandResult;
  process: ChildProcess;
  done: Promise<CommandResult>;
  stop: (status: 'cancelled' | 'timed_out') => void;
}

export function commandTimeout(raw: unknown, ceiling = MAX_COMMAND_TIMEOUT_MS): number {
  return Math.min(ceiling, Math.max(1, typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_COMMAND_TIMEOUT_MS));
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    killer.on('error', () => child.kill('SIGKILL')); killer.unref();
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
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
    const file = join(this.directory(owner), `${result.id}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(result), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }

  async start(input: {
    owner: string; command: string; cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number;
    workspace?: string; isolation?: CommandIsolation;
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
    const launch = await isolatedCommand({ id, command: input.command, cwd: input.cwd, workspace: input.workspace ?? input.cwd, isolation: input.isolation });
    const result: CommandResult = {
      isolation: input.isolation?.mode ?? 'host',
      ...(launch.containerName ? { containerName: launch.containerName } : {}),
      id, command: input.command, cwd: input.cwd, status: 'running', exitCode: null,
      createdAtMs: Date.now(), durationMs: 0, timedOut: false, stdout: '', stderr: '', aggregatedOutput: '',
      totalOutputBytes: 0, captureTruncated: false, logPath: join(directory, `${id}.log`), logTruncated: false,
      ...(startRevision ? { startRevision } : {}),
    };
    writeFileSync(result.logPath, '', { mode: 0o600, flag: 'wx' });
    this.persist(input.owner, result);
    const child = spawn(launch.executable, launch.args, { shell: launch.shell, cwd: input.cwd, env: input.env, detached: process.platform !== 'win32' });
    const limit = input.maxOutputChars ?? 50_000;
    let logBytes = 0;
    let closed = false;
    let containerCleanup: Promise<void> | undefined;
    const append = (stream: 'stdout' | 'stderr', chunk: Buffer | string) => {
      const value = String(chunk);
      result.totalOutputBytes += Buffer.byteLength(value);
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
    const stop = (status: 'cancelled' | 'timed_out') => {
      if (result.status !== 'running' || closed) return;
      result.status = status; result.timedOut = status === 'timed_out';
      if (launch.containerName) containerCleanup = removeCommandContainer(launch.containerName).catch(error => {
        result.status = 'interrupted'; append('stderr', `Container cleanup failed: ${String(error)}`);
      });
      killTree(child);
    };
    const timer = setTimeout(() => stop('timed_out'), commandTimeout(input.timeoutMs));
    timer.unref();
    const abort = () => stop('cancelled');
    input.signal?.addEventListener('abort', abort, { once: true });
    const done = new Promise<CommandResult>(resolve => {
      child.stdout?.on('data', value => append('stdout', value));
      child.stderr?.on('data', value => append('stderr', value));
      child.on('error', error => append('stderr', error.message));
      child.stdin?.on('error', error => append('stderr', error.message));
      child.on('close', async exitCode => {
        closed = true;
        clearTimeout(timer); input.signal?.removeEventListener('abort', abort);
        if (containerCleanup) await containerCleanup;
        // Wait for the completion snapshot before publishing terminal evidence.
        if (input.snapshot) result.endRevision = await readWorkspaceRevision(input.cwd);
        if (result.status === 'running') result.status = exitCode === 0 ? 'success' : 'failed';
        result.exitCode = exitCode; result.durationMs = Date.now() - result.createdAtMs;
        try { this.persist(input.owner, result); } catch { result.logTruncated = true; }
        this.running.delete(id);
        resolve({ ...result });
      });
    });
    this.running.set(id, { owner: input.owner, result, process: child, done, stop });
    if (input.signal?.aborted) abort();
    return { ...result };
  }

  get(owner: string, id: string): CommandResult | undefined {
    if (!/^[\da-f-]{36}$/.test(id)) return undefined;
    const current = this.running.get(id);
    if (current) return current.owner === owner ? { ...current.result, durationMs: Date.now() - current.result.createdAtMs } : undefined;
    try {
      const result = JSON.parse(readFileSync(join(this.directory(owner), `${id}.json`), 'utf8')) as CommandResult;
      if (result.status === 'running') {
        result.status = 'interrupted';
        result.stderr += '\nRuntime ownership was lost. Process/container state is unknown; inspect before restarting.';
        this.persist(owner, result);
      }
      return result;
    } catch { return undefined; }
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
    if (!current || current.owner !== owner || current.result.status !== 'running' || !current.process.stdin?.writable) return false;
    if (end) current.process.stdin.end(chars); else current.process.stdin.write(chars);
    return true;
  }
  shutdown(): void {
    for (const command of this.running.values()) command.stop('cancelled');
  }
  private prune(owner: string): void {
    if (Date.now() - (this.prunedAt.get(owner) ?? 0) < 60_000) return;
    this.prunedAt.set(owner, Date.now());
    const directory = this.directory(owner);
    const completed = readdirSync(directory).filter(file => file.endsWith('.json')).flatMap(file => {
      try {
        const job = JSON.parse(readFileSync(join(directory, file), 'utf8')) as CommandResult;
        return this.running.has(job.id) || job.status === 'running' ? [] : [job];
      } catch { return []; }
    }).sort((a, b) => b.createdAtMs - a.createdAtMs);
    for (const [index, job] of completed.entries()) {
      if (index < 500 && Date.now() - job.createdAtMs < 7 * 24 * 60 * 60_000) continue;
      if (!/^[\da-f-]{36}$/.test(job.id)) continue;
      rmSync(join(directory, `${job.id}.json`), { force: true });
      rmSync(join(directory, `${job.id}.log`), { force: true });
    }
  }
  list(owner: string): CommandResult[] {
    try {
      return readdirSync(this.directory(owner)).filter(file => file.endsWith('.json'))
        .map(file => this.get(owner, file.slice(0, -5))).filter((job): job is CommandResult => !!job)
        .sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 50);
    } catch { return []; }
  }
}

export function commandRegistry(): CommandRegistry {
  return resolveGlobalSingleton(Symbol.for('xopc.commandRegistry'), () => {
    const registry = new CommandRegistry();
    process.once('exit', () => registry.shutdown());
    return registry;
  });
}
